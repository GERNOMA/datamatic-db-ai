// Code-only setting: JEV probabilities must be strictly above this value (0–1).
export const JEV_FUNCTION_THRESHOLD = 0.5;
export type CodeFunction = {
  id: string;
  name: string;
  class: string | null;
  file: string;
  line: number;
  rawCode: string;
  models: string[];
  tables: string[];
};
export type SelectedFunction = CodeFunction & {
  probability: number;
  purpose: string;
};
export type CodeArchiveInfo = {
  name: string;
  savedAt: string;
  functions: number;
  models: number;
};

export function parseCodeModels(
  entries: Record<string, Uint8Array>,
): CodeFunction[] {
  const functions = new Map<string, CodeFunction>();
  for (const [path, bytes] of Object.entries(entries)) {
    if (!/(^|\/)con-codigo\/[^/]+\.json$/i.test(path.replace(/\\/g, "/")))
      continue;
    const model = JSON.parse(
      new TextDecoder().decode(bytes).replace(/^\uFEFF/, ""),
    );
    if (
      !model ||
      typeof model.model !== "string" ||
      !model.model.trim() ||
      !(model.module === null || typeof model.module === "string") ||
      !Array.isArray(model.functions)
    )
      throw new Error(`${path}: modelo con código no válido.`);
    for (const fn of model.functions) {
      if (
        !fn ||
        typeof fn.name !== "string" ||
        typeof fn.file !== "string" ||
        !(fn.class === null || typeof fn.class === "string") ||
        !Number.isInteger(fn.line) ||
        fn.line < 1 ||
        typeof fn.rawCode !== "string" ||
        !fn.rawCode.trim()
      )
        throw new Error(
          `${path}: falta el código completo o la ubicación de una función.`,
        );
      const id = JSON.stringify([fn.file, fn.class, fn.name, fn.line]);
      const old = functions.get(id);
      if (old && old.rawCode !== fn.rawCode)
        throw new Error(`${path}: código contradictorio para ${fn.name}.`);
      const value = old || {
        id,
        name: fn.name,
        class: fn.class,
        file: fn.file,
        line: fn.line,
        rawCode: fn.rawCode,
        models: [],
        tables: [],
      };
      value.models = [...new Set([...value.models, model.model])];
      value.tables = [
        ...new Set([...value.tables, ...(model.module ? [model.module] : [])]),
      ];
      functions.set(id, value);
    }
  }
  if (!functions.size)
    throw new Error(
      "El archivo necesita JSON con funciones completas en con-codigo/. Exporta primero el proyecto con este analizador.",
    );
  return [...functions.values()];
}

export function functionsForTables(
  functions: CodeFunction[],
  tables: string[],
) {
  const names = new Set(tables);
  return functions.filter((fn) => fn.tables.some((table) => names.has(table)));
}

export function validateFunctionThreshold(value: unknown): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > 1
  )
    throw new Error("La probabilidad mínima debe estar entre 0 y 1.");
  return value;
}
