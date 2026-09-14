import assert from "node:assert/strict";
import test from "node:test";
import { checkOrigin } from "../lib/request-origin.ts";

test("accepts the browser host when Next exposes an internal localhost URL", () => {
  for (const host of [
    "localhost:3000",
    "127.0.0.1:3000",
    "192.168.1.100:3000",
  ]) {
    assert.doesNotThrow(() =>
      checkOrigin(
        new Request("http://localhost:3000/api/connect", {
          headers: { host, origin: `http://${host}` },
        }),
      ),
    );
  }
});

test("rejects foreign origins, mismatched ports, and forwarded-host spoofing", () => {
  for (const origin of [
    "http://evil.example",
    "http://localhost:4000",
    "null",
    "http://localhost:3000",
  ]) {
    assert.throws(
      () =>
        checkOrigin(
          new Request("http://localhost:3000/api/connect", {
            headers: {
              host: "192.168.1.100:3000",
              origin,
              "x-forwarded-host": origin.replace("http://", ""),
            },
          }),
        ),
      /Invalid request origin/,
    );
  }
});
