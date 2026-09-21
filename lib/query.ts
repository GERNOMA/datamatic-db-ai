import { openDatabase } from "./database";
import { validateQuery } from "./sql";
import type { QueryStep } from "./types";
import type { Connection as MySQLConnection } from "mysql2";

// Every step gets its own bounded, read-only connection, closed before calling AI again.
export async function executeQuery(
  input: string,
  tables: string[],
  url: string,
  signal?: AbortSignal,
): Promise<QueryStep> {
  const started = Date.now();
  let connection: Awaited<ReturnType<typeof openDatabase>> | undefined;
  let sql = input;
  const rows: Record<string, unknown>[] = [];
  let truncated = false;
  const cancel = () => connection?.destroy();
  try {
    signal?.throwIfAborted();
    sql = validateQuery(input, tables);
    connection = await openDatabase(url);
    signal?.addEventListener("abort", cancel, { once: true });
    signal?.throwIfAborted();
    await connection.query("SET SESSION MAX_EXECUTION_TIME = 10000");
    await connection.query("SET SESSION SQL_SELECT_LIMIT = 501");
    await connection.query("START TRANSACTION READ ONLY");
    const rawConnection = (
      connection as unknown as { connection: MySQLConnection }
    ).connection;
    const stream = rawConnection.query(sql).stream({ highWaterMark: 1 });
    let bytes = 0;
    for await (const row of stream) {
      bytes += Buffer.byteLength(JSON.stringify(row));
      if (rows.length === 500 || bytes > 100_000) {
        truncated = true;
        stream.destroy();
        connection.destroy();
        connection = undefined;
        break;
      }
      rows.push(row);
    }
    if (connection) await connection.query("ROLLBACK");
    return { sql, rows, truncated, duration: Date.now() - started };
  } catch (error) {
    // Return query failures to the AI so it can correct its next attempt.
    return {
      sql,
      rows: [],
      truncated: false,
      duration: Date.now() - started,
      error: error instanceof Error ? error.message : "La consulta ha fallado.",
    };
  } finally {
    signal?.removeEventListener("abort", cancel);
    await connection?.end();
  }
}
