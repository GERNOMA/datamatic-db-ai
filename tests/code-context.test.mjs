import assert from "node:assert/strict";
import test from "node:test";
import { readFile, unlink } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { strToU8, zipSync } from "fflate";
import { parseCodeModels, functionsForTables } from "../lib/code-context.ts";
import {
  decodeCodeArchive,
  saveCodeArchive,
  readCodeArchive,
} from "../lib/code-archive.ts";
import { discoverFunctions } from "../lib/jev.ts";
import { chatPrompt, runChat, MAX_DISCOVERIES } from "../lib/chat.ts";

const fn = {
  name: "restTime",
  class: "Shift",
  file: "Shift.php",
  line: 12,
  rawCode: "public function restTime() { return $this->end - $this->start; }",
};
const model = (name, table, functions = [fn]) => ({
  model: name,
  module: table,
  functions,
});
const entries = {
  "con-codigo/shift.json": strToU8(JSON.stringify(model("Shift", "shifts"))),
  "con-codigo/employee.json": strToU8(
    JSON.stringify(model("Employee", "employees")),
  ),
  "sin-codigo/ignore.json": strToU8("not parsed"),
};
const answer = JSON.stringify({ type: "answer", text: "Resultado", views: [] });

test("real RAR5 imports full code and saves the original archive across reads", async () => {
  const rar = await readFile(
    new URL("./fixtures/code-models.rar", import.meta.url),
  );
  const functions = await decodeCodeArchive(rar, "code-models.rar");
  assert.equal(functions.length, 1);
  assert.equal(
    functions[0].rawCode,
    "public function restTime() { return 60; }",
  );
  const id = `test-${randomUUID()}`;
  try {
    await saveCodeArchive(id, rar, "code-models.rar");
    const saved = await readCodeArchive(id);
    assert.deepEqual(saved.functions, functions);
    assert.deepEqual(Buffer.from(saved.data, "base64"), rar);
    assert.equal(await readCodeArchive(`${id}-other-db`), null);
    await assert.rejects(
      saveCodeArchive(id, new Uint8Array([1, 2]), "bad.rar"),
    );
    assert.equal((await readCodeArchive(id)).info.name, "code-models.rar");
    await saveCodeArchive(id, zipSync(entries), "replacement.zip");
    assert.equal((await readCodeArchive(id)).info.name, "replacement.zip");
  } finally {
    await unlink(
      path.join(
        process.cwd(),
        ".datamatic",
        "code",
        `${createHash("sha256").update(id).digest("hex")}.json`,
      ),
    ).catch(() => {});
  }
});

test("full-code ZIP import deduplicates functions while preserving all model/table links", async () => {
  const functions = await decodeCodeArchive(zipSync(entries), "models.zip");
  assert.equal(functions.length, 1);
  assert.equal(functions[0].rawCode, fn.rawCode);
  assert.deepEqual(functions[0].tables, ["shifts", "employees"]);
  assert.equal(functionsForTables(functions, ["employees"]).length, 1);
  assert.equal(functionsForTables(functions, ["unrelated"]).length, 0);
  assert.throws(
    () =>
      parseCodeModels({
        "con-codigo/bad.json": strToU8(
          JSON.stringify(model("Bad", "bad", [{ ...fn, rawCode: undefined }])),
        ),
      }),
    /código completo/,
  );
  assert.throws(
    () =>
      parseCodeModels({
        ...entries,
        "con-codigo/conflict.json": strToU8(
          JSON.stringify(
            model("Conflict", "shifts", [{ ...fn, rawCode: "different" }]),
          ),
        ),
      }),
    /contradictorio/,
  );
  await assert.rejects(
    decodeCodeArchive(
      zipSync({ "simplificado/a.json": strToU8("{}") }),
      "empty.zip",
    ),
    /con-codigo/,
  );
  await assert.rejects(decodeCodeArchive(new Uint8Array([1, 2]), "bad.rar"));
});

test("JEV sends full function code in parallel and applies a strict threshold", async () => {
  const source = parseCodeModels(entries)[0];
  const functions = [0, 1, 2].map((n) => ({ ...source, id: String(n) }));
  let started = 0;
  let release;
  const allStarted = new Promise((resolve) => {
    release = resolve;
  });
  const matches = await discoverFunctions(
    functions,
    "calculate rest time",
    "key",
    new AbortController().signal,
    0.6,
    async (_, init) => {
      const request = JSON.parse(init.body);
      assert.equal(request.state.function.rawCode, fn.rawCode);
      assert.match(
        request.questions.useful.instructions,
        /calculate rest time/,
      );
      if (++started === functions.length) release();
      await allStarted;
      return Response.json({
        answers: {
          useful: {
            type: "noul",
            noul: [0.9, 0.6, 0.1][Number(request.state.function.id)],
          },
        },
      });
    },
  );
  assert.deepEqual(
    matches.map((f) => f.id),
    ["0"],
  );
  assert.equal(matches[0].purpose, "calculate rest time");
  await assert.rejects(
    discoverFunctions(
      functions,
      "purpose",
      "key",
      new AbortController().signal,
      NaN,
    ),
    /probabilidad/,
  );
  await assert.rejects(
    discoverFunctions(
      [source],
      "purpose",
      "key",
      new AbortController().signal,
      0.6,
      async () =>
        Response.json({ answers: { useful: { type: "noul", noul: 2 } } }),
    ),
    /probabilidad/,
  );
});

test("optional function discovery exposes only matching code and supports follow-up context", async () => {
  const selected = [];
  const messages = [
    { role: "system", content: chatPrompt(false, false, true) },
  ];
  let turn = 0;
  await runChat(
    messages,
    async () =>
      ++turn === 1
        ? JSON.stringify({ type: "discover_functions", purpose: "rest time" })
        : answer,
    async () => {
      throw new Error("No SQL needed");
    },
    false,
    undefined,
    async () => {
      selected.push({
        ...parseCodeModels(entries)[0],
        probability: 0.95,
        purpose: "rest time",
      });
      return { functions: selected };
    },
  );
  assert.equal(
    JSON.parse(messages.find((m) => m.role === "user").content)
      .functionDiscovery.functions[0].rawCode,
    fn.rawCode,
  );
  const followup = [
    { role: "system", content: JSON.stringify({ functions: selected }) },
  ];
  await runChat(
    followup,
    async (m) => {
      assert.equal(JSON.parse(m[0].content).functions[0].rawCode, fn.rawCode);
      return answer;
    },
    async () => {},
  );
  assert.doesNotMatch(chatPrompt(false), /discover_functions/);
});

test("function sweeps have their own budget and provider failures are not retried", async () => {
  let calls = 0;
  await runChat(
    [],
    async () => JSON.stringify({ type: "discover_functions", purpose: "rest" }),
    async () => {},
    false,
    undefined,
    async () => {
      calls++;
      return [];
    },
  );
  assert.equal(calls, MAX_DISCOVERIES);
  let attempts = 0;
  await assert.rejects(
    runChat(
      [],
      async () => {
        attempts++;
        return JSON.stringify({ type: "discover_functions", purpose: "rest" });
      },
      async () => {},
      false,
      undefined,
      async () => {
        throw new Error("provider unavailable");
      },
    ),
    /provider unavailable/,
  );
  assert.equal(attempts, 1);
});
