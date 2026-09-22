import Engine from "php-parser";

// php-parser's published types do not expose a discriminated AST union.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Node = { kind: string; [key: string]: any };
export type PhpSource = { path: string; code: string };
export type FunctionUsage = {
  name: string;
  controller: string | null;
  class: string | null;
  file: string;
  line: number;
  usage: string[];
  rawCode: string;
  body: string | null;
};
export type ModelReport = {
  model: string;
  file: string;
  module: string | null;
  tableExpression: string | null;
  tableResolution: "explicit" | "inherited" | "convention" | "unresolved";
  functions: FunctionUsage[];
};
export type Analysis = {
  files: number;
  models: ModelReport[];
  warnings: string[];
};
type Context = {
  namespace: string;
  aliases: Map<string, string>;
  source: PhpSource;
};
type ClassInfo = { name: string; parent: string; node: Node; context: Context };
type Fn = {
  node: Node;
  owner?: ClassInfo;
  context: Context;
  refs: Map<string, Set<string>>;
  calls: Set<string>;
  key: string;
};
const lower = (s: string) => s.toLowerCase();
// Global PHP exception/error classes are supplied by the runtime, not the archive.
const runtimeParents = new Set(
  [
    "Exception",
    "Error",
    "ErrorException",
    "LogicException",
    "BadFunctionCallException",
    "BadMethodCallException",
    "DomainException",
    "InvalidArgumentException",
    "LengthException",
    "OutOfRangeException",
    "RuntimeException",
    "OutOfBoundsException",
    "OverflowException",
    "RangeException",
    "UnderflowException",
    "UnexpectedValueException",
    "ArithmeticError",
    "DivisionByZeroError",
    "AssertionError",
    "ParseError",
    "TypeError",
    "ArgumentCountError",
    "ValueError",
    "UnhandledMatchError",
  ].map(lower),
);
const nameOf = (n: Node | string | undefined): string =>
  typeof n === "string" ? n : n?.name || "";
function walk(value: unknown, visit: (node: Node) => void) {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((v) => walk(v, visit));
    return;
  }
  const node = value as Node;
  if (node.kind) visit(node);
  for (const [key, child] of Object.entries(node))
    if (key !== "loc" && key !== "comments") walk(child, visit);
}
function resolve(name: string, ctx: Context, owner?: ClassInfo): string {
  if (!name) return "";
  if (/^(self|static)$/i.test(name)) return owner?.name || "";
  if (/^parent$/i.test(name)) return owner?.parent || "";
  if (name.startsWith("\\")) return name.slice(1);
  if (name.startsWith("namespace\\"))
    return [ctx.namespace, name.slice(10)].filter(Boolean).join("\\");
  const [first, ...rest] = name.split("\\");
  const alias = ctx.aliases.get(lower(first));
  return alias
    ? [alias, ...rest].join("\\")
    : [ctx.namespace, name].filter(Boolean).join("\\");
}
const slice = (node: Node, source: PhpSource) =>
  source.code.slice(node.loc.start.offset, node.loc.end.offset);

export function analyzeYii(
  sources: PhpSource[],
  progress?: (done: number) => void,
): Analysis {
  const classes: ClassInfo[] = [],
    functions: Fn[] = [],
    warnings: string[] = [];
  const Parser = Engine as unknown as new (options: object) => {
    parseCode(code: string, path: string): unknown;
  };
  const parser = new Parser({
    parser: { version: "8.3", suppressErrors: false },
    ast: { withPositions: true },
  });
  function collect(nodes: Node[], ctx: Context) {
    for (const n of nodes)
      if (n.kind === "usegroup" && !n.type) {
        for (const item of n.items)
          if (!item.type) {
            const full = [n.name, item.name].filter(Boolean).join("\\");
            ctx.aliases.set(
              lower(nameOf(item.alias) || full.split("\\").at(-1)!),
              full.replace(/^\\/, ""),
            );
          }
      }
    for (const n of nodes) {
      if (n.kind === "namespace")
        collect(n.children, { ...ctx, namespace: n.name, aliases: new Map() });
      if (["class", "trait"].includes(n.kind) && n.name) {
        const owner = {
          name: [ctx.namespace, nameOf(n.name)].filter(Boolean).join("\\"),
          parent: resolve(nameOf(n.extends), ctx),
          node: n,
          context: ctx,
        };
        classes.push(owner);
        for (const method of n.body)
          if (method.kind === "method") addFunction(method, ctx, owner);
      }
      if (n.kind === "function") addFunction(n, ctx);
    }
  }
  function addFunction(node: Node, context: Context, owner?: ClassInfo) {
    functions.push({
      node,
      owner,
      context,
      refs: new Map(),
      calls: new Set(),
      key: lower(`${owner?.name || context.namespace}::${nameOf(node.name)}`),
    });
  }
  sources.forEach((source, i) => {
    try {
      collect(
        (parser.parseCode(source.code, source.path) as unknown as Node)
          .children,
        { namespace: "", aliases: new Map(), source },
      );
    } catch (error) {
      warnings.push(
        `${source.path}: ${error instanceof Error ? error.message : "PHP inválido"}`,
      );
    }
    progress?.(i + 1);
  });
  const byName = new Map(classes.map((c) => [lower(c.name), c]));
  function descends(
    c: ClassInfo,
    target: RegExp,
    seen = new Set<string>(),
  ): boolean {
    if (seen.has(lower(c.name))) return false;
    seen.add(lower(c.name));
    if (target.test(c.parent)) return true;
    const parent = byName.get(lower(c.parent));
    return !!parent && descends(parent, target, seen);
  }
  const models = classes.filter(
    (c) =>
      c.node.kind === "class" &&
      descends(c, /^yii\\db\\(?:ActiveRecord|BaseActiveRecord)$/i),
  );
  const modelNames = new Set(models.map((c) => lower(c.name)));
  function table(
    c: ClassInfo,
    seen = new Set<string>(),
  ): Pick<ModelReport, "module" | "tableExpression" | "tableResolution"> {
    if (seen.has(c.name))
      return {
        module: null,
        tableExpression: null,
        tableResolution: "unresolved",
      };
    seen.add(c.name);
    const method = c.node.body.find(
      (n: Node) => n.kind === "method" && lower(nameOf(n.name)) === "tablename",
    );
    if (method) {
      const returns: Node[] = [];
      walk(method.body, (n) => {
        if (n.kind === "return") returns.push(n);
      });
      const expression = returns[0]?.expr;
      if (returns.length === 1 && expression?.kind === "string")
        return {
          module: expression.value
            .replace(/^\{\{%?/, "")
            .replace(/\}\}$/, "")
            .replace(/%$/, ""),
          tableExpression: expression.value,
          tableResolution: "explicit",
        };
      return {
        module: null,
        tableExpression: expression
          ? slice(expression, c.context.source)
          : null,
        tableResolution: "unresolved",
      };
    }
    const parent = byName.get(lower(c.parent));
    if (parent && modelNames.has(lower(parent.name))) {
      const inherited = table(parent, seen);
      if (inherited.tableResolution !== "convention")
        return {
          ...inherited,
          tableResolution: inherited.module ? "inherited" : "unresolved",
        };
    }
    return {
      module: c.name
        .split("\\")
        .at(-1)!
        .replace(/(?!^)[A-Z]/g, "_$&")
        .toLowerCase(),
      tableExpression: null,
      tableResolution: "convention",
    };
  }
  for (const fn of functions) {
    const add = (name: string, reason: string) => {
      const key = lower(name);
      if (modelNames.has(key)) {
        if (!fn.refs.has(key)) fn.refs.set(key, new Set());
        fn.refs.get(key)!.add(reason);
      }
    };
    if (fn.owner) add(fn.owner.name, "defined-in-model");
    walk(fn.node, (n) => {
      if (
        [
          "name",
          "selfreference",
          "staticreference",
          "parentreference",
        ].includes(n.kind)
      ) {
        const name = nameOf(n) || n.kind.replace("reference", "");
        add(resolve(name, fn.context, fn.owner), "class-reference");
      }
      if (n.kind === "string" && n.value.includes("\\"))
        add(n.value.replace(/^\\/, ""), "class-string");
      if (n.kind === "call") {
        const what = n.what;
        const method = nameOf(what.offset);
        if (what.kind === "staticlookup" && method)
          fn.calls.add(
            lower(
              `${resolve(nameOf(what.what) || what.what.kind.replace("reference", ""), fn.context, fn.owner)}::${method}`,
            ),
          );
        if (
          what.kind === "propertylookup" &&
          what.what.kind === "variable" &&
          what.what.name === "this" &&
          fn.owner &&
          method
        )
          fn.calls.add(lower(`${fn.owner.name}::${method}`));
      }
    });
  }
  const fnByKey = new Map(functions.map((f) => [f.key, f]));
  // Resolve inherited helper calls, such as $this->findModel($id).
  for (const fn of functions)
    for (const call of [...fn.calls]) {
      if (fnByKey.has(call)) continue;
      const [className, method] = call.split("::");
      let owner = byName.get(className);
      const visited = new Set<string>();
      while (owner && !visited.has(owner.name)) {
        visited.add(owner.name);
        const key = lower(`${owner.parent}::${method}`);
        if (fnByKey.has(key)) {
          fn.calls.add(key);
          break;
        }
        owner = byName.get(lower(owner.parent));
      }
    }
  let changed = true;
  while (changed) {
    changed = false;
    for (const fn of functions)
      for (const call of fn.calls) {
        for (const model of fnByKey.get(call)?.refs.keys() || [])
          if (!fn.refs.has(model)) {
            fn.refs.set(model, new Set([`via:${call}`]));
            changed = true;
          }
      }
  }
  const reports = models.map((model): ModelReport => {
    const resolved = table(model);
    if (!resolved.module)
      warnings.push(
        `${model.name}: tableName() dinámico; tabla sin resolver. Archivo: ${model.context.source.path}.${resolved.tableExpression ? ` Expresión: ${resolved.tableExpression}` : ""}`,
      );
    return {
      model: model.name,
      file: model.context.source.path,
      ...resolved,
      functions: functions
        .filter((fn) => fn.refs.has(lower(model.name)))
        .map((fn) => ({
          name: nameOf(fn.node.name),
          controller:
            fn.owner &&
            (descends(
              fn.owner,
              /^yii\\(?:web|rest|console)\\(?:Controller|ActiveController)$/i,
            ) ||
              /Controller$/.test(fn.owner.name))
              ? fn.owner.name
              : null,
          class: fn.owner?.name || null,
          file: fn.context.source.path,
          line: fn.node.loc.start.line,
          usage: [...fn.refs.get(lower(model.name))!],
          rawCode: slice(fn.node, fn.context.source),
          body: fn.node.body
            ? slice(fn.node.body, fn.context.source).slice(1, -1)
            : null,
        })),
    };
  });
  for (const c of classes)
    if (
      c.parent &&
      !byName.has(lower(c.parent)) &&
      !lower(c.parent).startsWith("yii\\") &&
      !runtimeParents.has(lower(c.parent))
    )
      warnings.push(
        `${c.name}: clase padre no incluida (${c.parent}); la detección puede estar incompleta.`,
      );
  return {
    files: sources.length,
    models: reports.sort((a, b) => a.model.localeCompare(b.model)),
    warnings,
  };
}

export function modelJson(model: ModelReport, withCode: boolean): string {
  return JSON.stringify(
    {
      schemaVersion: 1,
      ...model,
      functions: model.functions.map(({ rawCode, body, ...fn }) =>
        withCode ? { ...fn, rawCode, body } : fn,
      ),
    },
    null,
    2,
  );
}
