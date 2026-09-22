import { checkOrigin, getSession } from "@/lib/database";
import { applyExclusions } from "@/lib/table-context";
import { labelInputs } from "@/lib/automatic-labels";
import { researchLabels } from "@/lib/researched-labels";
import { readCodeArchive } from "@/lib/code-archive";
import { executeQuery } from "@/lib/query";

export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const session = await getSession();
    if (!session.apiKey)
      throw new Error("Añade tu clave API de OpenRouter en Conectarse.");
    const body = await request.json();
    if (body.connectionId !== session.id)
      throw new Error("La conexión cambió. Vuelve a cargar el ZIP.");
    if (
      typeof body.model !== "string" ||
      !body.model.trim() ||
      body.model.length > 200
    )
      throw new Error("Introduce el modelo de OpenRouter para el etiquetado.");
    const tables = applyExclusions(session.tables, body.notUsedTables);
    const inputs = labelInputs(body.tables, tables);
    const archive = await readCodeArchive(
      session.id,
      session.tables.map((table) => table.name),
    );
    if (
      tables.some(
        (table, index) => !!table.notUsed !== !!session.tables[index].notUsed,
      )
    )
      session.discoveries?.clear();
    session.tables = tables;
    const abort = new AbortController();
    const signal = AbortSignal.any([
      request.signal,
      abort.signal,
      AbortSignal.timeout(18000000),
    ]);
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          await researchLabels({
            inputs,
            tables,
            functions: archive?.functions ?? [],
            connectionId: session.id,
            model: body.model.trim(),
            apiKey: session.apiKey,
            signal,
            execute: (sql, allowed, querySignal) =>
              executeQuery(
                sql,
                allowed.filter((name) =>
                  tables.some((t) => t.name === name && !t.notUsed),
                ),
                session.url,
                querySignal,
              ),
            onResult: (result) => {
              if (!signal.aborted)
                controller.enqueue(
                  encoder.encode(JSON.stringify(result) + "\n"),
                );
            },
          });
          if (!signal.aborted)
            controller.enqueue(
              encoder.encode(JSON.stringify({ done: true }) + "\n"),
            );
        } finally {
          if (!abort.signal.aborted) controller.close();
        }
      },
      cancel() {
        abort.abort();
      },
    });
    return new Response(stream, {
      headers: {
        "Content-Type": "application/x-ndjson",
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "No se pudo iniciar el etiquetado.",
      },
      { status: 400 },
    );
  }
}
