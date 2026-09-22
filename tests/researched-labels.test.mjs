import test from "node:test";
import assert from "node:assert/strict";
import { researchLabels } from "../lib/researched-labels.ts";
import { validTables } from "../lib/workspace.ts";
import { applyFieldLabels } from "../lib/field-labels.ts";

const table = {
  name: "assignments",
  fields: [{ name: "id", type: "int", key: "PRI", nullable: false }],
};
const fn = {
  id: "fn1",
  name: "assign",
  class: "Assignment",
  file: "Assignment.php",
  line: 4,
  rawCode: "public function assign() { return $this->save(); }",
  models: ["Assignment"],
  tables: [table.name],
};
const draft = {
  action: "draft",
  description: "Registra asignaciones.",
  claims: [{ text: "Registra asignaciones", sources: ["schema:assignments"] }],
  uncertainties: ["¿Conserva el historial?"],
};
const final = { ...draft, action: "final", uncertainties: [] };
const fieldLabel = {
  name: "st",
  description: "Estado de la asignación: 1 indica activa y 0 cerrada.",
  reason: "La abreviatura no explica el significado ni los códigos.",
  sources: ["fn1"],
};
const fieldTable = {
  ...table,
  fields: [
    ...table.fields,
    { name: "st", type: "int", key: "", nullable: false },
  ],
};
let sequence = 0;
async function run(actions, overrides = {}) {
  const results = [],
    requests = [],
    sql = [];
  let index = 0;
  const options = {
    inputs: [{ module: table.name, functions: [] }],
    tables: [table, { name: "excluded", notUsed: true, fields: [] }],
    functions: [fn],
    connectionId: `test-${++sequence}`,
    model: "writer",
    apiKey: "key",
    signal: new AbortController().signal,
    onResult: (r) => results.push(r),
    execute: async (query, allowed) => {
      sql.push({ query, allowed });
      return {
        sql: query,
        rows: [{ count: 2 }],
        truncated: false,
        duration: 1,
      };
    },
    fetcher: async (url, init) => {
      const body = JSON.parse(init.body);
      requests.push({ url, body: structuredClone(body) });
      if (url.endsWith("decisions"))
        return Response.json({
          answers: Object.fromEntries(
            Object.keys(body.questions).map((q) => [
              q,
              { type: "noul", noul: 0.9 },
            ]),
          ),
        });
      return Response.json({
        choices: [
          { message: { content: JSON.stringify(actions[index++] ?? final) } },
        ],
      });
    },
    ...overrides,
  };
  await researchLabels(options);
  return {
    results: results.filter((r) => !r.stage),
    progress: results.filter((r) => r.stage),
    requests,
    sql,
    options,
  };
}

test("scouts full linked code, queries, reviews the actual draft, and persists inspectable evidence", async () => {
  const result = await run([
    { action: "query", sql: "SELECT COUNT(*) AS count FROM assignments" },
    draft,
    {
      ...final,
      claims: [
        { text: "Dos registros observados", sources: ["fn1", "query:1"] },
      ],
    },
  ]);
  assert.equal(result.results[0].description, final.description);
  const jev = result.requests.filter((r) => r.url.endsWith("decisions"));
  assert.equal(jev.length, 1);
  assert.equal(jev[0].body.state.functions[0].rawCode, fn.rawCode);
  assert.match(jev[0].body.state.criteria[0], /contradict/);
  assert.match(jev[0].body.state.criteria[0], /Registra asignaciones/);
  assert.match(jev[0].body.state.criteria[1], /historial/);
  assert.deepEqual(result.sql[0].allowed, [table.name]);
  const evidence = result.results[0].evidence;
  assert.equal(evidence.functions[0].file, fn.file);
  assert.equal(evidence.queries[0].rowCount, 1);
  assert.equal(evidence.queries[0].rows, undefined);
  assert.equal(evidence.functions[0].rawCode, undefined);
  assert.equal(validTables([{ ...table, labelEvidence: evidence }]), true);
  assert.equal(
    validTables([{ ...table, labelEvidence: { ...evidence, claims: [null] } }]),
    false,
  );
});

test("rejects unsafe and excluded SQL before execution and enforces the three-attempt budget", async () => {
  const result = await run([
    { action: "query", sql: "DELETE FROM assignments" },
    { action: "query", sql: "SELECT * FROM excluded" },
    { action: "query", sql: "SELECT COUNT(*) FROM assignments" },
    { action: "query", sql: "SELECT COUNT(*) FROM assignments" },
    draft,
    final,
  ]);
  assert.equal(result.sql.length, 1);
  assert.equal(result.results[0].evidence.queries.length, 3);
  assert.ok(result.results[0].evidence.queries[0].error);
  assert.ok(result.results[0].evidence.queries[1].error);
});

test("related table joins require explicit schema inspection and exclusions remain inaccessible", async () => {
  const result = await run(
    [
      { action: "inspect_table", name: "excluded" },
      { action: "inspect_table", name: "workers" },
      {
        action: "query",
        sql: "SELECT COUNT(*) FROM assignments a JOIN workers w ON w.id = a.id",
      },
      draft,
      final,
    ],
    {
      tables: [
        table,
        { name: "workers", fields: table.fields },
        { name: "excluded", fields: [], notUsed: true },
      ],
    },
  );
  assert.deepEqual(result.sql[0].allowed, ["assignments", "workers"]);
  assert.equal(result.results[0].description, final.description);
});

test("never accepts a final before review or fabricated source IDs", async () => {
  const result = await run([
    final,
    draft,
    { ...final, claims: [{ text: "Invented", sources: ["unknown"] }] },
    final,
  ]);
  assert.equal(
    result.requests.filter((r) => !r.url.endsWith("decisions")).length,
    4,
  );
  assert.equal(result.results[0].description, final.description);
});

test("code cache is reused but changed code and question produce new decisions", async () => {
  const first = await run([draft, final]);
  const second = await run([draft, final], {
    connectionId: first.options.connectionId,
  });
  assert.equal(
    second.requests.filter((r) => r.url.endsWith("decisions")).length,
    0,
  );
  const third = await run([draft, final], {
    connectionId: first.options.connectionId,
    functions: [{ ...fn, rawCode: fn.rawCode + " // changed" }],
  });
  assert.equal(
    third.requests.filter((r) => r.url.endsWith("decisions")).length,
    1,
  );
});

test("missing code and failed JEV decisions are explicitly reported as incomplete evidence", async () => {
  const missing = await run([draft, final], { functions: [] });
  assert.match(missing.results[0].evidence.warnings[0], /No hay código/);
  let calls = 0;
  const failed = await run([], {
    fetcher: async (url) => {
      if (url.endsWith("decisions"))
        return new Response("failed", { status: 429 });
      return Response.json({
        choices: [
          { message: { content: JSON.stringify(calls++ ? final : draft) } },
        ],
      });
    },
  });
  assert.match(
    failed.results[0].evidence.warnings.join(" "),
    /evidencia incompleta/,
  );
});

test("invalid or oversized descriptions exhaust the budget without overwriting a table", async () => {
  const result = await run(
    Array.from({ length: 8 }, () => ({
      ...draft,
      description: "a".repeat(241),
    })),
  );
  assert.equal(result.results[0].description, undefined);
  assert.match(result.results[0].error, /presupuesto/);
});

test("cancellation during a SELECT prevents further calls and saving", async () => {
  const controller = new AbortController();
  const result = await run(
    [{ action: "query", sql: "SELECT id FROM assignments" }],
    {
      signal: controller.signal,
      execute: async () => {
        controller.abort();
        return {
          rows: [],
          truncated: false,
          duration: 0,
          sql: "SELECT id FROM assignments",
        };
      },
    },
  );
  assert.deepEqual(result.results, []);
  assert.equal(
    result.requests.filter((r) => !r.url.endsWith("decisions")).length,
    1,
  );
});

test("one failed table does not discard another successful result", async () => {
  const result = await run([draft, final], {
    inputs: [
      { module: "unknown", functions: [] },
      { module: table.name, functions: [] },
    ],
  });
  assert.ok(result.results.some((r) => r.table === "unknown" && r.error));
  assert.ok(
    result.results.some((r) => r.table === table.name && r.description),
  );
});

test("the writer can inspect an unselected linked function and make only one targeted search", async () => {
  const hidden = {
    ...fn,
    id: "hidden",
    name: "history",
    rawCode:
      "public function history() { return $this->hasMany(History::class); }",
  };
  const actions = [
    { action: "read_functions", ids: ["foreign-function"] },
    { action: "read_functions", ids: ["hidden"] },
    { action: "discover", purpose: "Does it retain historical assignments?" },
    { action: "discover", purpose: "Repeat search" },
    draft,
    { ...final, claims: [{ text: "Historial", sources: ["hidden"] }] },
  ];
  const bodies = [];
  let step = 0;
  const result = await run([], {
    functions: [hidden],
    fetcher: async (url, init) => {
      const body = JSON.parse(init.body);
      bodies.push(body);
      if (url.endsWith("decisions"))
        return Response.json({
          answers: Object.fromEntries(
            Object.keys(body.questions).map((q) => [
              q,
              { type: "noul", noul: 0.1 },
            ]),
          ),
        });
      return Response.json({
        choices: [{ message: { content: JSON.stringify(actions[step++]) } }],
      });
    },
  });
  assert.equal(result.results[0].evidence.functions[0].id, "hidden");
  assert.equal(bodies.filter((b) => b.questions).length, 2);
  assert.ok(
    bodies.some((b) =>
      b.state?.criteria[0].includes("Does it retain historical assignments?"),
    ),
  );
  assert.ok(
    bodies.some((b) =>
      b.messages?.some(
        (m) => m.role === "user" && m.content.includes(hidden.rawCode),
      ),
    ),
  );
});

test("a schema change invalidates cached code decisions", async () => {
  const first = await run([draft, final]);
  const next = await run([draft, final], {
    connectionId: first.options.connectionId,
    tables: [
      {
        ...table,
        fields: [
          ...table.fields,
          { name: "ended_at", type: "datetime", key: "", nullable: true },
        ],
      },
    ],
  });
  assert.equal(
    next.requests.filter((r) => r.url.endsWith("decisions")).length,
    1,
  );
});

test("unclear field descriptions are reviewed, returned and persisted with their sources", async () => {
  const result = await run(
    [
      { ...draft, fields: [fieldLabel] },
      { ...final, fields: [fieldLabel] },
    ],
    {
      tables: [fieldTable],
      functions: [
        {
          ...fn,
          rawCode:
            "public function close() { $this->st = 0; } public function activate() { $this->st = 1; }",
        },
      ],
    },
  );
  assert.deepEqual(result.results[0].fields, [fieldLabel]);
  assert.deepEqual(result.results[0].evidence.fields, [fieldLabel]);
  const review = result.requests.filter((r) => r.url.endsWith("decisions"))[0];
  assert.ok(review.body.state.criteria[0].includes(fieldLabel.description));
  const saved = {
    ...fieldTable,
    fields: applyFieldLabels(fieldTable.fields, result.results[0].fields),
    labelEvidence: result.results[0].evidence,
  };
  const restored = JSON.parse(JSON.stringify([saved]));
  assert.equal(validTables(restored), true);
  assert.equal(restored[0].fields[1].description, fieldLabel.description);
  assert.equal(restored[0].fields[0].description, undefined);
  assert.equal(
    validTables([
      {
        ...saved,
        labelEvidence: {
          ...saved.labelEvidence,
          fields: [{ ...fieldLabel, sources: [null] }],
        },
      },
    ]),
    false,
  );
});

test("invalid fields cannot be saved and the model can correct its proposal", async () => {
  for (const fields of [
    [{ ...fieldLabel, name: "foreign_column" }],
    [fieldLabel, fieldLabel],
    [{ ...fieldLabel, sources: ["invented"] }],
    [{ ...fieldLabel, description: "x".repeat(241) }],
    [{ ...fieldLabel, reason: "" }],
  ]) {
    const result = await run([{ ...draft, fields }, draft, final], {
      tables: [fieldTable],
    });
    assert.deepEqual(result.results[0].fields, []);
    assert.equal(
      result.requests.filter((r) => !r.url.endsWith("decisions")).length,
      3,
    );
  }
});

test("fields cannot be added after the draft review", async () => {
  const result = await run([draft, { ...final, fields: [fieldLabel] }, final], {
    tables: [fieldTable],
  });
  assert.deepEqual(result.results[0].fields, []);
  assert.equal(
    result.requests.filter((r) => !r.url.endsWith("decisions")).length,
    3,
  );
});

test("applying labels fills only blank known fields and preserves existing user descriptions", () => {
  const fields = [
    { ...fieldTable.fields[0], description: "Identificador manual" },
    { ...fieldTable.fields[1], description: "  " },
    { ...fieldTable.fields[1], name: "untouched" },
  ];
  const updated = applyFieldLabels(fields, [
    fieldLabel,
    { ...fieldLabel, name: "id" },
    { ...fieldLabel, name: "unknown" },
  ]);
  assert.equal(updated[0].description, "Identificador manual");
  assert.equal(updated[1].description, fieldLabel.description);
  assert.equal(updated[2], fields[2]);
  assert.equal(updated.length, fields.length);
  assert.equal(fields[1].description, "  ");
});

test("small fully evidenced clean drafts save with one writer and one JEV request", async () => {
  let writerCalls = 0,
    jevCalls = 0;
  const result = await run([], {
    fetcher: async (url, init) => {
      const body = JSON.parse(init.body);
      if (url.endsWith("decisions")) {
        jevCalls++;
        return Response.json({
          answers: Object.fromEntries(
            Object.keys(body.questions).map((key) => [
              key,
              { type: "noul", noul: 0.05 },
            ]),
          ),
        });
      }
      writerCalls++;
      assert.ok(body.messages.some((m) => m.content.includes(fn.rawCode)));
      return Response.json({
        choices: [
          {
            message: {
              content: JSON.stringify({ ...draft, uncertainties: [] }),
            },
          },
        ],
      });
    },
  });
  assert.equal(writerCalls, 1);
  assert.equal(jevCalls, 1);
  assert.equal(result.results[0].description, draft.description);
});

test("large archives batch independent per-function decisions without losing coverage", async () => {
  const functions = Array.from({ length: 32 }, (_, i) => ({
    ...fn,
    id: `fn${i}`,
    file: `Model${i}.php`,
  }));
  const result = await run([draft, final], { functions });
  const jev = result.requests.filter((r) => r.url.endsWith("decisions"));
  assert.equal(jev.length, 8); // formerly 64: 32 functions times two sweeps
  assert.equal(result.requests.length, 10); // includes the two writer calls
  for (const batch of jev) assert.equal(batch.body.state.functions.length, 8);
  const initial = jev.filter((r) => r.body.state.criteria.length === 5);
  assert.equal(
    new Set(initial.flatMap((r) => r.body.state.functions.map((f) => f.id)))
      .size,
    32,
  );
  for (const batch of initial)
    assert.equal(Object.keys(batch.body.questions).length, 40);
  assert.equal(result.results[0].description, final.description);
});

test("uncertainty, ambiguous review scores and failed reviews require the second writer call", async () => {
  for (const scenario of ["uncertainty", "ambiguous", "failure"]) {
    let calls = 0;
    const result = await run([], {
      fetcher: async (url, init) => {
        const body = JSON.parse(init.body);
        if (url.endsWith("decisions")) {
          if (scenario === "failure")
            return new Response("failed", { status: 429 });
          return Response.json({
            answers: Object.fromEntries(
              Object.keys(body.questions).map((key) => [
                key,
                { type: "noul", noul: scenario === "ambiguous" ? 0.4 : 0.05 },
              ]),
            ),
          });
        }
        return Response.json({
          choices: [
            {
              message: {
                content: JSON.stringify(
                  calls++
                    ? final
                    : {
                        ...draft,
                        uncertainties:
                          scenario === "uncertainty"
                            ? ["Unknown lifecycle"]
                            : [],
                      },
                ),
              },
            },
          ],
        });
      },
    });
    assert.equal(calls, 2, scenario);
    assert.equal(result.results[0].description, final.description);
  }
});

test("batch scores stay attached to their own functions", async () => {
  const functions = Array.from({ length: 16 }, (_, i) => ({
    ...fn,
    id: `fn${i}`,
    rawCode: `function method${i}() { return ${i}; }`,
  }));
  let calls = 0;
  const result = await run([], {
    functions,
    fetcher: async (url, init) => {
      const body = JSON.parse(init.body);
      if (url.endsWith("decisions"))
        return Response.json({
          answers: Object.fromEntries(
            Object.keys(body.questions).map((key) => {
              const index = Number(key.match(/^f(\d+)_/)[1]);
              return [
                key,
                {
                  type: "noul",
                  noul: body.state.functions[index].id === "fn13" ? 0.9 : 0,
                },
              ];
            }),
          ),
        });
      return Response.json({
        choices: [
          { message: { content: JSON.stringify(calls++ ? final : draft) } },
        ],
      });
    },
  });
  assert.deepEqual(
    result.results[0].evidence.functions.map((f) => f.id),
    ["fn13"],
  );
});
