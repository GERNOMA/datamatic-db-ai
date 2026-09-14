import assert from "node:assert/strict";
import test from "node:test";
import { validateQuery } from "../lib/sql.ts";

const tables = ["workers", "company", "workers_route"];
for (const sql of [
  "SELECT COUNT(*) FROM workers",
  "SELECT w.id, c.name FROM workers w JOIN company c ON w.company_id = c.id LIMIT 10;",
  "SELECT LOWER(name), COUNT(*) FROM workers GROUP BY LOWER(name)",
  "SELECT * FROM workers WHERE id IN (SELECT worker_id FROM workers_route)",
  "SELECT NULL AS unavailable WHERE 1=0",
]) {
  test(`accepts ${sql}`, () => assert.ok(validateQuery(sql, tables)));
}
for (const sql of [
  "DELETE FROM workers",
  "UPDATE workers SET name = 1",
  "DROP TABLE workers",
  "SELECT * FROM workers; DELETE FROM workers",
  "SELECT * FROM private_table",
  "SELECT * FROM other_db.workers",
  "SELECT * FROM information_schema.tables",
  "SELECT * FROM workers UNION SELECT * FROM private_table",
  "SELECT * FROM workers WHERE id IN (SELECT id FROM private_table)",
  "SELECT SLEEP(10)",
  "SELECT BENCHMARK(1000000, 1)",
  'SELECT LOAD_FILE("/etc/passwd")',
  "SELECT change_data() FROM workers",
  "SELECT evil.ABS(1)",
  'SELECT GET_LOCK("x", 10)',
  'SELECT * FROM workers INTO OUTFILE "output.txt"',
  "SELECT * FROM workers FOR UPDATE",
  "SELECT @secret",
  "SELECT 1 /* comment */",
  "SELECT 1 -- comment",
  "```sql\nSELECT * FROM workers\n```",
]) {
  test(`rejects ${sql}`, () => assert.throws(() => validateQuery(sql, tables)));
}
