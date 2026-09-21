import assert from "node:assert/strict";
import test from "node:test";
import { discoverTables, addDiscoveredTables } from "../lib/jev.ts";
import { runChat, MAX_DISCOVERIES } from "../lib/chat.ts";
import { validateQuery } from "../lib/sql.ts";

const tables = ["orders", "customers", "inventory", "unrelated"].map(
  (name) => ({
    name,
    fields: [{ name: "id", type: "int", key: "PRI", nullable: false }],
    description: name,
  }),
);
const final = JSON.stringify({ type: "answer", text: "Listo", views: [] });
const discover = (purpose) => JSON.stringify({ type: "discover", purpose });
const step = (sql) => ({ sql, rows: [], duration: 0, truncated: false });

test("one Decisions request per table, with isolated metadata and a strict configurable probability cutoff", async () => {
  const requests = [];
  const probabilities = {
    orders: 0.31,
    customers: 0.3,
    inventory: 0.9,
    unrelated: 0,
  };
  const fetcher = async (url, init) => {
    const body = JSON.parse(init.body);
    requests.push(body);
    assert.equal(url, "https://openrouter.ai/api/alpha/decisions");
    assert.equal(init.headers.Authorization, "Bearer test-key");
    assert.equal(body.questions.useful.type, "noul");
    assert.match(body.questions.useful.instructions, /sales/);
    assert.deepEqual(Object.keys(body.state), ["table"]);
    return Response.json({
      answers: {
        useful: { type: "noul", noul: probabilities[body.state.table.name] },
      },
    });
  };
  assert.deepEqual(
    (
      await discoverTables(
        tables,
        "sales",
        "test-key",
        new AbortController().signal,
        fetcher,
        0.3,
      )
    ).map((t) => t.name),
    ["orders", "inventory"],
  );
  assert.equal(requests.length, tables.length);
  assert.deepEqual(
    new Set(requests.map((r) => r.state.table.name)),
    new Set(tables.map((t) => t.name)),
  );
  assert.deepEqual(
    (
      await discoverTables(
        tables,
        "sales",
        "test-key",
        new AbortController().signal,
        fetcher,
        0.8,
      )
    ).map((t) => t.name),
    ["inventory"],
  );
});

test("invalid probabilities, provider errors and cancellation fail discovery", async () => {
  for (const answer of [
    { type: "noul", noul: 1.1 },
    { type: "noul", noul: -1 },
    { type: "noul", noul: "0.9" },
    { type: "choice", noul: 0.9 },
    {},
  ]) {
    await assert.rejects(
      discoverTables(
        tables.slice(0, 1),
        "sales",
        "key",
        new AbortController().signal,
        async () => Response.json({ answers: { useful: answer } }),
      ),
      /probabilidad/,
    );
  }
  await assert.rejects(
    discoverTables(tables, "sales", "key", AbortSignal.abort(), async () =>
      assert.fail("No network after cancellation"),
    ),
  );
  await assert.rejects(
    discoverTables(
      tables.slice(0, 1),
      "sales",
      "key",
      new AbortController().signal,
      async () => new Response("", { status: 429 }),
    ),
    /429/,
  );
});

test("first discovery is enforced, discoveries interleave with queries and union context across messages", async () => {
  const context = { initialized: false, tables: [] };
  const actions = [
    final,
    discover("sales"),
    JSON.stringify({ type: "query", sql: "SELECT id FROM orders" }),
    discover("customers"),
    JSON.stringify({
      type: "query",
      sql: "SELECT orders.id FROM orders JOIN customers ON orders.id = customers.id",
    }),
    final,
  ];
  let sweeps = 0;
  const options = () => ({
    required: !context.initialized,
    discover: async (purpose) => {
      sweeps++;
      addDiscoveredTables(
        context,
        purpose === "sales" ? [tables[0]] : [tables[1]],
      );
      return { tables: tables.filter((t) => context.tables.includes(t.name)) };
    },
  });
  const messages = [];
  const answer = await runChat(
    messages,
    async () => actions.shift(),
    async (sql) => {
      validateQuery(sql, context.tables);
      return step(sql);
    },
    false,
    options(),
  );
  assert.equal(answer.steps.length, 2);
  assert.equal(sweeps, 2);
  assert.deepEqual(context.tables, ["orders", "customers"]);
  assert.match(
    messages.find((m) => m.content.includes("First choose"))?.content ?? "",
    /First choose/,
  );
  await runChat(
    [],
    async () => final,
    async () => assert.fail(),
    false,
    options(),
  );
  assert.equal(sweeps, 2, "follow-up answer does not force discovery");
  const followup = [discover("sales"), final];
  await runChat(
    [],
    async () => followup.shift(),
    async () => assert.fail(),
    false,
    options(),
  );
  assert.deepEqual(context.tables, ["orders", "customers"]);
  assert.equal(sweeps, 3);
  assert.throws(() => validateQuery("SELECT * FROM inventory", context.tables));
});

test("zero matches completes initial discovery and preserves prior tables on later empty results", async () => {
  const context = { initialized: false, tables: [] };
  addDiscoveredTables(context, []);
  assert.equal(context.initialized, true);
  addDiscoveredTables(context, [tables[0]]);
  addDiscoveredTables(context, []);
  assert.deepEqual(context.tables, ["orders"]);
});

test("discovery failures propagate without repeated sweeps; optional discovery loops are bounded", async () => {
  let sweeps = 0;
  await assert.rejects(
    runChat(
      [],
      async () => discover("sales"),
      async () => assert.fail(),
      false,
      {
        required: true,
        discover: async () => {
          sweeps++;
          throw Error("JEV 429");
        },
      },
    ),
    /JEV 429/,
  );
  assert.equal(sweeps, 1);
  sweeps = 0;
  await runChat(
    [],
    async () => discover("sales"),
    async () => assert.fail(),
    false,
    {
      required: true,
      discover: async () => {
        sweeps++;
        return { tables: [] };
      },
    },
  );
  assert.equal(sweeps, MAX_DISCOVERIES);
});

test("required discovery blocks SQL and remains compatible with free visualization", async () => {
  const actions = [
    JSON.stringify({ type: "query", sql: "SELECT * FROM orders" }),
    discover("sales"),
    JSON.stringify({
      type: "answer",
      text: "Listo",
      html: "<main>Listo</main>",
    }),
  ];
  let sweeps = 0;
  const answer = await runChat(
    [],
    async () => actions.shift(),
    async () => assert.fail("SQL before discovery must not execute"),
    true,
    {
      required: true,
      discover: async () => {
        sweeps++;
        return { tables: [] };
      },
    },
  );
  assert.equal(sweeps, 1);
  assert.equal(answer.html, "<main>Listo</main>");
});

test("a sweep tolerates at most ten percent failed table requests", async () => {
  const context = { initialized: true, tables: ["existing"] };
  const many = Array.from({ length: 10 }, (_, i) => ({
    ...tables[0],
    name: `table_${i}`,
  }));
  const selected = await discoverTables(
    many,
    "sales",
    "key",
    new AbortController().signal,
    async (_, init) => {
      const { table } = JSON.parse(init.body).state;
      if (table.name === "table_0") throw new Error("JEV 429");
      return Response.json({
        answers: { useful: { type: "noul", noul: 0.9 } },
      });
    },
  );
  addDiscoveredTables(context, selected);
  assert.deepEqual(
    context.tables,
    ["existing", ...many.slice(1).map((table) => table.name)],
  );

  await assert.rejects(
    (async () => {
      const failed = await discoverTables(
        many,
        "sales",
        "key",
        new AbortController().signal,
        async (_, init) => {
          const { table } = JSON.parse(init.body).state;
          if (["table_0", "table_1"].includes(table.name))
            throw new Error("JEV 429");
          return Response.json({
            answers: { useful: { type: "noul", noul: 0.9 } },
          });
        },
      );
      addDiscoveredTables(context, failed);
    })(),
    /429/,
  );
  assert.deepEqual(
    context.tables,
    ["existing", ...many.slice(1).map((table) => table.name)],
  );
});
