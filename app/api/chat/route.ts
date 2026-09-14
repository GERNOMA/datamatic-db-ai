import { checkOrigin, getSession, openDatabase } from "@/lib/database";
import { validateQuery } from "@/lib/sql";
import type { Table } from "@/lib/types";
import type { Connection as MySQLConnection } from "mysql2";
export const runtime = "nodejs";

export async function POST(request: Request) {
  let connection;
  try {
    checkOrigin(request);
    const session = await getSession();
    const body = await request.json();
    if (!session.apiKey)
      throw new Error("Add your OpenRouter API key in Connect.");
    if (
      typeof body.question !== "string" ||
      !body.question.trim() ||
      body.question.length > 8000
    )
      throw new Error("Enter a question of up to 8,000 characters.");
    if (!Array.isArray(body.tables) || !body.tables.length)
      throw new Error("Select a group containing at least one table.");
    const schema = body.tables.map((provided: Table) => {
      const actual = session.tables.find((t) => t.name === provided.name);
      if (!actual)
        throw new Error(
          "A selected table no longer exists. Reconnect to refresh the schema.",
        );
      return {
        name: actual.name,
        ...(provided.description
          ? { description: String(provided.description).slice(0, 2000) }
          : {}),
        fields: actual.fields.map((field) => {
          const description = provided.fields?.find(
            (f) => f.name === field.name,
          )?.description;
          return {
            name: field.name,
            type: field.type,
            ...(description
              ? { description: String(description).slice(0, 2000) }
              : {}),
          };
        }),
      };
    });
    const response = await fetch(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.apiKey}`,
          "Content-Type": "application/json",
        },
        signal: AbortSignal.timeout(60000),
        body: JSON.stringify({
          model: session.model,
          temperature: 0,
          max_tokens: 2000,
          messages: [
            {
              role: "system",
              content:
                "Return ONLY one read-only MySQL query, without markdown or explanation. Use only the supplied tables and columns. Use unqualified table names. If the question cannot be answered explain why.",
            },
            { role: "system", content: JSON.stringify({ tables: schema }) },
            ...(Array.isArray(body.history)
              ? body.history
                  .slice(-6)
                  .filter(
                    (m: { role: string; content: string }) =>
                      ["user", "assistant"].includes(m.role) &&
                      typeof m.content === "string",
                  )
                  .map((m: { role: string; content: string }) => ({
                    role: m.role,
                    content: m.content.slice(0, 8000),
                  }))
              : []),
            { role: "user", content: body.question },
          ],
        }),
      },
    );
    if (!response.ok)
      throw new Error(
        `OpenRouter request failed (${response.status}). Check your API key, credits and model in Connect.`,
      );
    const completion = await response.json();
    const content = completion.choices?.[0]?.message?.content;
    if (typeof content !== "string")
      throw new Error("The model did not return a query. Try again.");
    const sql = validateQuery(
      content,
      schema.map((t: Table) => t.name),
    );
    connection = await openDatabase(session.url);
    await connection.query("SET SESSION MAX_EXECUTION_TIME = 10000");
    await connection.query("SET SESSION SQL_SELECT_LIMIT = 501");
    await connection.query("START TRANSACTION READ ONLY");
    const started = Date.now();
    // Stream rows so an explicit large LIMIT cannot make the server buffer unlimited results.
    const rows: unknown[] = [];
    // mysql2's promise connection exposes its underlying streaming connection.
    const rawConnection = (
      connection as unknown as { connection: MySQLConnection }
    ).connection;
    const stream = rawConnection.query(sql).stream({ highWaterMark: 1 });
    let bytes = 0;
    let truncated = false;
    for await (const row of stream) {
      bytes += Buffer.byteLength(JSON.stringify(row));
      if (rows.length === 500 || bytes > 2_000_000) {
        truncated = true;
        stream.destroy();
        connection.destroy();
        connection = undefined;
        break;
      }
      rows.push(row);
    }
    if (connection) await connection.query("ROLLBACK");
    return Response.json({
      sql,
      rows,
      truncated,
      duration: Date.now() - started,
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Query failed. Please try again.";
    return Response.json(
      {
        error: /SQL syntax|Unknown column|doesn't exist/i.test(message)
          ? "The generated query did not match the schema. Try rephrasing your question or adding descriptions."
          : message,
      },
      { status: 400 },
    );
  } finally {
    await connection?.end();
  }
}
