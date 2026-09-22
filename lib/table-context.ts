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

/** Resolve exact names against the connected schema, respecting exclusions. */
export function resolveContextTables(tables: Table[], names: string[]) {
  const available = new Map(
    contextTables(tables).map((table) => [table.name, table]),
  );
  const requested = [...new Set(names)];
  return {
    tables: requested.flatMap((name) =>
      available.has(name) ? [available.get(name)!] : [],
    ),
    unavailableTables: requested.filter((name) => !available.has(name)),
  };
}
