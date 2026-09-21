import type { Table } from "./types";

export type CatalogTable = {
  tabla: string;
  descripcion?: string;
  columnas: { nombre: string; descripcion?: string }[];
};

export function parseCatalog(text: string): CatalogTable[] {
  let value: unknown;
  try {
    value = JSON.parse(text.replace(/^\uFEFF/, ""));
  } catch {
    throw new Error("El archivo no contiene un JSON válido.");
  }
  if (!Array.isArray(value) || !value.length)
    throw new Error("El catálogo debe ser una lista con al menos una tabla.");
  const names = new Set<string>();
  return value.map((item, index) => {
    if (!item || typeof item.tabla !== "string" || !item.tabla.trim())
      throw new Error(`La entrada ${index + 1} necesita un nombre de tabla.`);
    if (names.has(item.tabla))
      throw new Error(`La tabla «${item.tabla}» está repetida.`);
    names.add(item.tabla);
    if (!Array.isArray(item.columnas))
      throw new Error(
        `La tabla «${item.tabla}» necesita una lista «columnas».`,
      );
    const fields = new Set<string>();
    const description = (value: unknown): string | undefined => {
      if (value !== undefined && typeof value !== "string")
        throw new Error(
          `Las descripciones de «${item.tabla}» deben ser texto.`,
        );
      return typeof value === "string" && value.trim() ? value : undefined;
    };
    return {
      tabla: item.tabla,
      descripcion: description(item.descripcion),
      columnas: item.columnas.map((field: unknown) => {
        if (
          !field ||
          typeof field !== "object" ||
          !("nombre" in field) ||
          typeof field.nombre !== "string" ||
          !field.nombre.trim()
        )
          throw new Error(`Hay un campo sin nombre válido en «${item.tabla}».`);
        if (fields.has(field.nombre))
          throw new Error(
            `El campo «${item.tabla}.${field.nombre}» está repetido.`,
          );
        fields.add(field.nombre);
        return {
          nombre: field.nombre,
          descripcion: description(
            "descripcion" in field ? field.descripcion : undefined,
          ),
        };
      }),
    };
  });
}

export function validateCatalog(catalog: CatalogTable[], tables: Table[]) {
  const schema = new Map(tables.map((table) => [table.name, table]));
  return catalog.map((entry) => {
    const table = schema.get(entry.tabla);
    const fields = new Set(table?.fields.map((field) => field.name));
    return {
      name: entry.tabla,
      exists: !!table,
      fields: entry.columnas.map((field) => ({
        name: field.nombre,
        exists: fields.has(field.nombre),
      })),
    };
  });
}

export function applyCatalog(catalog: CatalogTable[], tables: Table[]) {
  const entries = new Map(catalog.map((entry) => [entry.tabla, entry]));
  return tables.map((table) => {
    const entry = entries.get(table.name);
    if (!entry) return table;
    const fields = new Map(
      entry.columnas.map((field) => [field.nombre, field]),
    );
    return {
      ...table,
      description: entry.descripcion ?? table.description,
      fields: table.fields.map((field) => ({
        ...field,
        description: fields.get(field.name)?.descripcion ?? field.description,
      })),
    };
  });
}
