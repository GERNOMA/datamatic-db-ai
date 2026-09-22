import { checkOrigin, getSession } from "@/lib/database";
import {
  mainModelProvider,
  mainModelRequest,
  mainModelError,
} from "@/lib/main-model";
import { executeQuery } from "@/lib/query";
import { chatPrompt, runChat, type Message } from "@/lib/chat";
import {
  addDiscoveredTables,
  discoverTables,
  discoverFunctions,
  type DiscoveryContext,
} from "@/lib/jev";
import type { Table } from "@/lib/types";
import {
  applyExclusions,
  contextTables,
  resolveContextTables,
} from "@/lib/table-context";
import { readCodeArchive } from "@/lib/code-archive";
import {
  addDiscoveredFunctions,
  functionsForTables,
  type SelectedFunction,
} from "@/lib/code-context";
export const runtime = "nodejs";

export async function POST(request: Request) {
  let selectedFunctions: SelectedFunction[] = [];
  let context: DiscoveryContext | undefined;
  try {
    checkOrigin(request);
    const session = await getSession();
    const body = await request.json();
    const provider = mainModelProvider(session);
    if (!provider.apiKey)
      throw new Error(`Añade tu clave API de ${provider.name} en Conectar.`);
    if (
      typeof body.question !== "string" ||
      !body.question.trim() ||
      body.question.length > 8000
    )
      throw new Error("Introduce una pregunta de hasta 8000 caracteres.");
    const drStrange = body.drStrange === true;
    if (drStrange && !session.apiKey)
      throw new Error("Añade tu clave API de OpenRouter para usar DR.STRANGE.");
    const before = session.tables
      .filter((t) => t.notUsed)
      .map((t) => t.name)
      .sort()
      .join("\n");
    session.tables = applyExclusions(
      session.tables,
      body.notUsedTables ??
        session.tables.filter((t) => t.notUsed).map((t) => t.name),
    );
    const after = session.tables
      .filter((t) => t.notUsed)
      .map((t) => t.name)
      .sort()
      .join("\n");
    if (before !== after) session.discoveries?.clear();
    const available = contextTables(session.tables);
    if (!Array.isArray(body.tables) || (!drStrange && !body.tables.length))
      throw new Error("Selecciona un grupo que contenga al menos una tabla.");
    const candidates: Table[] = drStrange
      ? available
      : body.tables.filter((t: Table) =>
          available.some((a) => a.name === t?.name),
        );
    if (!candidates.length)
      throw new Error(
        "No hay tablas activas para consultar. Revisa las casillas NOT USED en Base de Datos.",
      );
    const schema = available.map((candidate) => {
      const actual = session.tables.find((t) => t.name === candidate?.name);
      if (!actual)
        throw new Error(
          "Una tabla seleccionada ya no existe. Vuelve a conectarte para actualizar el esquema.",
        );
      const provided =
        (Array.isArray(body.availableTables)
          ? body.availableTables
          : body.tables
        ).find((t: Table) => t?.name === actual.name) ?? actual;
      return {
        name: actual.name,
        ...(provided.description
          ? { description: String(provided.description).slice(0, 2000) }
          : {}),
        fields: actual.fields.map((field) => {
          const description = (
            Array.isArray(provided.fields) ? provided.fields : []
          ).find(
            (f: Table["fields"][number]) => f?.name === field.name,
          )?.description;
          return {
            name: field.name,
            type: field.type,
            key: field.key,
            nullable: field.nullable,
            ...(description
              ? { description: String(description).slice(0, 2000) }
              : {}),
          };
        }),
      };
    });
    {
      if (
        typeof body.conversationId !== "string" ||
        !/^[0-9a-f-]{36}$/i.test(body.conversationId)
      )
        throw new Error("Identificador de conversación no válido.");
      const contexts = (session.discoveries ??= new Map());
      context = contexts.get(body.conversationId);
      if (!context) {
        if (contexts.size >= 100)
          contexts.delete(contexts.keys().next().value!);
        context = { initialized: false, tables: [] };
        contexts.set(body.conversationId, context);
      }
      context.tables = context.tables.filter((name) =>
        available.some((t) => t.name === name),
      );
      if (!drStrange) addDiscoveredTables(context, candidates);
    }
    const visibleSchema = () =>
      schema.filter((t) => context!.tables.includes(t.name));
    const archive = await readCodeArchive(
      session.id,
      session.tables.map((table) => table.name),
    );
    if (archive || body.conversationId) {
      if (
        typeof body.conversationId !== "string" ||
        !/^[0-9a-f-]{36}$/i.test(body.conversationId)
      )
        throw new Error("Identificador de conversación no válido.");
      const contexts = (session.codeContexts ??= new Map());
      if (!contexts.has(body.conversationId) && contexts.size >= 100)
        contexts.delete(contexts.keys().next().value!);
      selectedFunctions = functionsForTables(
        contexts.get(body.conversationId) ?? [],
        available.map((t) => t.name),
      ) as SelectedFunction[];
      contexts.set(body.conversationId, selectedFunctions);
    }
    const freeVisualization = body.freeVisualization === true;
    const messages: Message[] = [
      {
        role: "system",
        content: chatPrompt(freeVisualization, drStrange, !!archive),
      },
      { role: "system", content: JSON.stringify({ tables: visibleSchema() }) },
      {
        role: "system",
        content: JSON.stringify({ functions: selectedFunctions }),
      },
      ...(before === after && Array.isArray(body.history)
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
      AbortSignal.timeout(1800000),
    ]);
    const answer = await runChat(
      messages,
      async (messages) => {
        const response = await fetch(provider.url, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${provider.apiKey}`,
            "Content-Type": "application/json",
          },
          signal: AbortSignal.any([signal, AbortSignal.timeout(600000)]),
          body: JSON.stringify(
            mainModelRequest(session, messages, freeVisualization),
          ),
        });
        if (!response.ok) throw await mainModelError(response, provider);
        const completion = await response.json();
        const content = completion.choices?.[0]?.message?.content;
        if (typeof content !== "string")
          throw new Error(
            "El modelo no devolvió ninguna respuesta. Inténtalo de nuevo.",
          );
        return content;
      },
      async (sql, calculationSignal) => {
        signal.throwIfAborted();
        return executeQuery(
          sql,
          visibleSchema().map((t) => t.name),
          session.url,
          calculationSignal
            ? AbortSignal.any([signal, calculationSignal])
            : signal,
        );
      },
      freeVisualization,
      drStrange && context
        ? {
            required: !context.initialized,
            discover: async (purpose) => {
              const matches = await discoverTables(
                schema,
                purpose,
                session.apiKey,
                signal,
              );
              const added = addDiscoveredTables(context!, matches);
              return {
                purpose,
                matchedTables: matches.map((t) => t.name),
                tables: added,
              };
            },
          }
        : undefined,
      archive
        ? async (purpose) => {
            if (!session.apiKey)
              throw new Error(
                "Añade tu clave API de OpenRouter para descubrir funciones con JEV.",
              );
            const candidates = functionsForTables(
              archive.functions,
              visibleSchema().map((t) => t.name),
            );
            const matches = await discoverFunctions(
              candidates,
              purpose,
              session.apiKey,
              signal,
            );
            // Keep previously exposed code even if the archive changes.
            const added = addDiscoveredFunctions(selectedFunctions, matches);
            return {
              purpose,
              evaluated: candidates.length,
              matched: matches.map((fn) => fn.id),
              functions: added,
            };
          }
        : undefined,
      async (names) => {
        signal.throwIfAborted();
        const resolved = resolveContextTables(schema, names);
        const added = addDiscoveredTables(context!, resolved.tables);
        return {
          matchedTables: resolved.tables.map((t) => t.name),
          unavailableTables: resolved.unavailableTables,
          tables: added,
        };
      },
      signal,
    );
    return Response.json({
      ...answer,
      contextFunctions: selectedFunctions,
      ...(context ? { contextTables: context.tables } : {}),
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "La consulta ha fallado. Inténtalo de nuevo.";
    return Response.json(
      {
        contextFunctions: selectedFunctions,
        ...(context ? { contextTables: context.tables } : {}),
        error: /SQL syntax|Unknown column|doesn't exist/i.test(message)
          ? "La consulta generada no coincide con el esquema. Prueba a reformular tu pregunta o a añadir descripciones."
          : message,
      },
      { status: 400 },
    );
  }
}
