import { newAsyncContext } from "quickjs-emscripten";
import type { QueryStep } from "./types.ts";

export const MAX_CALCULATIONS = 5;
export const MAX_CODE_LENGTH = 16000;

// Each invocation owns a separate WASM interpreter. Never evaluate generated code
// in Node: the only host capability exposed here is the validated SQL callback.
export async function executeCalculation(
  code: string,
  query: (sql: string, signal: AbortSignal) => Promise<QueryStep>,
  steps: QueryStep[],
  options: { signal?: AbortSignal; cpuMs?: number } = {},
): Promise<QueryStep> {
  const started = Date.now();
  const result: QueryStep = {
    kind: "calculation",
    code,
    sql: "",
    rows: [],
    duration: 0,
    truncated: steps.some((step) => step.truncated),
  };
  try {
    if (!code.trim() || code.length > MAX_CODE_LENGTH)
      throw new Error("Code must contain 1 to 16,000 characters.");
    const signal = AbortSignal.any([
      ...(options.signal ? [options.signal] : []),
      AbortSignal.timeout(30000),
    ]);
    signal.throwIfAborted();
    const vm = await newAsyncContext();
    let deadline = Date.now() + (options.cpuMs ?? 2000);
    vm.runtime.setMemoryLimit(32 * 1024 * 1024);
    vm.runtime.setMaxStackSize(512 * 1024);
    vm.runtime.setInterruptHandler(
      () => signal.aborted || Date.now() > deadline,
    );
    try {
      const sql = vm.newAsyncifiedFunction("__sql", async (input) => {
        signal.throwIfAborted();
        if (!input || vm.typeof(input) !== "string")
          throw new Error("sql() needs a SELECT string.");
        const statement = vm.getString(input);
        if (!statement.trim() || statement.length > 16000)
          throw new Error("SQL must contain 1 to 16,000 characters.");
        const waiting = Date.now();
        try {
          const step = await query(statement, signal);
          result.truncated ||= step.truncated;
          signal.throwIfAborted();
          if (step.error) throw new Error(step.error);
          return vm.newString(JSON.stringify(step));
        } finally {
          deadline += Date.now() - waiting;
        }
      });
      vm.setProp(vm.global, "__sql", sql);
      sql.dispose();
      const previous = vm.newString(JSON.stringify(steps));
      vm.setProp(vm.global, "__previous", previous);
      previous.dispose();
      const evaluated = await vm.evalCodeAsync(
        `(() => {
        const parse = JSON.parse, stringify = JSON.stringify;
        const bridge = globalThis.__sql;
        const queryResults = parse(globalThis.__previous);
        delete globalThis.__sql; delete globalThis.__previous;
        const sql = (statement) => parse(bridge(statement));
        const value = (function(sql, queryResults) { "use strict";\n${code}\n})(sql, queryResults);
        if (value && typeof value.then === "function") throw new Error("Return rows synchronously; sql() already waits for its result.");
        return stringify(value);
      })()`,
        "calculation.js",
      );
      const handle = vm.unwrapResult(evaluated);
      let json: string;
      try {
        if (vm.typeof(handle) !== "string")
          throw new Error("Return an array of JSON row objects.");
        json = vm.getString(handle);
      } finally {
        handle.dispose();
      }
      signal.throwIfAborted();
      if (Buffer.byteLength(json) > 100000)
        throw new Error(
          "Calculation output exceeds 100 KB. Return a smaller summary.",
        );
      const rows: unknown = JSON.parse(json);
      if (
        !Array.isArray(rows) ||
        rows.some(
          (row) => !row || typeof row !== "object" || Array.isArray(row),
        )
      )
        throw new Error("Return an array of JSON row objects.");
      result.rows = rows.slice(0, 500);
      result.truncated ||= rows.length > 500;
    } finally {
      vm.dispose();
    }
  } catch (error) {
    result.error =
      error instanceof Error ? error.message : "Calculation failed.";
  }
  result.duration = Date.now() - started;
  return result;
}
