import assert from "node:assert/strict";
import test from "node:test";
import { executeCalculation, MAX_CALCULATIONS } from "../lib/calculation.ts";
import { runChat, MAX_QUERIES } from "../lib/chat.ts";

const step = (sql, rows = [{ amount: "12" }, { amount: "8" }]) => ({
  sql,
  rows,
  duration: 1,
  truncated: false,
});
const noQuery = async () => {
  throw Error("Unexpected SQL");
};

test("calculations combine multiple SQL calls with prior results", async () => {
  const statements = [];
  const result = await executeCalculation(
    `
    const a = sql('SELECT amount FROM orders');
    const b = sql('SELECT amount FROM refunds');
    return [{net: a.rows.reduce((sum, r) => sum + Number(r.amount), 0) - b.rows[0].amount + queryResults[0].rows[0].carry}];
  `,
    async (sql) => {
      statements.push(sql);
      await new Promise((resolve) => setTimeout(resolve, 5));
      return step(sql, sql.includes("refunds") ? [{ amount: 3 }] : undefined);
    },
    [step("previous", [{ carry: 2 }])],
  );
  assert.equal(result.error, undefined);
  assert.deepEqual(result.rows, [{ net: 19 }]);
  assert.equal(statements.length, 2);
});

test("no host capabilities leak and interpreter state is isolated", async () => {
  const result = await executeCalculation(
    `
    globalThis.secret = 42;
    return [{process: typeof process, require: typeof require, fetch: typeof fetch,
      escape: sql.constructor('return typeof process')(), bridge: typeof __sql}];
  `,
    noQuery,
    [],
  );
  assert.equal(result.error, undefined);
  assert.deepEqual(Object.values(result.rows[0]), Array(5).fill("undefined"));
  const next = await executeCalculation(
    "return [{secret: typeof secret}];",
    noQuery,
    [],
  );
  assert.deepEqual(next.rows, [{ secret: "undefined" }]);
});

test("loops, memory exhaustion, invalid output, and SQL errors return failures", async () => {
  for (const code of [
    "while (true) {}",
    "const a = []; while (true) a.push('x'.repeat(100000));",
    "return 42;",
    "return [{value: 'x'.repeat(100001)}];",
    "return Promise.resolve([]);",
    "return [{n: 1n}];",
    "return [{broken: ];",
  ]) {
    const result = await executeCalculation(code, noQuery, [], { cpuMs: 50 });
    assert.ok(result.error, code);
    assert.deepEqual(result.rows, []);
  }
  const failed = await executeCalculation(
    "sql('SELECT secret FROM excluded'); return [];",
    async (sql) => ({ ...step(sql), error: "Table not allowed" }),
    [],
  );
  assert.match(failed.error, /Table not allowed/);
});

test("truncation survives calculations and output is capped", async () => {
  const result = await executeCalculation(
    "sql('SELECT amount FROM orders'); return [{total: 20}];",
    async (sql) => ({ ...step(sql), truncated: true }),
    [],
  );
  assert.equal(result.truncated, true);
  const previous = await executeCalculation("return [];", noQuery, [result]);
  assert.equal(previous.truncated, true);
  const capped = await executeCalculation(
    "return Array.from({length: 501}, (_, i) => ({i}));",
    noQuery,
    [],
  );
  assert.equal(capped.rows.length, 500);
  assert.equal(capped.truncated, true);
});

test("cancellation is passed to SQL and stops further queries", async () => {
  const controller = new AbortController();
  let calls = 0;
  const result = await executeCalculation(
    "sql('SELECT 1'); sql('SELECT 2'); return [];",
    async (sql, signal) => {
      calls++;
      controller.abort();
      assert.equal(signal.aborted, true);
      return step(sql);
    },
    [],
    { signal: controller.signal },
  );
  assert.ok(result.error);
  assert.equal(calls, 1);
});

test("chat exposes calculation rows to views and records nested SQL indexes", async () => {
  let calls = 0;
  const answer = await runChat(
    [],
    async (messages) => {
      if (++calls === 1)
        return JSON.stringify({
          type: "calculate",
          code: "return [{total: sql('SELECT amount FROM orders').rows.reduce((s,r) => s + Number(r.amount), 0)}];",
        });
      const result = JSON.parse(messages.at(-1).content);
      assert.equal(result.query, 1);
      assert.equal(result.sqlSteps[0].query, 0);
      assert.equal(result.queriesRemaining, MAX_QUERIES - 1);
      return JSON.stringify({
        type: "answer",
        text: "Total: 20",
        views: [{ type: "metric", title: "Total", query: 1, column: "total" }],
      });
    },
    async (sql) => step(sql),
  );
  assert.equal(answer.steps.length, 2);
  assert.deepEqual(answer.steps[1].rows, [{ total: 20 }]);
  assert.equal(answer.views[0].query, 1);
});

test("direct and nested SQL share a budget but calculation remains available", async () => {
  let calls = 0;
  let queries = 0;
  const answer = await runChat(
    [],
    async (messages) => {
      calls++;
      if (calls === 1)
        return JSON.stringify({ type: "query", sql: "SELECT 1" });
      if (calls === 2)
        return JSON.stringify({
          type: "calculate",
          code: "for (let i = 0; i < 20; i++) sql('SELECT 1'); return [];",
        });
      if (calls === 3) {
        assert.match(
          JSON.parse(messages.at(-1).content).error,
          /No queries remain/,
        );
        return JSON.stringify({
          type: "calculate",
          code: "return [{total: queryResults[0].rows[0].amount * 2}];",
        });
      }
      return JSON.stringify({ type: "answer", text: "Done", views: [] });
    },
    async (sql) => {
      queries++;
      return step(sql);
    },
  );
  assert.equal(queries, MAX_QUERIES);
  assert.deepEqual(answer.steps.at(-1).rows, [{ total: 24 }]);
});

test("repeated calculation failures are bounded and discovery is still required", async () => {
  const result = await runChat(
    [],
    async () =>
      JSON.stringify({
        type: "calculate",
        code: "throw Error('bad calculation');",
      }),
    noQuery,
  );
  assert.equal(result.steps.length, MAX_CALCULATIONS);
  let calls = 0;
  await runChat(
    [],
    async (messages) => {
      if (++calls === 1)
        return JSON.stringify({ type: "calculate", code: "return [];" });
      if (calls === 2) {
        assert.match(
          JSON.parse(messages.at(-1).content).error,
          /First choose a purpose/,
        );
        return JSON.stringify({ type: "discover", purpose: "Orders" });
      }
      return JSON.stringify({ type: "answer", text: "Done", views: [] });
    },
    noQuery,
    false,
    { required: true, discover: async () => ({ tables: [] }) },
  );
});
