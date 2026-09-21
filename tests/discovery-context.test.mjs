import assert from "node:assert/strict";
import test from "node:test";
import { runChat } from "../lib/chat.ts";
import { addDiscoveredTables } from "../lib/jev.ts";
import { addDiscoveredFunctions } from "../lib/code-context.ts";

test("overlapping discoveries expose each schema and function once, including follow-ups", async () => {
  const tables = ["orders", "customers"].map((name) => ({
    name,
    fields: [],
    description: `schema-${name}`,
  }));
  const functions = tables.map((table) => ({
    id: table.name,
    name: table.name,
    rawCode: `code-${table.name}`,
    probability: 0.9,
    purpose: "sales",
  }));
  const context = { initialized: false, tables: [] };
  const selected = [];

  for (const followup of [false, true]) {
    const messages = [
      {
        role: "system",
        content: JSON.stringify({
          tables: tables.filter((t) => context.tables.includes(t.name)),
          functions: selected,
        }),
      },
    ];
    const actions = [
      { type: "discover", purpose: "initial" },
      { type: "discover_functions", purpose: "initial" },
      { type: "discover", purpose: "overlap" },
      { type: "discover_functions", purpose: "overlap" },
      { type: "discover", purpose: "repeat" },
      { type: "discover_functions", purpose: "repeat" },
      { type: "answer", text: "Listo", views: [] },
    ];
    await runChat(
      messages,
      async (input) => {
        const payload = input.map((m) => m.content).join("\n");
        for (const marker of [
          "schema-orders",
          "schema-customers",
          "code-orders",
          "code-customers",
        ])
          assert.ok(
            payload.split(marker).length - 1 <= 1,
            `${marker} was duplicated`,
          );
        return JSON.stringify(actions.shift());
      },
      async () => assert.fail("No SQL expected"),
      false,
      {
        required: !context.initialized,
        discover: async (purpose) => {
          const matches = purpose === "initial" ? [tables[0]] : tables;
          return {
            matchedTables: matches.map((t) => t.name),
            tables: addDiscoveredTables(context, matches),
          };
        },
      },
      async (purpose) => {
        const matches = purpose === "initial" ? [functions[0]] : functions;
        return {
          matched: matches.map((fn) => fn.id),
          functions: addDiscoveredFunctions(selected, matches),
        };
      },
    );
    assert.deepEqual(context.tables, ["orders", "customers"]);
    assert.deepEqual(selected, functions);
    const results = messages
      .filter((m) => m.role === "user")
      .map((m) => JSON.parse(m.content));
    assert.deepEqual(
      results.filter((r) => r.discovery).map((r) => r.discovery.tables.length),
      followup ? [0, 0, 0] : [1, 1, 0],
    );
    assert.deepEqual(
      results
        .filter((r) => r.functionDiscovery)
        .map((r) => r.functionDiscovery.functions.length),
      followup ? [0, 0, 0] : [1, 1, 0],
    );
    assert.deepEqual(results[4].discovery.matchedTables, [
      "orders",
      "customers",
    ]);
    assert.deepEqual(results[5].functionDiscovery.matched, [
      "orders",
      "customers",
    ]);
  }
});
