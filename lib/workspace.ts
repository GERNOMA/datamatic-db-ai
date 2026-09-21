import type { Group, Table } from "./types";

export const WORKSPACE_KEY = "datamatic:workspace";
export type SavedConnection = {
  id: string;
  name: string;
  url: string;
  apiKey: string;
  model: string;
  tables: Table[];
  groups: Group[];
  selectedGroups: string[];
};
export type Workspace = {
  version: 1;
  activeConnectionId: string | null;
  connections: SavedConnection[];
  freeVisualization: boolean;
};
export function emptyWorkspace(): Workspace {
  return {
    version: 1,
    activeConnectionId: null,
    connections: [],
    freeVisualization: false,
  };
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function strings(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === "string")
  );
}
function unique(values: string[]) {
  return new Set(values).size === values.length;
}
export function validTables(value: unknown): value is Table[] {
  return (
    Array.isArray(value) &&
    value.every(
      (t) =>
        record(t) &&
        typeof t.name === "string" &&
        (t.description === undefined || typeof t.description === "string") &&
        (t.notUsed === undefined || typeof t.notUsed === "boolean") &&
        Array.isArray(t.fields) &&
        t.fields.every(
          (f) =>
            record(f) &&
            typeof f.name === "string" &&
            typeof f.type === "string" &&
            typeof f.key === "string" &&
            typeof f.nullable === "boolean" &&
            (f.description === undefined || typeof f.description === "string"),
        ) &&
        unique(t.fields.map((f) => f.name)),
    ) &&
    unique(value.map((t) => t.name))
  );
}
export function validGroups(value: unknown): value is Group[] {
  return (
    Array.isArray(value) &&
    value.every(
      (g) =>
        record(g) &&
        typeof g.id === "string" &&
        typeof g.name === "string" &&
        strings(g.tables) &&
        unique(g.tables),
    ) &&
    unique(value.map((g) => g.id))
  );
}

/** Validate the whole document before replacing any saved state. */
export function parseWorkspace(json: string): Workspace {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    throw new Error("El archivo no contiene JSON válido.");
  }
  if (
    !record(value) ||
    value.version !== 1 ||
    typeof value.freeVisualization !== "boolean" ||
    !Array.isArray(value.connections) ||
    !(
      value.activeConnectionId === null ||
      typeof value.activeConnectionId === "string"
    )
  ) {
    throw new Error("Formato de Datamatic no válido o versión no compatible.");
  }
  for (const c of value.connections) {
    if (
      !record(c) ||
      ![c.id, c.name, c.url, c.apiKey, c.model].every(
        (s) => typeof s === "string",
      ) ||
      !validTables(c.tables) ||
      !validGroups(c.groups) ||
      !strings(c.selectedGroups) ||
      !unique(c.selectedGroups) ||
      c.groups.some((g) =>
        g.tables.some(
          (name) => !(c.tables as Table[]).some((t) => t.name === name),
        ),
      ) ||
      c.selectedGroups.some(
        (id) => !(c.groups as Group[]).some((g) => g.id === id),
      )
    ) {
      throw new Error(
        "Las conexiones, tablas o grupos del JSON no son válidos.",
      );
    }
    if (c.url) {
      try {
        const url = new URL(c.url as string);
        if (
          url.protocol !== "mysql:" ||
          !url.hostname ||
          url.pathname.length < 2
        )
          throw new Error();
      } catch {
        throw new Error("El JSON contiene una URL de MySQL no válida.");
      }
    }
  }
  if (
    !unique(value.connections.map((c) => c.id)) ||
    (value.activeConnectionId !== null &&
      !value.connections.some((c) => c.id === value.activeConnectionId))
  ) {
    throw new Error(
      "La selección de conexión o los identificadores no son válidos.",
    );
  }
  return value as Workspace;
}

export function readWorkspace(
  storage: Pick<Storage, "getItem" | "key" | "length">,
): Workspace {
  const json = storage.getItem(WORKSPACE_KEY);
  if (json !== null) return parseWorkspace(json);
  const workspace = emptyWorkspace();
  // Migrate every old database, including databases other than the current session.
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (!key?.startsWith("datamatic:") || key === WORKSPACE_KEY) continue;
    try {
      const old = JSON.parse(storage.getItem(key) || "{}");
      if (!validTables(old.tables) || !validGroups(old.groups)) continue;
      workspace.connections.push({
        id: key.slice(10),
        name: key.slice(10),
        url: "",
        apiKey: "",
        model: "openrouter/auto",
        tables: old.tables,
        groups: old.groups.map((g: Group) => ({
          ...g,
          tables: g.tables.filter((name) =>
            old.tables.some((t: Table) => t.name === name),
          ),
        })),
        selectedGroups: [],
      });
    } catch {
      /* Ignore malformed legacy entries without discarding other databases. */
    }
  }
  return workspace;
}
