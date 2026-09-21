import type { Table } from "./types.ts";

/** The browser workspace owns persistent exclusions; every AI request syncs them. */
export function applyExclusions(tables: Table[], excluded: unknown): Table[] {
  if (
    !Array.isArray(excluded) ||
    excluded.some((name) => typeof name !== "string")
  )
    throw new Error("La lista de tablas NOT USED no es válida.");
  const names = new Set(excluded);
  return tables.map((table) => ({ ...table, notUsed: names.has(table.name) }));
}

export function contextTables(tables: Table[]): Table[] {
  return tables.filter((table) => !table.notUsed);
}
