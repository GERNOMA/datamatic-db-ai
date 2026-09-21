import test from "node:test";
import assert from "node:assert/strict";
import { zipSync, strToU8 } from "fflate";
import {
  importYiiZip,
  groupTableUsage,
  reviewTableUsage,
} from "../lib/yii-import.ts";
import { analyzeYii } from "../lib/yii-analysis.ts";
import { exportYiiZip } from "../lib/yii-files.ts";

const fn = (owner, name = "find") => ({
  name,
  file: "some/file.php",
  class: owner,
});
const model = (name, module, functions) => ({ model: name, module, functions });
test("database tables absent from the ZIP and own-only models are marked NOT USED", () => {
  assert.deepEqual(
    reviewTableUsage(
      [
        { name: "active", externallyUsed: true, functions: [] },
        { name: "own_only", externallyUsed: false, functions: [] },
      ],
      [{ name: "active" }, { name: "own_only" }, { name: "missing" }],
    ),
    [
      { name: "active", detected: true, notUsed: false },
      { name: "own_only", detected: true, notUsed: true },
      { name: "missing", detected: false, notUsed: true },
    ],
  );
});
const zip = (models, extras = {}) =>
  zipSync(
    Object.fromEntries([
      ...models.map((m, i) => [
        `nested/sin-codigo/${i}.json`,
        strToU8(JSON.stringify(m)),
      ]),
      ...Object.entries(extras).map(([name, value]) => [
        name,
        strToU8(JSON.stringify(value)),
      ]),
    ]),
  );

test("only own-class methods means unused; external, inherited and global owners count as use", () => {
  const imported = importYiiZip(
    zip([
      model("app\\Employee", "employee", [fn("\\APP\\Employee")]),
      model("app\\Order", "order", [fn("app\\OrderController")]),
      model("app\\Global", "global", [fn(null)]),
      model("app\\Child", "child", [fn("app\\Parent")]),
      model("app\\Empty", "empty", []),
    ]),
  );
  assert.deepEqual(
    imported.models.map((m) => m.externallyUsed),
    [false, true, true, true, false],
  );
});
test("shared tables remain used if any model has external use; unknown modules are skipped", () => {
  const imported = importYiiZip(
    zip([
      model("Base", "shared", [fn("Base")]),
      model("Child", "shared", [fn("Controller")]),
      model("Dynamic", null, []),
    ]),
  );
  const usage = groupTableUsage(imported.models);
  assert.equal(usage.length, 1);
  assert.equal(usage[0].externallyUsed, true);
  assert.equal(usage[0].functions.length, 1);
  assert.match(imported.warnings[0], /sin resolver/);
});
test("ignores code variants and refuses incomplete owner metadata instead of excluding silently", () => {
  const imported = importYiiZip(
    zip([model("Employee", "employee", [fn("Employee")])], {
      "con-codigo/other.json": model("Employee", "employee", [
        fn("Controller"),
      ]),
    }),
  );
  assert.equal(imported.models[0].externallyUsed, false);
  assert.throws(
    () =>
      importYiiZip(
        zip([model("Employee", "employee", [{ name: "test", file: "x.php" }])]),
      ),
    /class/,
  );
  assert.throws(() => importYiiZip(zip([])), /sin-codigo/);
});
test("new archives round-trip and simplified context contains only function name and file", () => {
  const analysis = analyzeYii([
    {
      path: "Employee.php",
      code: "<?php class Employee extends \\yii\\db\\ActiveRecord { public function foo() { return 1; } }",
    },
  ]);
  const result = importYiiZip(exportYiiZip(analysis));
  assert.equal(result.models[0].module, "employee");
  assert.equal(result.models[0].externallyUsed, false);
  assert.deepEqual(result.models[0].functions, [
    { name: "foo", file: "Employee.php" },
  ]);
  assert.deepEqual(result.warnings, []);
});
test("tampered simple files cannot override the authoritative no-code mapping", () => {
  const result = importYiiZip(
    zip([model("Employee", "employee", [fn("Controller")])], {
      "nested/simplificado/0.json": model("Employee", "employee", [
        { name: "invented", file: "secret.php", rawCode: "secret" },
      ]),
    }),
  );
  assert.deepEqual(result.models[0].functions, [
    { name: "find", file: "some/file.php" },
  ]);
  assert.equal(result.warnings.length, 1);
});
