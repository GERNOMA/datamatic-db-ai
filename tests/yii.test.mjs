import test from "node:test";
import assert from "node:assert/strict";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { analyzeYii, modelJson } from "../lib/yii-analysis.ts";
import { readPhpArchive, exportYiiZip } from "../lib/yii-files.ts";

const sources = [
  {
    path: "common/models/Order.php",
    code: `<?php namespace common\u005cmodels;
use yii\u005cdb\u005cActiveRecord as Record;
class Order extends Record {
 public static function tableName() { return '{{%sales_order}}'; }
 public function label() { return "Order { text }"; }
}`,
  },
  {
    path: "frontend/models/OrderSearch.php",
    code: `<?php namespace frontend\u005cmodels; class OrderSearch extends \u005ccommon\u005cmodels\u005cOrder { public function search() { return static::find(); } }`,
  },
  {
    path: "api/controllers/OrdersController.php",
    code: `<?php namespace api\u005ccontrollers;
use common\u005cmodels\u005c{Order as Purchase};
class OrdersController extends \u005cyii\u005cweb\u005cController {
 public function actionView($id) { return $this->findModel($id); }
 protected function findModel($id) { return Purchase::findOne($id); }
 public function unused() { /* Purchase::find(); */ return 'Purchase'; }
 public function typed(Purchase $order) { return $order->id; }
}`,
  },
  {
    path: "services/Export.php",
    code: `<?php namespace services; class Export { public function run() { return \u005ccommon\u005cmodels\u005cOrder::find()->all(); } }`,
  },
];
test("default table names follow Yii camel-case splitting, including acronyms", () => {
  const result = analyzeYii([
    {
      path: "URLRecord.php",
      code: "<?php class URLRecord extends \\yii\\db\\ActiveRecord {}",
    },
  ]);
  assert.equal(result.models[0].module, "u_r_l_record");
  assert.equal(result.models[0].tableResolution, "convention");
});
test("detects ActiveRecord models, inherited tables, aliases and controller helper calls", () => {
  const result = analyzeYii(sources);
  assert.deepEqual(result.warnings, []);
  assert.equal(result.models.length, 2);
  const order = result.models.find((m) => m.model === "common\\models\\Order");
  assert.equal(order.module, "sales_order");
  assert.equal(order.tableExpression, "{{%sales_order}}");
  assert.ok(
    order.functions.some(
      (f) =>
        f.name === "actionView" &&
        f.controller === "api\\controllers\\OrdersController" &&
        f.usage.some((u) => u.startsWith("via:")),
    ),
  );
  assert.ok(order.functions.some((f) => f.name === "typed"));
  assert.ok(
    order.functions.some(
      (f) =>
        f.name === "run" &&
        f.controller === null &&
        f.class === "services\\Export",
    ),
  );
  assert.ok(!order.functions.some((f) => f.name === "unused"));
  assert.equal(result.models[1].tableResolution, "inherited");
  assert.equal(result.models[1].module, "sales_order");
});
test("preserves raw function and body verbatim including comments, strings and nested closures", () => {
  const raw = `public function exact() {\r\n // español }\r\n $f = function () { return '}'; };\r\n return $f();\r\n}`;
  const result = analyzeYii([
    {
      path: "M.php",
      code: `<?php class M extends \\yii\\db\\ActiveRecord { ${raw} }`,
    },
  ]);
  const fn = result.models[0].functions[0];
  assert.equal(fn.rawCode, raw);
  assert.equal(fn.body, raw.slice(raw.indexOf("{") + 1, -1));
  assert.equal(
    JSON.parse(modelJson(result.models[0], false)).functions[0].rawCode,
    undefined,
  );
  assert.equal(
    JSON.parse(modelJson(result.models[0], true)).functions[0].rawCode,
    raw,
  );
});
test("reports broken files and dynamic tables without aborting valid models", () => {
  const result = analyzeYii([
    ...sources,
    { path: "broken.php", code: "<?php class {" },
    {
      path: "dynamic.php",
      code: `<?php class Dynamic extends \\yii\\db\\ActiveRecord { public static function tableName() { return getenv('TABLE'); } }`,
    },
  ]);
  assert.equal(result.models.length, 3);
  assert.equal(result.models.find((m) => m.model === "Dynamic").module, null);
  assert.ok(result.warnings.some((w) => w.includes("broken.php")));
  assert.ok(result.warnings.some((w) => w.includes("dinámico")));
});
test("same short class names in different namespaces do not collide", () => {
  const result = analyzeYii([
    ...sources,
    {
      path: "other.php",
      code: `<?php namespace other; class Order extends \\yii\\db\\ActiveRecord {} class Service { function test() { return Order::find(); } }`,
    },
  ]);
  assert.ok(!result.models[0].functions.some((f) => f.name === "test"));
  assert.ok(
    result.models
      .find((m) => m.model === "other\\Order")
      .functions.some((f) => f.name === "test"),
  );
});
test("nested ZIP entries load and export three JSON variants per model", () => {
  const archive = zipSync(
    Object.fromEntries([
      ...sources.map((s) => [s.path, strToU8(s.code)]),
      ["readme.txt", strToU8("ignored")],
    ]),
  );
  const loaded = readPhpArchive(archive);
  assert.equal(loaded.length, sources.length);
  assert.equal(loaded[0].path, sources[0].path);
  const result = analyzeYii(loaded);
  const exported = unzipSync(exportYiiZip(result));
  assert.equal(Object.keys(exported).length, result.models.length * 3 + 1);
  for (const [path, bytes] of Object.entries(exported)) {
    const json = JSON.parse(strFromU8(bytes));
    if (path.startsWith("con-codigo"))
      assert.equal(typeof json.functions[0].rawCode, "string");
    if (path.startsWith("sin-codigo"))
      assert.equal(json.functions[0].rawCode, undefined);
    if (path.startsWith("simplificado"))
      assert.deepEqual(Object.keys(json.functions[0]).sort(), ["file", "name"]);
  }
});
