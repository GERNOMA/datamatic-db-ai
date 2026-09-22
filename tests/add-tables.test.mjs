import assert from "node:assert/strict";
import test from "node:test";
import { runChat, MAX_TABLE_ADDITIONS } from "../lib/chat.ts";
import { resolveContextTables } from "../lib/table-context.ts";
import { addDiscoveredTables } from "../lib/jev.ts";
import { validateQuery } from "../lib/sql.ts";

const answer = { type: "answer", text: "Listo", views: [] };

test("function references can expand context with multiple tables before querying", async () => {
  const schema = ["orders", "customers", "regions", "secret"].map((name) => ({
    name,
    fields: [],
    notUsed: name === "secret",
  }));
  const context = { initialized: true, tables: ["orders"] };
  assert.throws(() => validateQuery("SELECT * FROM customers", context.tables));
  const messages = [];
  const actions = [
    { type: "discover_functions", purpose: "customer region lookup" },
    {
      type: "add_tables",
      tables: ["customers", "regions", "customers", "secret", "missing"],
    },
    { type: "query", sql: "SELECT * FROM customers" },
    { type: "add_tables", tables: ["customers"] },
    answer,
  ];
  await runChat(
    messages,
    async () => JSON.stringify(actions.shift()),
    async (sql) => {
      validateQuery(sql, context.tables);
      return { sql, rows: [], duration: 0, truncated: false };
    },
    false,
    undefined,
    async () => ({ functions: [{ rawCode: "customers JOIN regions" }] }),
    async (names) => {
      const resolved = resolveContextTables(schema, names);
      return {
        tables: addDiscoveredTables(context, resolved.tables),
        unavailableTables: resolved.unavailableTables,
      };
    },
  );
  assert.deepEqual(context.tables, ["orders", "customers", "regions"]);
  const additions = messages
    .filter((m) => m.role === "user")
    .map((m) => JSON.parse(m.content))
    .filter((m) => m.tableAddition);
  assert.deepEqual(
    additions[0].tableAddition.tables.map((t) => t.name),
    ["customers", "regions"],
  );
  assert.deepEqual(additions[0].tableAddition.unavailableTables, [
    "secret",
    "missing",
  ]);
  assert.deepEqual(additions[1].tableAddition.tables, []);
});

test("invalid additions are recoverable and valid attempts have their own budget", async () => {
  const actions = [
    ...[[], "orders", [null], [""], Array(101).fill("orders")].map(
      (tables) => ({ type: "add_tables", tables }),
    ),
    ...Array(MAX_TABLE_ADDITIONS + 1).fill({
      type: "add_tables",
      tables: ["orders"],
    }),
    answer,
  ];
  let calls = 0;
  const messages = [];
  const result = await runChat(
    messages,
    async () => JSON.stringify(actions.shift()),
    async () => assert.fail("No query expected"),
    false,
    undefined,
    undefined,
    async () => {
      calls++;
      return {};
    },
  );
  assert.equal(calls, MAX_TABLE_ADDITIONS);
  assert.equal(result.text, "Listo");
  assert.ok(
    messages.some((m) => m.content.includes("No table additions remain")),
  );
});

test("direct additions cannot bypass the initial DR.STRANGE discovery", async () => {
  const actions = [
    { type: "add_tables", tables: ["orders"] },
    { type: "discover", purpose: "orders" },
    answer,
  ];
  await runChat(
    [],
    async () => JSON.stringify(actions.shift()),
    async () => assert.fail(),
    false,
    { required: true, discover: async () => ({ tables: [] }) },
    undefined,
    async () => assert.fail("Must discover first"),
  );
});
