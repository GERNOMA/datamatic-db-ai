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
    assert.equal(body.max_tokens, undefined);
    assert.equal(body.max_completion_tokens, 500);
    assert.deepEqual(body.reasoning, { effort: "minimal", exclude: true });
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
  pending[1](
    new Response('{"error":{"message":"limited by provider"}}', {
      status: 429,
    }),
  );
  await work;
  assert.ok(
    results.some(
      (r) => r.table === "one" && r.description === "Registro de empleados.",
    ),
  );
  assert.ok(results.some((r) => r.table === "two" && r.error.includes("429")));
  assert.ok(
    results.some(
      (r) =>
        r.table === "two" && r.modelResponse.includes("limited by provider"),
    ),
  );
});
test("extracts visible text blocks while ignoring encrypted reasoning", async () => {
  for (const completion of [
    {
      choices: [
        {
          message: {
            content: [
              { type: "reasoning.encrypted", data: "encrypted" },
              { type: "text", text: "Tabla de empleados." },
            ],
          },
        },
      ],
    },
    {
      output: [
        { type: "reasoning", encrypted_content: "encrypted" },
        {
          type: "message",
          content: [{ type: "output_text", text: "Tabla de empleados." }],
        },
      ],
    },
  ]) {
    const results = [];
    await labelTables(
      [input("employee")],
      "chosen/model",
      "key",
      new AbortController().signal,
      (result) => results.push(result),
      async () => Response.json(completion),
    );
    assert.equal(results[0].description, "Tabla de empleados.");
  }
});
test("invalid model output is included in the error and capped", async () => {
  const results = [];
  await labelTables(
    [input("employee")],
    "chosen/model",
    "key",
    new AbortController().signal,
    (result) => results.push(result),
    async () =>
      Response.json({
        choices: [{ message: { content: "x".repeat(5000) } }],
      }),
  );
  assert.match(results[0].error, /240/);
  assert.ok(results[0].modelResponse.startsWith("x".repeat(100)));
  assert.ok(results[0].modelResponse.endsWith("…respuesta recortada"));
  assert.ok(results[0].modelResponse.length < 4100);
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
