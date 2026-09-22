import assert from "node:assert/strict";
import test from "node:test";
import { runChat, parseAnswer, MAX_QUERIES } from "../lib/chat.ts";

const step = (sql, rows = [{ total: 12 }]) => ({
  sql,
  rows,
  duration: 1,
  truncated: false,
});
const answer = {
  type: "answer",
  text: "12 orders",
  views: [{ type: "metric", title: "Orders", query: 1, column: "total" }],
};

test("required discovery keeps every system message before conversation history", async () => {
  const messages = [
    { role: "system", content: "instructions" },
    { role: "user", content: "earlier question" },
    { role: "assistant", content: "earlier answer" },
    { role: "user", content: "current question" },
  ];
  let calls = 0;
  await runChat(
    messages,
    async (input) => {
      const firstConversationMessage = input.findIndex(
        (message) => message.role !== "system",
      );
      assert.ok(firstConversationMessage > 0);
      assert.ok(
        input
          .slice(firstConversationMessage)
          .every((message) => message.role !== "system"),
      );
      return JSON.stringify(
        ++calls === 1
          ? { type: "discover", purpose: "find relevant tables" }
          : { type: "answer", text: "Done", views: [] },
      );
    },
    async () => assert.fail("No SQL expected"),
    false,
    { required: true, discover: async () => ({ tables: [] }) },
  );
  assert.equal(calls, 2);
});

test("the next model call sees the previous result and can query again", async () => {
  let calls = 0;
  const result = await runChat(
    [],
    async (messages) => {
      calls++;
      if (calls === 1)
        return JSON.stringify({
          type: "query",
          sql: "SELECT id FROM customers",
        });
      if (calls === 2) {
        assert.equal(JSON.parse(messages.at(-1).content).rows[0].id, 7);
        return JSON.stringify({
          type: "query",
          sql: "SELECT COUNT(*) AS total FROM orders WHERE customer_id = 7",
        });
      }
      assert.equal(JSON.parse(messages.at(-1).content).rows[0].total, 12);
      return JSON.stringify(answer);
    },
    async (sql) => step(sql, calls === 1 ? [{ id: 7 }] : [{ total: 12 }]),
  );
  assert.equal(result.steps.length, 2);
  assert.equal(result.views[0].query, 1);
});

test("failed queries can be corrected using the returned error", async () => {
  let calls = 0;
  const result = await runChat(
    [],
    async (messages) => {
      calls++;
      if (calls === 2)
        assert.equal(
          JSON.parse(messages.at(-1).content).error,
          "Unknown column",
        );
      return JSON.stringify(
        calls < 3
          ? { type: "query", sql: calls === 1 ? "bad" : "good" }
          : answer,
      );
    },
    async (sql) =>
      sql === "bad" ? { ...step(sql, []), error: "Unknown column" } : step(sql),
  );
  assert.equal(result.steps[0].error, "Unknown column");
  assert.equal(result.steps.length, 2);
});

test("query and malformed-response loops stop with a useful fallback", async () => {
  let queries = 0;
  const result = await runChat(
    [],
    async () => JSON.stringify({ type: "query", sql: "SELECT 1" }),
    async (sql) => {
      queries++;
      return step(sql);
    },
  );
  assert.equal(queries, MAX_QUERIES);
  assert.ok(result.text.includes("límite de pasos"));
  let calls = 0;
  await runChat(
    [],
    async () => {
      calls++;
      return "invalid";
    },
    async () => {
      throw Error("Must not run");
    },
  );
  assert.equal(calls, MAX_QUERIES + 3);
});

test("text answers require no queries and malformed views can be repaired", async () => {
  let calls = 0;
  const result = await runChat(
    [],
    async () =>
      JSON.stringify(
        ++calls === 1
          ? answer
          : { type: "answer", text: "Select a date range.", views: [] },
      ),
    async () => {
      throw Error("Must not query");
    },
  );
  assert.equal(result.steps.length, 0);
  assert.equal(calls, 2);
});

test("views reject invalid references and arbitrary executable content", () => {
  const steps = [step("SELECT 1", [{ month: "May", total: "12" }])];
  for (const view of [
    { type: "html", title: "x", query: 0 },
    { type: "table", title: "x", query: 4 },
    { type: "metric", title: "x", query: 0, column: "missing" },
    { type: "bars", title: "x", query: 0, column: "month", label: "total" },
  ])
    assert.throws(() => parseAnswer({ text: "x", views: [view] }, steps));
  const view = {
    type: "bars",
    title: "Orders",
    query: 0,
    column: "total",
    label: "month",
    animated: true,
    dangerouslySetInnerHTML: "bad",
  };
  const parsed = parseAnswer({ text: "x", views: [view] }, steps);
  assert.equal(parsed.views[0].animated, true);
  assert.equal(parsed.views[0].dangerouslySetInnerHTML, undefined);
  assert.throws(() =>
    parseAnswer({ text: "x", views: [view] }, [
      step("sql", [{ month: "May", total: -1 }]),
    ]),
  );
  assert.throws(() =>
    parseAnswer({ text: "x", views: [view] }, [step("sql", [])]),
  );
  assert.equal(
    parseAnswer(
      { text: "No rows", views: [{ type: "table", title: "Empty", query: 0 }] },
      [step("sql", [])],
    ).views.length,
    1,
  );
});

test("provider errors propagate instead of being hidden by retries", async () => {
  await assert.rejects(
    runChat(
      [],
      async () => {
        throw Error("OpenRouter request failed (401)");
      },
      async () => step(""),
    ),
    /401/,
  );
});
