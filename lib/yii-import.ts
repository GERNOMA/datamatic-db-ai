import { strFromU8, unzipSync } from "fflate";
import type { ModelReport } from "./yii-analysis.ts";

export type SimpleModel = {
  model: string;
  module: string | null;
  functions: { name: string; file: string }[];
};
export type ImportedModel = SimpleModel & { externallyUsed: boolean };
export type ImportedZip = { models: ImportedModel[]; warnings: string[] };
export type TableUsage = {
  name: string;
  externallyUsed: boolean;
  functions: SimpleModel["functions"];
};

export function simpleModel(
  model: Pick<ModelReport, "model" | "module" | "functions">,
): SimpleModel {
  return {
    model: model.model,
    module: model.module,
    functions: model.functions.map(({ name, file }) => ({ name, file })),
  };
}
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const classKey = (value: string) => value.replace(/^\\/, "").toLowerCase();

export function importYiiZip(data: Uint8Array): ImportedZip {
  let total = 0,
    count = 0;
  const entries = unzipSync(data, {
    filter: (entry) => {
      if (
        !/(^|\/)(sin-codigo|simplificado)\/[^/]+\.json$/i.test(
          entry.name.replace(/\\/g, "/"),
        )
      )
        return false;
      total += entry.originalSize;
      if (++count > 40000 || total > 100 * 1024 * 1024)
        throw new Error(
          "El ZIP supera el límite de 100 MB de JSON o 40.000 entradas.",
        );
      return true;
    },
  });
  const warnings: string[] = [],
    models: ImportedModel[] = [];
  for (const [path, bytes] of Object.entries(entries)) {
    if (!/(^|\/)sin-codigo\//i.test(path.replace(/\\/g, "/"))) continue;
    const value: unknown = JSON.parse(strFromU8(bytes).replace(/^\uFEFF/, ""));
    if (
      !record(value) ||
      typeof value.model !== "string" ||
      !value.model.trim() ||
      !(
        value.module === null ||
        (typeof value.module === "string" && value.module.trim())
      ) ||
      !Array.isArray(value.functions)
    )
      throw new Error(`${path}: formato de modelo no válido.`);
    const functions = value.functions.map((fn) => {
      if (
        !record(fn) ||
        typeof fn.name !== "string" ||
        typeof fn.file !== "string" ||
        !(
          fn.class === null ||
          (typeof fn.class === "string" && fn.class.trim())
        )
      )
        throw new Error(
          `${path}: cada función necesita name, file y class (o null para funciones globales).`,
        );
      return { name: fn.name, file: fn.file, class: fn.class as string | null };
    });
    const canonical: SimpleModel = {
      model: value.model,
      module: value.module as string | null,
      functions: functions.map(({ name, file }) => ({ name, file })),
    };
    const simplifiedPath = path.replace(/sin-codigo/i, "simplificado");
    let simplified = canonical;
    if (entries[simplifiedPath]) {
      // Keep the no-code report authoritative: mismatched simplified files cannot add instructions/code.
      const supplied: unknown = JSON.parse(strFromU8(entries[simplifiedPath]));
      if (
        record(supplied) &&
        supplied.model === canonical.model &&
        supplied.module === canonical.module &&
        JSON.stringify(supplied.functions) ===
          JSON.stringify(canonical.functions)
      )
        simplified = {
          ...canonical,
          functions: supplied.functions as SimpleModel["functions"],
        };
      else
        warnings.push(
          `${simplifiedPath}: no coincide con sin-codigo; se regeneró el JSON simple.`,
        );
    }
    models.push({
      ...simplified,
      externallyUsed: functions.some(
        (fn) =>
          fn.class === null || classKey(fn.class) !== classKey(canonical.model),
      ),
    });
    if (!canonical.module)
      warnings.push(
        `${canonical.model}: tabla sin resolver; no se puede asociar a una tabla de la base de datos.`,
      );
  }
  if (!models.length)
    throw new Error(
      "El ZIP no contiene JSON de modelos en sin-codigo/. Sube el ZIP exportado por este analizador.",
    );
  return { models, warnings };
}

/** Shared tables are unused only when every exported model has no external usage. */
export function reviewTableUsage(
  usages: TableUsage[],
  tables: { name: string }[],
) {
  const byName = new Map(usages.map((usage) => [usage.name, usage]));
  return tables.map((table) => ({
    name: table.name,
    detected: byName.has(table.name),
    notUsed: !byName.get(table.name)?.externallyUsed,
  }));
}

export function groupTableUsage(models: ImportedModel[]): TableUsage[] {
  const tables = new Map<string, TableUsage>();
  for (const model of models) {
    if (!model.module) continue;
    const table = tables.get(model.module) || {
      name: model.module,
      externallyUsed: false,
      functions: [],
    };
    table.externallyUsed ||= model.externallyUsed;
    table.functions.push(...model.functions);
    tables.set(model.module, table);
  }
  return [...tables.values()].map((table) => ({
    ...table,
    functions: [
      ...new Map(
        table.functions.map((fn) => [JSON.stringify(fn), fn]),
      ).values(),
    ],
  }));
}
