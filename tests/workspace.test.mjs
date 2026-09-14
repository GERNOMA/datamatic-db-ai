import assert from "node:assert/strict";
import test from "node:test";
import {
  emptyWorkspace,
  parseWorkspace,
  readWorkspace,
  WORKSPACE_KEY,
} from "../lib/workspace.ts";

const profile = {
  id: "db1",
  name: "demo",
  url: "mysql://user:password@localhost/demo",
  apiKey: "test-key",
  model: "openrouter/auto",
  tables: [
    {
      name: "users",
      description: "People",
      fields: [
        {
          name: "id",
          type: "int",
          key: "PRI",
          nullable: false,
          description: "Identifier",
        },
      ],
    },
  ],
  groups: [{ id: "group1", name: "People", tables: ["users"] }],
  selectedGroups: ["group1"],
};
const sample = () => ({
  ...emptyWorkspace(),
  activeConnectionId: "db1",
  connections: [structuredClone(profile)],
  freeVisualization: true,
});
function storage(entries) {
  const map = new Map(entries);
  return {
    getItem: (key) => map.get(key) ?? null,
    key: (i) => [...map.keys()][i] ?? null,
    length: map.size,
  };
}
test("JSON round trip retains credentials, schema descriptions, groups and preferences", () => {
  assert.deepEqual(parseWorkspace(JSON.stringify(sample())), sample());
  assert.deepEqual(
    parseWorkspace(JSON.stringify(emptyWorkspace())),
    emptyWorkspace(),
  );
});
test("rejects malformed documents, duplicate IDs, and dangling references", () => {
  assert.throws(() => parseWorkspace("not JSON"));
  for (const change of [
    (w) => {
      w.version = 2;
    },
    (w) => {
      w.connections.push(structuredClone(profile));
    },
    (w) => {
      w.activeConnectionId = "missing";
    },
    (w) => {
      w.connections[0].groups[0].tables = ["missing"];
    },
    (w) => {
      w.connections[0].selectedGroups = ["missing"];
    },
    (w) => {
      w.connections[0].tables[0].fields[0].nullable = "false";
    },
    (w) => {
      w.connections[0].url = "https://example.com";
    },
    (w) => {
      w.connections[0].apiKey = null;
    },
  ]) {
    const value = sample();
    change(value);
    assert.throws(() => parseWorkspace(JSON.stringify(value)));
  }
});
test("migrates all legacy databases and drops removed table references", () => {
  const old = {
    tables: profile.tables,
    groups: [{ ...profile.groups[0], tables: ["users", "deleted"] }],
  };
  const result = readWorkspace(
    storage([
      ["unrelated", "{}"],
      ["datamatic:db1", JSON.stringify(old)],
      ["datamatic:db2", JSON.stringify(old)],
      ["datamatic:broken", "!"],
    ]),
  );
  assert.deepEqual(
    result.connections.map((c) => c.id),
    ["db1", "db2"],
  );
  assert.deepEqual(result.connections[0].groups[0].tables, ["users"]);
  assert.equal(result.connections[0].url, "");
  assert.doesNotThrow(() => parseWorkspace(JSON.stringify(result)));
});
test("a replacement workspace prevents old saves from being resurrected", () => {
  assert.deepEqual(
    readWorkspace(
      storage([
        [WORKSPACE_KEY, JSON.stringify(emptyWorkspace())],
        ["datamatic:db1", JSON.stringify(profile)],
      ]),
    ),
    emptyWorkspace(),
  );
  assert.throws(() => readWorkspace(storage([[WORKSPACE_KEY, "broken"]])));
});
