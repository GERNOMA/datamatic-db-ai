import assert from "node:assert/strict";
import test from "node:test";
import { parseCatalog, validateCatalog, applyCatalog } from "../lib/catalog.ts";

const schema = [
  {
    name: "Candidates",
    description: "Old table",
    fields: [
      {
        name: "id",
        type: "int",
        nullable: false,
        key: "PRI",
        description: "Old ID",
      },
      {
        name: "name",
        type: "text",
        nullable: true,
        key: "",
        description: "Keep name",
      },
    ],
  },
  { name: "Other", description: "Keep table", fields: [] },
];
const parse = (entries) => parseCatalog(JSON.stringify(entries));

test("reads the Spanish catalog format and ignores SQL and metadata", () => {
  const catalog = parse([
    {
      tabla: "Candidates",
      descripcion: "New",
      sql: "DROP TABLE Candidates",
      activa: false,
      columnas: [{ nombre: "id", descripcion: "Identifier", en_sql: false }],
    },
  ]);
  assert.equal(validateCatalog(catalog, schema)[0].fields[0].exists, true);
  const updated = applyCatalog(catalog, schema);
  assert.equal(updated[0].description, "New");
  assert.equal(updated[0].fields[0].description, "Identifier");
  assert.deepEqual(updated[0].fields[1], schema[0].fields[1]);
  assert.equal(updated[1], schema[1]);
  assert.equal(schema[0].description, "Old table");
});

test("blank and omitted descriptions preserve existing values", () => {
  for (const descripcion of [undefined, "", "   "]) {
    const catalog = parse([
      {
        tabla: "Candidates",
        descripcion,
        columnas: [{ nombre: "id", descripcion }],
      },
    ]);
    assert.deepEqual(applyCatalog(catalog, schema), schema);
  }
});

test("reports missing tables and fields and refuses partial application", () => {
  const catalog = parse([
    { tabla: "Candidates", columnas: [{ nombre: "missing" }] },
    { tabla: "candidates", columnas: [{ nombre: "id" }] },
  ]);
  const result = validateCatalog(catalog, schema);
  assert.equal(result[0].exists, true);
  assert.equal(result[0].fields[0].exists, false);
  assert.equal(result[1].exists, false);
  assert.throws(() => applyCatalog(catalog, schema), /inexistentes/);
});

test("rejects malformed input and duplicates; accepts a BOM", () => {
  for (const text of ["no JSON", "null", "[]", "{}", '[{"tabla":"x"}]'])
    assert.throws(() => parseCatalog(text));
  for (const entry of [
    null,
    { tabla: "", columnas: [] },
    { tabla: "x", descripcion: 1, columnas: [] },
    { tabla: "x", columnas: [null] },
    { tabla: "x", columnas: [{ nombre: "id", descripcion: false }] },
    { tabla: "x", columnas: [{ nombre: "id" }, { nombre: "id" }] },
  ])
    assert.throws(() => parse([entry]));
  assert.throws(() =>
    parse([
      { tabla: "x", columnas: [] },
      { tabla: "x", columnas: [] },
    ]),
  );
  assert.equal(
    parseCatalog('\uFEFF[{"tabla":"x","columnas":[]}]')[0].tabla,
    "x",
  );
});
