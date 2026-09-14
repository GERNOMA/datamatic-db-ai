import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { chatPrompt, parseAnswer, runChat } from "../lib/chat.ts";
import { visualizationDocument } from "../lib/visualization.ts";

const steps = [
  {
    sql: "SELECT total FROM orders",
    rows: [{ total: 12 }],
    duration: 1,
    truncated: false,
  },
];
const html =
  '<button onclick="this.textContent = window.queryResults[0].rows[0].total">Show total</button>';

test("free mode accepts custom code only when enabled", () => {
  const answer = { text: "Orders", html };
  assert.equal(parseAnswer(answer, steps, true).html, html);
  assert.throws(() => parseAnswer({ ...answer, views: [] }, steps), /disabled/);
  for (const invalid of [null, 123, "", " ", "x".repeat(60001)])
    assert.throws(
      () => parseAnswer({ ...answer, html: invalid }, steps, true),
      /HTML string/,
    );
  assert.deepEqual(
    parseAnswer({ text: "No visualization needed" }, [], true).views,
    [],
  );
});

test("free mode has no prescribed chart format and retains query restrictions", () => {
  const prompt = chatPrompt(true);
  assert.ok(prompt.includes("read-only SELECT"));
  assert.ok(prompt.includes("window.queryResults"));
  assert.ok(prompt.includes('"html"'));
  assert.ok(!prompt.includes('"type":"bars"'));
  assert.ok(
    !prompt.includes("do not copy data into the view or return JavaScript"),
  );
  assert.ok(chatPrompt(false).includes('"type":"bars"'));
});

test("the query loop returns a free webpage after feeding back real results", async () => {
  let calls = 0;
  const result = await runChat(
    [],
    async (messages) => {
      if (++calls === 1)
        return JSON.stringify({ type: "query", sql: steps[0].sql });
      assert.equal(JSON.parse(messages.at(-1).content).rows[0].total, 12);
      return JSON.stringify({ type: "answer", text: "Orders", html });
    },
    async () => steps[0],
    true,
  );
  assert.equal(result.html, html);
  assert.deepEqual(result.steps, steps);
});

test("preview data cannot terminate its script and is available without transformation", () => {
  const dangerous =
    '</script><script>throw new Error("injected")</script>\u2028\u2029';
  const data = [{ ...steps[0], rows: [{ value: dangerous }] }];
  const document = visualizationDocument(html, data);
  assert.ok(
    document.indexOf("Content-Security-Policy") < document.indexOf("<script>"),
  );
  assert.ok(document.includes("connect-src 'none'"));
  assert.ok(document.includes("base-uri 'none'"));
  const script = document.match(/<script>(.*?)<\/script>/s)[1];
  assert.ok(!script.includes("</script>"));
  const context = { window: {} };
  vm.runInNewContext(script, context);
  assert.equal(context.window.queryResults[0].rows[0].value, dangerous);
  assert.ok(document.includes(html));
});
