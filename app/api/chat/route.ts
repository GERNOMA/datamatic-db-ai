import { checkOrigin, getSession, openDatabase } from "@/lib/database";
import { validateQuery } from "@/lib/sql";
import { chatPrompt, runChat, type Message } from "@/lib/chat";
import type { QueryStep, Table } from "@/lib/types";
import type { Connection as MySQLConnection } from "mysql2";
export const runtime = "nodejs";

export async function POST(request: Request) {
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
    const freeVisualization = body.freeVisualization === true;
    const messages: Message[] = [
      { role: "system", content: chatPrompt(freeVisualization) },
      { role: "system", content: JSON.stringify({ tables: schema }) },
      ...(Array.isArray(body.history)
        ? body.history
            .slice(-6)
            .filter(
              (m: Message) =>
                m &&
                ["user", "assistant"].includes(m.role) &&
                typeof m.content === "string",
            )
            .map((m: Message) => ({
              role: m.role,
              content: m.content.slice(0, 8000),
            }))
        : []),
      { role: "user", content: body.question },
    ];
    const signal = AbortSignal.any([
      request.signal,
      AbortSignal.timeout(180000),
    ]);
    const answer = await runChat(
      messages,
      async (messages) => {
        const response = await fetch(
          "https://openrouter.ai/api/v1/chat/completions",
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${session.apiKey}`,
              "Content-Type": "application/json",
            },
            signal: AbortSignal.any([signal, AbortSignal.timeout(60000)]),
            body: JSON.stringify({
              model: session.model,
              temperature: 0,
              max_tokens: freeVisualization ? 12000 : 3000,
              messages,
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
          throw new Error("The model returned no answer. Try again.");
        return content;
      },
      async (sql) => {
        signal.throwIfAborted();
        return executeQuery(
          sql,
          schema.map((t: Table) => t.name),
          session.url,
        );
      },
      freeVisualization,
    );
    return Response.json(answer);
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
  }
}

// Every step gets its own bounded, read-only connection, closed before calling AI again.
async function executeQuery(
  input: string,
  tables: string[],
  url: string,
): Promise<QueryStep> {
  const started = Date.now();
  let connection;
  let sql = input;
  const rows: Record<string, unknown>[] = [];
  let truncated = false;
  try {
    sql = validateQuery(input, tables);
    connection = await openDatabase(url);
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
      error: error instanceof Error ? error.message : "Query failed.",
    };
  } finally {
    await connection?.end();
  }
}
