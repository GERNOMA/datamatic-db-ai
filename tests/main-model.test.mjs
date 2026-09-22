import assert from "node:assert/strict";
import test from "node:test";
import {
  mainModelProvider,
  mainModelRequest,
  mainModelError,
} from "../lib/main-model.ts";
import { runChat } from "../lib/chat.ts";

test("Cerebras gets exactly one initial system message across discovery and follow-up turns", async () => {
  for (const required of [false, true]) {
    const messages = [
      { role: "system", content: "instructions" },
      { role: "system", content: '{"tables":[]}' },
      { role: "system", content: '{"functions":[]}' },
      { role: "user", content: "earlier question" },
      { role: "assistant", content: "earlier answer" },
      { role: "user", content: "current question" },
    ];
    let calls = 0;
    await runChat(
      messages,
      async (input) => {
        const before = structuredClone(input);
        const request = mainModelRequest(
          { apiKey: "", useCerebras: true, model: "gpt-oss-120b" },
          input,
          false,
        );
        assert.equal(request.messages[0].role, "system");
        assert.equal(
          request.messages.filter((m) => m.role === "system").length,
          1,
        );
        for (const message of input.filter((m) => m.role === "system"))
          assert.ok(request.messages[0].content.includes(message.content));
        assert.deepEqual(
          request.messages.slice(1),
          input.filter((m) => m.role !== "system"),
        );
        assert.deepEqual(input, before);
        assert.deepEqual(
          mainModelRequest(
            { apiKey: "key", model: "openrouter/auto" },
            input,
            false,
          ).messages,
          input,
        );
        return JSON.stringify(
          ++calls === 1
            ? { type: "discover", purpose: "find tables" }
            : { type: "answer", text: "Listo", views: [] },
        );
      },
      async () => assert.fail("No SQL expected"),
      false,
      { required, discover: async () => ({ tables: [] }) },
    );
    assert.equal(calls, 2);
  }
});

test("Cerebras does not receive OpenRouter's fixed token budget in either mode", () => {
  const settings = {
    apiKey: "router-key",
    useCerebras: true,
    model: "gpt-oss-120b",
  };
  const messages = [{ role: "user", content: "Hello" }];
  for (const freeVisualization of [false, true]) {
    const request = mainModelRequest(settings, messages, freeVisualization);
    assert.equal("max_tokens" in request, false);
    assert.equal("max_completion_tokens" in request, false);
    assert.deepEqual(request.messages, messages);
    assert.equal(request.model, settings.model);
    assert.equal(
      mainModelRequest(
        { ...settings, useCerebras: false },
        messages,
        freeVisualization,
      ).max_tokens,
      freeVisualization ? 120000 : 30000,
    );
  }
});

test("provider errors retain the rejection reason and redact the key", async () => {
  const provider = mainModelProvider({
    apiKey: "",
    useCerebras: true,
    cerebrasApiKey: "secret-key",
  });
  const error = await mainModelError(
    Response.json(
      { error: { message: "Invalid model for secret-key" } },
      { status: 400 },
    ),
    provider,
  );
  assert.match(error.message, /Cerebras.*400.*Invalid model/);
  assert.equal(error.message.includes("secret-key"), false);
  const fallback = await mainModelError(
    new Response("<html>Gateway error</html>", { status: 502 }),
    provider,
  );
  assert.match(fallback.message, /502.*Revisa/);
});

test("existing sessions default to OpenRouter", () => {
  assert.deepEqual(mainModelProvider({ apiKey: "router-key" }), {
    name: "OpenRouter",
    url: "https://openrouter.ai/api/v1/chat/completions",
    apiKey: "router-key",
  });
});

test("Cerebras uses its own endpoint and key without falling back to OpenRouter", () => {
  const settings = {
    apiKey: "router-key",
    useCerebras: true,
    cerebrasApiKey: "cerebras-key",
  };
  assert.deepEqual(mainModelProvider(settings), {
    name: "Cerebras",
    url: "https://api.cerebras.ai/v1/chat/completions",
    apiKey: "cerebras-key",
  });
  assert.equal(
    mainModelProvider({ ...settings, cerebrasApiKey: "" }).apiKey,
    "",
  );
  assert.equal(
    mainModelProvider({ ...settings, useCerebras: false }).apiKey,
    "router-key",
  );
});
