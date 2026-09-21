import test from "node:test";
import assert from "node:assert/strict";
import { labelInputs, labelTables } from "../lib/automatic-labels.ts";
import { applyExclusions, contextTables } from "../lib/table-context.ts";
import { discoverTables } from "../lib/jev.ts";
import { validateQuery } from "../lib/sql.ts";

const tables = [
  { name: "employee", fields: [] },
  { name: "unused", fields: [], notUsed: true },
];
const input = (module) => ({
  module,
  functions: [
    {
      name: "actionIndex",
      file: "Controller.php",
      class: "Controller",
      rawCode: "SECRET",
    },
  ],
});

test("excluded tables cannot enter label inputs or SQL context and may be explicitly re-enabled", () => {
  assert.throws(() => labelInputs([input("unused")], tables), /NOT USED/);
  assert.throws(() => labelInputs([input("unknown")], tables));
  assert.throws(() =>
    labelInputs([input("employee"), input("employee")], tables),
  );
  assert.deepEqual(
    contextTables(tables).map((t) => t.name),
    ["employee"],
  );
  assert.throws(() =>
    validateQuery(
      "SELECT * FROM unused",
      contextTables(tables).map((t) => t.name),
    ),
  );
  assert.equal(contextTables(applyExclusions(tables, [])).length, 2);
  assert.throws(() => applyExclusions(tables, [true]));
});
test("discovery never calls the provider for NOT USED tables", async () => {
  const calls = [];
  const result = await discoverTables(
    tables,
    "all",
    "key",
    new AbortController().signal,
    async (_url, init) => {
      calls.push(JSON.parse(init.body).state.table.name);
      return Response.json({ answers: { useful: { type: "noul", noul: 1 } } });
    },
  );
  assert.deepEqual(calls, ["employee"]);
  assert.deepEqual(
    result.map((t) => t.name),
    ["employee"],
  );
});
test("labeling starts all requests in parallel, sends minimal JSON, and retains partial successes", async () => {
  const allowed = [
    { name: "one", fields: [] },
    { name: "two", fields: [] },
  ];
  const inputs = labelInputs(
    allowed.map((t) => input(t.name)),
    allowed,
  );
  const calls = [],
    pending = [],
    results = [];
  const work = labelTables(
    inputs,
    "chosen/model",
    "key",
    new AbortController().signal,
    (r) => results.push(r),
    async (_url, init) => {
      const body = JSON.parse(init.body);
      calls.push(body);
      return new Promise((resolve) => pending.push(resolve));
    },
  );
  assert.equal(calls.length, 2);
  for (const body of calls) {
    assert.equal(body.model, "chosen/model");
    const payload = JSON.parse(body.messages[1].content);
    assert.deepEqual(Object.keys(payload).sort(), ["functions", "module"]);
    assert.deepEqual(Object.keys(payload.functions[0]).sort(), [
      "file",
      "name",
    ]);
    assert.ok(!body.messages[1].content.includes("SECRET"));
  }
  pending[0](
    Response.json({
      choices: [{ message: { content: "Registro de empleados." } }],
    }),
  );
  pending[1](new Response("limited", { status: 429 }));
  await work;
  assert.ok(
    results.some(
      (r) => r.table === "one" && r.description === "Registro de empleados.",
    ),
  );
  assert.ok(results.some((r) => r.table === "two" && r.error.includes("429")));
});
test("canceled batches do not start provider calls or save results", async () => {
  const controller = new AbortController();
  controller.abort();
  let calls = 0;
  await labelTables(
    [input("employee")],
    "chosen/model",
    "key",
    controller.signal,
    () => {
      throw new Error("must not save");
    },
    async () => {
      calls++;
    },
  );
  assert.equal(calls, 0);
});
