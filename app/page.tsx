"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { createGroupId } from "@/lib/group-id";
import {
  emptyWorkspace,
  parseWorkspace,
  readWorkspace,
  WORKSPACE_KEY,
  type Workspace,
} from "@/lib/workspace";
import AnswerView from "./answer-view";
import TransformPage from "./transform-page";
import ModelsPage from "./modelos/models-page";
import type { TableUpdate } from "./modelos/usage-import";
import LabelEvidenceDetails from "./label-evidence";
import { applyFieldLabels } from "@/lib/field-labels";
import { applyCatalog } from "@/lib/catalog";
import type { ChatAnswer, Field, Group, Table } from "@/lib/types";
import type { SelectedFunction } from "@/lib/code-context";

type Connection = {
  name: string;
  id: string;
  tables: Table[];
  model: string;
  aiReady: boolean;
  useCerebras?: boolean;
};
type Result = { question: string; answer?: ChatAnswer; error?: string };
type Tab = "Chat" | "Database" | "Connect" | "Transformar" | "Modelos";

function Icon({ name, size = 18 }: { name: string; size?: number }) {
  const paths: Record<string, React.ReactNode> = {
    chat: <path d="M21 11.5a8.4 8.4 0 0 1-9 8.5H4l-2 2V12a9 9 0 1 1 19-.5Z" />,
    database: (
      <>
        <ellipse cx="12" cy="5" rx="8" ry="3" />
        <path d="M4 5v14c0 4 16 4 16 0V5M4 12c0 4 16 4 16 0" />
      </>
    ),
    connect: (
      <path d="m9 15 6-6m-7 9-1 1a4 4 0 0 1-6-6l5-5a4 4 0 0 1 6 0m0 8a4 4 0 0 0 6 0l5-5a4 4 0 0 0-6-6l-1 1" />
    ),
    arrow: <path d="M12 19V5m-6 6 6-6 6 6" />,
    transformar: <path d="M4 7h16m-4-4 4 4-4 4M20 17H4m4-4-4 4 4 4" />,
    plus: <path d="M12 5v14M5 12h14" />,
    grid: (
      <>
        <rect x="3" y="3" width="18" height="18" rx="3" />
        <path d="M3 9h18M9 9v12" />
      </>
    ),
    folder: (
      <path d="M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" />
    ),
    check: <path d="m5 12 4 4L19 6" />,
    shield: (
      <>
        <path d="m12 2 8 4v6c0 5-8 10-8 10S4 17 4 12V6l8-4Z" />
        <path d="m8 12 3 3 5-6" />
      </>
    ),
    spark: (
      <path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z" />
    ),
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name] || paths.grid}
    </svg>
  );
}

export default function Home() {
  const [tab, setTab] = useState<Tab>("Chat");
  const [connection, setConnection] = useState<Connection | null>(null);
  const [tables, setTables] = useState<Table[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [selectedGroups, setSelectedGroups] = useState<string[]>([]);
  const [selectedTable, setSelectedTable] = useState("");
  const [search, setSearch] = useState("");
  const [url, setUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [useCerebras, setUseCerebras] = useState(false);
  const [cerebrasApiKey, setCerebrasApiKey] = useState("");
  const [model, setModel] = useState("openrouter/auto");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [question, setQuestion] = useState("");
  const [drStrange, setDrStrange] = useState(false);
  const [discoveredTables, setDiscoveredTables] = useState<string[]>([]);
  const [contextFunctions, setContextFunctions] = useState<SelectedFunction[]>(
    [],
  );
  const conversationId = useRef("");
  const [freeVisualization, setFreeVisualization] = useState(false);
  const [results, setResults] = useState<Result[]>([]);
  const [groupEditor, setGroupEditor] = useState<Group | null>(null);
  const [groupTableSearch, setGroupTableSearch] = useState("");
  const [showAllTables, setShowAllTables] = useState(false);
  const [contextOpen, setContextOpen] = useState(false);
  const contextTablesDialog = useRef<HTMLDialogElement>(null);
  const contextFunctionsDialog = useRef<HTMLDialogElement>(null);
  const storageLoaded = useRef(false);
  const workspace = useRef<Workspace>(emptyWorkspace());
  const [savedConnections, setSavedConnections] = useState<
    Workspace["connections"]
  >([]);
  const [ready, setReady] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [transferMessage, setTransferMessage] = useState("");
  const importInput = useRef<HTMLInputElement>(null);
  const bottom = useRef<HTMLDivElement>(null);

  const resetConversation = useCallback(() => {
    setResults([]);
    setDiscoveredTables([]);
    setContextFunctions([]);
    conversationId.current = "";
  }, []);

  function openGroupEditor(group: Group) {
    setGroupTableSearch("");
    setGroupEditor(group);
  }

  const matchingGroupTables = tables.filter((table) =>
    table.name.toLowerCase().includes(groupTableSearch.trim().toLowerCase()),
  );
  const matchingTables = tables.filter((table) =>
    table.name.toLowerCase().includes(search.toLowerCase()),
  );
  const visibleTables = showAllTables
    ? matchingTables
    : matchingTables.slice(0, 10);

  const loadConnection = useCallback(
    (
      data: Connection,
      credentials?: { url: string; apiKey: string; cerebrasApiKey: string },
    ) => {
      const saved = workspace.current.connections.find((c) => c.id === data.id);
      const merged = data.tables.map((t) => {
        const previous = saved?.tables?.find((old) => old.name === t.name);
        return {
          ...t,
          description: previous?.description || "",
          labelEvidence: previous?.labelEvidence,
          notUsed: previous?.notUsed ?? t.notUsed ?? false,
          fields: t.fields.map((f) => ({
            ...f,
            description:
              previous?.fields.find((old) => old.name === f.name)
                ?.description || "",
          })),
        };
      });
      const restored = (saved?.groups || []).map((g) => ({
        ...g,
        tables: g.tables.filter((name) => merged.some((t) => t.name === name)),
      }));
      workspace.current = {
        ...workspace.current,
        activeConnectionId: data.id,
        connections: [
          ...workspace.current.connections.filter((c) => c.id !== data.id),
          {
            id: data.id,
            name: data.name,
            model: data.model,
            url: credentials?.url ?? saved?.url ?? "",
            apiKey: credentials?.apiKey ?? saved?.apiKey ?? "",
            useCerebras: data.useCerebras === true,
            cerebrasApiKey:
              credentials?.cerebrasApiKey ?? saved?.cerebrasApiKey ?? "",
            tables: merged,
            groups: restored,
            selectedGroups: saved?.selectedGroups ?? [],
          },
        ],
      };
      setSavedConnections(workspace.current.connections);
      setConnection(data);
      setTables(merged);
      setShowAllTables(false);
      setGroups(restored);
      setSelectedGroups(saved?.selectedGroups ?? []);
      setSelectedTable(merged[0]?.name || "");
      setModel(data.model);
      setUseCerebras(data.useCerebras === true);
      resetConversation();
    },
    [resetConversation],
  );

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("tab") === "modelos")
      setTab("Modelos");
    let cancelled = false;
    async function restore() {
      try {
        workspace.current = readWorkspace(localStorage);
        storageLoaded.current = true;
        setSavedConnections(workspace.current.connections);
        setFreeVisualization(workspace.current.freeVisualization);
        const saved = workspace.current.connections.find(
          (c) => c.id === workspace.current.activeConnectionId,
        );
        setUrl(saved?.url ?? "");
        setApiKey(saved?.apiKey ?? "");
        setUseCerebras(saved?.useCerebras ?? false);
        setCerebrasApiKey(saved?.cerebrasApiKey ?? "");
        setModel(saved?.model ?? "openrouter/auto");
        const response = await fetch("/api/connect");
        const data = await response.json();
        if (!cancelled && data.id) loadConnection(data);
      } catch {
        if (!cancelled)
          setSaveError(
            "No se pudo restaurar el espacio guardado. Puedes importar una copia JSON.",
          );
        return;
      } finally {
        if (!cancelled) setReady(true);
      }
    }
    void restore();
    return () => {
      cancelled = true;
    };
  }, [loadConnection]);

  useEffect(() => {
    if (!ready) return;
    const next = {
      ...workspace.current,
      freeVisualization,
      connections: workspace.current.connections.map((c) =>
        c.id === connection?.id
          ? {
              ...c,
              tables,
              groups,
              selectedGroups: selectedGroups.filter((id) =>
                groups.some((g) => g.id === id),
              ),
            }
          : c,
      ),
    };
    workspace.current = next;
    setSavedConnections(next.connections);
    if (!storageLoaded.current) return;
    try {
      localStorage.setItem(WORKSPACE_KEY, JSON.stringify(next));
      setSaveError("");
    } catch {
      setSaveError(
        "No se pudo guardar en este navegador. Exporta el JSON para conservar tus cambios.",
      );
    }
  }, [tables, groups, selectedGroups, connection, freeVisualization, ready]);

  function exportWorkspace() {
    const blob = new Blob([JSON.stringify(workspace.current, null, 2)], {
      type: "application/json",
    });
    const href = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = href;
    link.download = "datamatic-workspace.json";
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(href), 1000);
  }

  async function importWorkspace(file: File) {
    setBusy(true);
    setError("");
    setTransferMessage("");
    try {
      if (file.size > 5 * 1024 * 1024)
        throw new Error("El JSON no puede superar los 5 MB.");
      const imported = parseWorkspace(await file.text());
      // Check storage before ending the current session; rollback if disconnect fails.
      const previous = localStorage.getItem(WORKSPACE_KEY);
      localStorage.setItem(WORKSPACE_KEY, JSON.stringify(imported));
      try {
        const response = await fetch("/api/connect", { method: "DELETE" });
        if (!response.ok)
          throw new Error(
            "No se pudo cerrar la conexión actual. Inténtalo de nuevo.",
          );
      } catch (error) {
        if (previous === null) localStorage.removeItem(WORKSPACE_KEY);
        else localStorage.setItem(WORKSPACE_KEY, previous);
        throw error;
      }
      storageLoaded.current = true;
      workspace.current = imported;
      setSavedConnections(imported.connections);
      setConnection(null);
      setTables([]);
      setGroups([]);
      setSelectedGroups([]);
      setSelectedTable("");
      resetConversation();
      setQuestion("");
      setGroupEditor(null);
      setSearch("");
      setFreeVisualization(imported.freeVisualization);
      const saved =
        imported.connections.find(
          (c) => c.id === imported.activeConnectionId,
        ) ?? imported.connections[0];
      setUrl(saved?.url ?? "");
      setApiKey(saved?.apiKey ?? "");
      setUseCerebras(saved?.useCerebras ?? false);
      setCerebrasApiKey(saved?.cerebrasApiKey ?? "");
      setModel(saved?.model ?? "openrouter/auto");
      setSaveError("");
      setTransferMessage(
        "JSON importado. Se ha reemplazado el espacio guardado. Conecta una de las conexiones importadas para continuar.",
      );
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "No se pudo importar el JSON.",
      );
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth" });
  }, [results, busy]);

  async function connect(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url,
          apiKey,
          model,
          useCerebras,
          cerebrasApiKey,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      loadConnection(data, { url, apiKey, cerebrasApiKey });
      setUrl("");
      setApiKey("");
      setCerebrasApiKey("");
      setTab("Database");
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo conectar.");
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/connect", { method: "DELETE" });
      if (!response.ok)
        throw new Error("No se pudo desconectar. Inténtalo de nuevo.");
      workspace.current = { ...workspace.current, activeConnectionId: null };
      setConnection(null);
      setTables([]);
      setGroups([]);
      setSelectedGroups([]);
      resetConversation();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo desconectar.");
    } finally {
      setBusy(false);
    }
  }

  const contextTables = tables.filter(
    (t) =>
      !t.notUsed &&
      (drStrange
        ? discoveredTables.includes(t.name)
        : discoveredTables.includes(t.name) ||
          groups.some(
            (g) => selectedGroups.includes(g.id) && g.tables.includes(t.name),
          )),
  );
  const currentTable = tables.find((t) => t.name === selectedTable);

  async function ask(event: React.FormEvent) {
    event.preventDefault();
    if (!question.trim() || busy) return;
    if (!connection) {
      setTab("Connect");
      return;
    }
    if (!drStrange && !contextTables.length) {
      setError(
        "Selecciona un grupo con al menos una tabla antes de hacer una pregunta.",
      );
      setContextOpen(true);
      return;
    }
    if (!conversationId.current) conversationId.current = crypto.randomUUID();
    const text = question.trim();
    setQuestion("");
    setBusy(true);
    setError("");
    setResults((previous) => [...previous, { question: text }]);
    try {
      const history = results
        .filter((r) => r.answer)
        .flatMap((r) => [
          { role: "user", content: r.question },
          {
            role: "assistant",
            content: JSON.stringify({
              text: r.answer!.text,
              queries: r
                .answer!.steps.filter((step) => step.kind !== "calculation")
                .map((step) => step.sql),
              calculations: r
                .answer!.steps.filter((step) => step.kind === "calculation")
                .map((step) => ({
                  code: step.code,
                  error: step.error,
                  truncated: step.truncated,
                })),
            }),
          },
        ]);
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: text,
          tables: drStrange ? tables.filter((t) => !t.notUsed) : contextTables,
          availableTables: tables.filter((t) => !t.notUsed),
          notUsedTables: tables.filter((t) => t.notUsed).map((t) => t.name),
          drStrange,
          conversationId: conversationId.current,
          history,
          freeVisualization,
        }),
      });
      const data = await response.json();
      if (Array.isArray(data.contextFunctions))
        setContextFunctions(data.contextFunctions);
      if (Array.isArray(data.contextTables))
        setDiscoveredTables(data.contextTables);
      if (!response.ok) throw new Error(data.error);
      setResults((previous) => [
        ...previous.slice(0, -1),
        { question: text, answer: data },
      ]);
    } catch (e) {
      setResults((previous) => [
        ...previous.slice(0, -1),
        {
          question: text,
          error: e instanceof Error ? e.message : "La consulta ha fallado.",
        },
      ]);
    } finally {
      setBusy(false);
    }
  }

  function describe(value: string, field?: Field) {
    setTables((previous) =>
      previous.map((t) =>
        t.name !== selectedTable
          ? t
          : field
            ? {
                ...t,
                fields: t.fields.map((f) =>
                  f.name === field.name ? { ...f, description: value } : f,
                ),
              }
            : { ...t, description: value, labelEvidence: undefined },
      ),
    );
  }

  function updateModelTables(updates: TableUpdate[]) {
    const changes = new Map(updates.map((update) => [update.name, update]));
    setTables((previous) =>
      previous.map((table) => {
        const change = changes.get(table.name);
        if (!change) return table;
        return {
          ...table,
          ...(change.notUsed !== undefined ? { notUsed: change.notUsed } : {}),
          ...(change.description !== undefined && !table.notUsed
            ? {
                description: change.description,
                labelEvidence: change.labelEvidence,
                ...(change.fields
                  ? { fields: applyFieldLabels(table.fields, change.fields) }
                  : {}),
              }
            : {}),
        };
      }),
    );
    if (updates.some((update) => update.notUsed !== undefined))
      resetConversation();
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <Link className="brand" href="/" aria-label="Inicio de Datamatic">
          <span className="brand-mark">
            <i />
            <i />
            <i />
          </span>
          datamatic<span className="beta">BETA</span>
        </Link>
        <nav aria-label="Navegación principal">
          {(
            ["Chat", "Database", "Connect", "Transformar", "Modelos"] as Tab[]
          ).map((item) => (
            <button
              key={item}
              disabled={busy}
              className={tab === item ? "nav-item active" : "nav-item"}
              onClick={() => {
                setTab(item);
                setError("");
              }}
            >
              <Icon name={item.toLowerCase()} />
              {
                {
                  Chat: "Chat",
                  Database: "Base de Datos",
                  Connect: "Conectarse",
                  Transformar: "Transformar",
                  Modelos: "Modelos, Controladores y Más",
                }[item]
              }
            </button>
          ))}
        </nav>
        <button
          className="connection-status"
          disabled={busy}
          onClick={() => setTab("Connect")}
        >
          <span className={connection ? "dot green" : "dot"} />
          {connection ? connection.name : "Ninguna base de datos conectada"}
          <span className="status-chevron">⌄</span>
        </button>
      </header>
      {saveError && (
        <div className="error-banner" role="alert">
          {saveError}
        </div>
      )}
      {error && (
        <div className="error-banner" role="alert">
          {error}
          <button aria-label="Cerrar error" onClick={() => setError("")}>
            ×
          </button>
        </div>
      )}

      {tab === "Chat" && (
        <main className="chat-layout">
          <div className="page-bar">
            <div>
              <h1>Conversa con tus datos</h1>
              <p>
                Buenas preguntas. Respuestas claras. Directamente de tu base de
                datos.
              </p>
            </div>
            <button
              className="button secondary small"
              disabled={busy || !results.length}
              onClick={() => {
                resetConversation();
                setQuestion("");
              }}
            >
              <Icon name="plus" size={15} />
              Nueva conversación
            </button>
          </div>
          <div className="chat-workspace">
            <section className="conversation" aria-label="Conversación">
              {!results.length ? (
                <div className="welcome">
                  <div className="welcome-icon">
                    <Icon name="spark" size={29} />
                    <span className="mini-spark">✦</span>
                  </div>
                  <span className="eyebrow">
                    LA CURIOSIDAD ABRE MUCHAS PUERTAS
                  </span>
                  <h2>
                    Tus datos tienen respuestas.
                    <br />
                    <span>Solo tienes que preguntar.</span>
                  </h2>
                  <p>
                    Explora tu base de datos en español.
                    <br />
                    Elige tus grupos, haz una pregunta y obtén una respuesta
                    clara.
                  </p>
                  <div className="suggestions">
                    {[
                      [
                        "Obtén una visión general",
                        "¿Cuántos trabajadores hay en cada empresa?",
                        "grid",
                      ],
                      [
                        "Relaciona los datos",
                        "¿Qué trabajadores no tienen una ruta asignada?",
                        "connect",
                      ],
                      [
                        "Profundiza un poco más",
                        "Muestra las 10 empresas con más trabajadores.",
                        "spark",
                      ],
                    ].map(([title, prompt, icon]) => (
                      <button key={title} onClick={() => setQuestion(prompt)}>
                        <Icon name={icon} />
                        <strong>{title}</strong>
                        <span>{prompt}</span>
                        <b>↗</b>
                      </button>
                    ))}
                  </div>
                  {!connection && (
                    <button
                      className="setup-link"
                      onClick={() => setTab("Connect")}
                    >
                      Conecta tu primera base de datos para empezar{" "}
                      <span>→</span>
                    </button>
                  )}
                </div>
              ) : (
                <div className="messages">
                  {results.map((result, index) => (
                    <article className="message" key={index}>
                      <div className="user-question">
                        <span className="avatar">T</span>
                        <div>
                          <small>Tú</small>
                          <p>{result.question}</p>
                        </div>
                      </div>
                      <div className="answer">
                        <span className="ai-avatar">
                          <Icon name="spark" size={16} />
                        </span>
                        <div className="answer-content">
                          <small>Datamatic</small>
                          {result.error ? (
                            <p className="query-error" role="alert">
                              {result.error}
                            </p>
                          ) : result.answer ? (
                            <AnswerView answer={result.answer} />
                          ) : (
                            <p className="thinking">
                              Generando y ejecutando tu consulta…
                            </p>
                          )}
                        </div>
                      </div>
                    </article>
                  ))}
                  <div ref={bottom} />
                </div>
              )}
              <div className="composer-wrap">
                <form className="composer" onSubmit={ask}>
                  <textarea
                    aria-label="Haz una pregunta sobre tus datos"
                    placeholder="Pregunta lo que quieras sobre tus datos…"
                    value={question}
                    maxLength={8000}
                    onChange={(e) => setQuestion(e.target.value)}
                    onKeyDown={(e) => {
                      if (
                        e.key === "Enter" &&
                        !e.shiftKey &&
                        !e.nativeEvent.isComposing
                      ) {
                        e.preventDefault();
                        e.currentTarget.form?.requestSubmit();
                      }
                    }}
                  />
                  <div className="composer-bottom">
                    <button
                      type="button"
                      className="context-toggle"
                      disabled={drStrange}
                      onClick={() => setContextOpen(!contextOpen)}
                    >
                      <Icon name="folder" size={15} />
                      {drStrange
                        ? "Contexto automático · JEV"
                        : selectedGroups.length
                          ? `${selectedGroups.length} ${selectedGroups.length === 1 ? "grupo seleccionado" : "grupos seleccionados"}`
                          : "Seleccionar grupos"}
                      <span>⌄</span>
                    </button>
                    <div className="send-controls">
                      <span>Intro para enviar</span>
                      <label className="free-visualization-toggle">
                        <input
                          type="checkbox"
                          checked={drStrange}
                          disabled={busy}
                          onChange={(event) => {
                            setDrStrange(event.target.checked);
                            setContextOpen(false);
                            resetConversation();
                          }}
                        />
                        Modo DR.STRANGE
                      </label>
                      <label className="free-visualization-toggle">
                        <input
                          type="checkbox"
                          checked={freeVisualization}
                          disabled={busy}
                          onChange={(event) =>
                            setFreeVisualization(event.target.checked)
                          }
                        />
                        Visualización libre
                      </label>
                      <button
                        className="send-button"
                        aria-label="Enviar pregunta"
                        disabled={busy || !question.trim()}
                      >
                        <Icon name="arrow" />
                      </button>
                    </div>
                  </div>
                </form>
                <div className="composer-note">
                  <span>
                    <Icon name="shield" size={12} />
                    Consultas de solo lectura. Los resultados se comparten con
                    la IA.
                  </span>
                  <span>
                    Con tecnología de{" "}
                    {connection?.useCerebras ? "Cerebras" : "OpenRouter"}
                  </span>
                </div>
              </div>
            </section>
            <aside
              className={`context-panel ${contextOpen ? "mobile-open" : ""}`}
            >
              <div className="aside-heading">
                <span>Contexto de la conversación</span>
                <Icon name="folder" size={17} />
              </div>
              {drStrange ? (
                <p>
                  JEV evalúa todas las tablas para cada propósito de la IA. Las
                  tablas descubiertas se acumulan en esta conversación.
                </p>
              ) : (
                <>
                  <p>
                    Selecciona los grupos que quieres explorar.
                    <br />
                    Su esquema y los resultados de las consultas se comparten
                    con la IA.
                  </p>
                  <div className="section-label">
                    TUS GRUPOS{" "}
                    <button
                      aria-label="Crear grupo"
                      onClick={() => {
                        setTab("Database");
                        openGroupEditor({
                          id: createGroupId(),
                          name: "",
                          tables: [],
                        });
                      }}
                      disabled={!connection || busy}
                    >
                      <Icon name="plus" size={15} />
                    </button>
                  </div>
                  {groups.length ? (
                    <div className="group-choices">
                      {groups.map((g) => (
                        <label
                          key={g.id}
                          className={
                            selectedGroups.includes(g.id)
                              ? "group-choice chosen"
                              : "group-choice"
                          }
                        >
                          <input
                            type="checkbox"
                            checked={selectedGroups.includes(g.id)}
                            disabled={busy}
                            onChange={(e) => {
                              setSelectedGroups((old) =>
                                e.target.checked
                                  ? [...old, g.id]
                                  : old.filter((id) => id !== g.id),
                              );
                              resetConversation();
                            }}
                          />
                          <span>
                            <strong>{g.name}</strong>
                            <small>
                              {
                                tables.filter(
                                  (t) =>
                                    !t.notUsed && g.tables.includes(t.name),
                                ).length
                              }{" "}
                              tablas activas
                            </small>
                          </span>
                          <Icon name="folder" size={16} />
                        </label>
                      ))}
                    </div>
                  ) : (
                    <div className="context-empty">
                      <div className="folder-illustration">
                        <Icon name="folder" size={28} />
                      </div>
                      <strong>Un poco de contexto ayuda</strong>
                      <p>
                        Organiza las tablas relacionadas en grupos
                        <br />
                        para enfocar tus preguntas.
                      </p>
                      <button
                        onClick={() =>
                          setTab(connection ? "Database" : "Connect")
                        }
                      >
                        {connection
                          ? "Crear un grupo"
                          : "Conectar una base de datos"}{" "}
                        <span>→</span>
                      </button>
                    </div>
                  )}
                </>
              )}
              <div className="context-summary">
                <span>Tablas en contexto</span>
                <b>{contextTables.length.toString().padStart(2, "0")}</b>
              </div>
              {!!contextTables.length && (
                <div className="context-tables">
                  {contextTables.slice(0, 10).map((t) => (
                    <span key={t.name}>
                      <Icon name="grid" size={13} />
                      {t.name}
                    </span>
                  ))}
                  <button
                    type="button"
                    className="context-view-all"
                    aria-haspopup="dialog"
                    aria-controls="context-tables-dialog"
                    onClick={() => contextTablesDialog.current?.showModal()}
                  >
                    <Icon name="grid" size={14} />
                    Ver todas
                  </button>
                  <details>
                    <summary>Ver esquema JSON</summary>
                    <pre>
                      {JSON.stringify(
                        {
                          tables: contextTables.map((t) => ({
                            name: t.name,
                            ...(t.description
                              ? { description: t.description }
                              : {}),
                            fields: t.fields.map((f) => ({
                              name: f.name,
                              type: f.type,
                              ...(f.description
                                ? { description: f.description }
                                : {}),
                            })),
                          })),
                        },
                        null,
                        2,
                      )}
                    </pre>
                  </details>
                </div>
              )}
              <section
                className="function-context"
                aria-label="Código disponible para la IA"
              >
                <div className="context-summary">
                  <span>Funciones con código</span>
                  <b>{contextFunctions.length}</b>
                </div>
                <button
                  type="button"
                  className="context-view-all"
                  aria-haspopup="dialog"
                  aria-controls="context-functions-dialog"
                  onClick={() => contextFunctionsDialog.current?.showModal()}
                >
                  Ver funciones
                </button>
              </section>
              <dialog
                ref={contextFunctionsDialog}
                id="context-functions-dialog"
                className="group-modal context-functions-dialog"
                aria-labelledby="context-functions-title"
                onClick={(event) => {
                  if (event.target === event.currentTarget) {
                    const bounds = event.currentTarget.getBoundingClientRect();
                    if (
                      event.clientX < bounds.left ||
                      event.clientX > bounds.right ||
                      event.clientY < bounds.top ||
                      event.clientY > bounds.bottom
                    )
                      contextFunctionsDialog.current?.close();
                  }
                }}
              >
                <div className="modal-heading">
                  <h2 id="context-functions-title">Funciones con código</h2>
                  <button
                    type="button"
                    aria-label="Cerrar funciones"
                    onClick={() => contextFunctionsDialog.current?.close()}
                  >
                    ×
                  </button>
                </div>
                <p className="muted">{contextFunctions.length} funciones</p>
                <p>
                  La IA conserva estas funciones completas durante la
                  conversación.
                </p>
                {!contextFunctions.length && (
                  <p className="muted">
                    Aún no hay código seleccionado. Guarda un RAR o ZIP en
                    Modelos, Controladores y Más; la IA buscará con JEV cuando
                    necesite conocer la lógica.
                  </p>
                )}
                {contextFunctions.map((fn) => (
                  <details key={fn.id} className="function-card">
                    <summary>
                      <strong>{fn.name}</strong>
                    </summary>
                    <p>{fn.class || "Función global"}</p>
                    <small>
                      {fn.file}:{fn.line}
                    </small>
                    <p>
                      <b>Modelos:</b> {fn.models.join(", ")}
                    </p>
                    <p>
                      <b>Motivo:</b> {fn.purpose}
                    </p>
                    <pre>
                      <code>{fn.rawCode}</code>
                    </pre>
                  </details>
                ))}
              </dialog>
              <div className="context-tip">
                <Icon name="spark" size={17} />
                <p>
                  <strong>Mejor contexto, mejores respuestas</strong>Añade
                  descripciones a tus tablas y campos para ayudar a la IA a
                  entender tus datos.
                  <button disabled={busy} onClick={() => setTab("Database")}>
                    Gestionar tu base de datos →
                  </button>
                </p>
              </div>
              <button
                className="mobile-done button secondary"
                onClick={() => setContextOpen(false)}
              >
                Listo
              </button>
              <dialog
                ref={contextTablesDialog}
                id="context-tables-dialog"
                className="group-modal context-tables-dialog"
                aria-labelledby="context-tables-title"
                onClick={(event) => {
                  if (event.target === event.currentTarget) {
                    const bounds = event.currentTarget.getBoundingClientRect();
                    if (
                      event.clientX < bounds.left ||
                      event.clientX > bounds.right ||
                      event.clientY < bounds.top ||
                      event.clientY > bounds.bottom
                    )
                      contextTablesDialog.current?.close();
                  }
                }}
              >
                <div className="modal-heading">
                  <h2 id="context-tables-title">Tablas en contexto</h2>
                  <button
                    type="button"
                    aria-label="Cerrar tablas en contexto"
                    onClick={() => contextTablesDialog.current?.close()}
                  >
                    ×
                  </button>
                </div>
                <p className="muted">{contextTables.length} tablas</p>
                <ul className="context-dialog-list">
                  {contextTables.map((table) => (
                    <li key={table.name}>
                      <Icon name="grid" size={16} />
                      <span>{table.name}</span>
                    </li>
                  ))}
                </ul>
              </dialog>
            </aside>
          </div>
        </main>
      )}

      <div hidden={tab !== "Modelos"}>
        <ModelsPage
          tables={tables}
          connectionId={connection?.id}
          connectionName={connection?.name}
          aiReady={connection?.aiReady}
          onUpdate={updateModelTables}
          onConnect={() => setTab("Connect")}
        />
      </div>

      {tab === "Transformar" && (
        <TransformPage
          key={connection?.id ?? "disconnected"}
          tables={tables}
          connectionName={connection?.name}
          onConnect={() => setTab("Connect")}
          onApply={(catalog, filename) => {
            if (!connection)
              throw new Error("Conecta una base de datos primero.");
            const updated = applyCatalog(catalog, tables);
            const group = {
              id: createGroupId(),
              name: filename,
              tables: catalog
                .filter((entry) =>
                  tables.some((table) => table.name === entry.tabla),
                )
                .map((entry) => entry.tabla),
            };
            setTables(updated);
            setGroups((previous) => [...previous, group]);
          }}
        />
      )}

      {tab === "Connect" && (
        <main className="settings-page">
          <div className="page-bar">
            <div>
              <span className="eyebrow">CONECTEMOS TUS DATOS</span>
              <h1>Trae tus datos.</h1>
              <p>Tu base de datos, un poco más accesible.</p>
            </div>
          </div>
          <div className="connect-grid">
            <form className="settings-card" onSubmit={connect}>
              <div className="card-heading">
                <div className="soft-icon">
                  <Icon name="database" size={22} />
                </div>
                <div>
                  <h2>Conectar a MySQL</h2>
                  <p>Una conexión. Una nueva forma de explorar.</p>
                </div>
              </div>
              {connection && (
                <div className="connected-notice">
                  <span className="dot green" />
                  Conectado a <strong>{connection.name}</strong>
                  <button type="button" disabled={busy} onClick={disconnect}>
                    Desconectar
                  </button>
                </div>
              )}
              <label className="form-label" htmlFor="mysql-url">
                URL de conexión
              </label>
              <input
                id="mysql-url"
                type="password"
                autoComplete="off"
                required
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="mysql://usuario:contraseña@servidor:3306/base_de_datos"
              />
              <p className="field-help">
                Usa un usuario de MySQL con permisos solo de SELECT. Añade
                ?ssl=true para usar TLS.
              </p>
              <div className="form-divider" />
              <h3>Configura tu IA</h3>
              <p className="muted">
                Conecta un modelo de OpenRouter o Cerebras para traducir
                preguntas a SQL.
              </p>
              <label className="form-label" htmlFor="api-key">
                Clave API de OpenRouter{" "}
                <span>Opcional si está configurada en el servidor</span>
              </label>
              <input
                id="api-key"
                type="password"
                autoComplete="off"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="sk-or-v1-…"
              />
              <label className="form-label" htmlFor="use-cerebras">
                <input
                  id="use-cerebras"
                  type="checkbox"
                  checked={useCerebras}
                  onChange={(event) => {
                    const checked = event.target.checked;
                    setUseCerebras(checked);
                    setModel(checked ? "gpt-oss-120b" : "openrouter/auto");
                  }}
                />
                Usar Cerebras para el modelo principal
              </label>
              {useCerebras && (
                <>
                  <label className="form-label" htmlFor="cerebras-api-key">
                    Clave API de Cerebras{" "}
                    <span>Opcional si está configurada en el servidor</span>
                  </label>
                  <input
                    id="cerebras-api-key"
                    type="password"
                    autoComplete="off"
                    value={cerebrasApiKey}
                    onChange={(event) => setCerebrasApiKey(event.target.value)}
                    placeholder="Introduce tu clave de Cerebras"
                  />
                  <p className="field-help">
                    JEV, DR.STRANGE y el etiquetado automático siguen usando la
                    clave de OpenRouter.
                  </p>
                </>
              )}
              <label className="form-label" htmlFor="model">
                Modelo
              </label>
              <input
                id="model"
                required
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder={useCerebras ? "gpt-oss-120b" : "openrouter/auto"}
              />
              <p className="field-help">
                Introduce el ID de un modelo disponible en tu cuenta de
                {useCerebras ? "Cerebras" : "OpenRouter"}.
              </p>
              <button
                className="button primary connect-button"
                disabled={busy || !ready}
              >
                {busy
                  ? "Conectando…"
                  : connection
                    ? "Reconectar y actualizar esquema"
                    : "Conectar base de datos"}
                <span>→</span>
              </button>
              <div className="form-divider" />
              <h3>Espacio guardado</h3>
              {savedConnections.length > 0 && (
                <label className="form-label">
                  Conexiones guardadas
                  <select
                    value=""
                    disabled={busy || !ready}
                    onChange={(event) => {
                      const saved = workspace.current.connections.find(
                        (c) => c.id === event.target.value,
                      );
                      if (saved) {
                        setUrl(saved.url);
                        setApiKey(saved.apiKey);
                        setUseCerebras(saved.useCerebras ?? false);
                        setCerebrasApiKey(saved.cerebrasApiKey ?? "");
                        setModel(saved.model);
                      }
                    }}
                  >
                    <option value="" disabled>
                      Selecciona una conexión para rellenar el formulario
                    </option>
                    {savedConnections.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} · {c.id}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <p className="field-help" id="json-help">
                Guarda conexiones, modelos, descripciones y grupos. El JSON
                incluye las contraseñas y claves API introducidas. Importar
                reemplaza todo el espacio actual.
              </p>
              <input
                ref={importInput}
                type="file"
                accept=".json,application/json"
                hidden
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (file) void importWorkspace(file);
                }}
              />
              <div className="workspace-actions">
                <button
                  type="button"
                  className="button secondary"
                  disabled={busy || !ready}
                  aria-describedby="json-help"
                  onClick={() => importInput.current?.click()}
                >
                  Importar JSON
                </button>
                <button
                  type="button"
                  className="button secondary"
                  disabled={busy || !ready}
                  aria-describedby="json-help"
                  onClick={exportWorkspace}
                >
                  Exportar JSON
                </button>
              </div>
              {transferMessage && (
                <p className="field-help" role="status">
                  {transferMessage}
                </p>
              )}
            </form>
            <div className="setup-guide">
              <span className="eyebrow">DE LA CONEXIÓN A LA CONVERSACIÓN</span>
              {[
                [
                  "01",
                  "Conecta tu base de datos",
                  "Conéctate a MySQL de forma segura con tu URL de conexión.",
                ],
                [
                  "02",
                  "Da contexto a tus datos",
                  "Describe tus tablas y campos y reúne las tablas relacionadas en grupos.",
                ],
                [
                  "03",
                  "Déjate guiar por la curiosidad",
                  "Elige un grupo y haz una pregunta. Obtén una respuesta clara con tablas o gráficos.",
                ],
              ].map(([n, title, text]) => (
                <div className="guide-step" key={n}>
                  <span>{n}</span>
                  <div>
                    <h3>{title}</h3>
                    <p>{text}</p>
                  </div>
                </div>
              ))}
              <div className="privacy-note">
                <Icon name="shield" size={22} />
                <h3>Diseñado para consultar, sin modificar.</h3>
                <p>
                  Las consultas se validan y se ejecutan en una transacción de
                  solo lectura. El modelo recibe únicamente el esquema
                  seleccionado, tus preguntas y los resultados limitados de las
                  consultas para explicar los datos y elegir una visualización
                  útil.
                </p>
                <p>
                  Las conexiones y sus credenciales se guardan en este navegador
                  y se incluyen al exportar el JSON. Las sesiones del servidor
                  caducan a las 8 horas; puedes reconectar con un perfil
                  guardado.
                </p>
              </div>
            </div>
          </div>
        </main>
      )}

      {tab === "Database" && (
        <main className="database-page">
          <div className="page-bar">
            <div>
              <h1>Tu base de datos, con contexto.</h1>
              <p>Describe lo importante. Agrupa lo que está relacionado.</p>
            </div>
            {connection && (
              <span className="save-status">
                <Icon name="check" size={14} />
                {saveError
                  ? "Cambios sin guardar"
                  : "Guardado en este navegador"}
              </span>
            )}
          </div>
          {!connection ? (
            <div className="large-empty">
              <div className="welcome-icon">
                <Icon name="database" size={28} />
              </div>
              <h2>Un lugar para tus datos.</h2>
              <p>
                Conecta tu base de datos MySQL para ver sus tablas,
                <br />
                añadir descripciones y crear tu primer grupo.
              </p>
              <button
                className="button primary"
                onClick={() => setTab("Connect")}
              >
                Conectar base de datos <span>→</span>
              </button>
            </div>
          ) : (
            <div className="database-workspace">
              <aside className="table-sidebar">
                <div className="sidebar-db">
                  <Icon name="database" />
                  <strong>{connection.name}</strong>
                  <span className="dot green" />
                </div>
                <input
                  aria-label="Buscar tablas"
                  className="table-search"
                  placeholder="Buscar tablas…"
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setShowAllTables(false);
                  }}
                />
                <div className="section-label">
                  TABLAS <span>{tables.length}</span>
                </div>
                <div className="table-list" id="database-table-list">
                  {visibleTables.map((t) => (
                    <button
                      key={t.name}
                      className={t.name === selectedTable ? "selected" : ""}
                      onClick={() => setSelectedTable(t.name)}
                    >
                      <Icon name="grid" size={16} />
                      <span>{t.name}</span>
                      {t.notUsed && (
                        <span className="not-used-badge">NOT USED</span>
                      )}
                      <small>{t.fields.length}</small>
                    </button>
                  ))}
                  {matchingTables.length === 0 && (
                    <p className="muted">No se encontraron tablas.</p>
                  )}
                </div>
                {matchingTables.length > 10 && (
                  <button
                    type="button"
                    className="table-list-toggle"
                    aria-expanded={showAllTables}
                    aria-controls="database-table-list"
                    onClick={() => setShowAllTables((expanded) => !expanded)}
                  >
                    {showAllTables ? "− ver menos" : "+ ver más"}
                  </button>
                )}
                <div className="section-label group-label">
                  GRUPOS{" "}
                  <button
                    aria-label="Añadir grupo"
                    onClick={() =>
                      openGroupEditor({
                        id: createGroupId(),
                        name: "",
                        tables: [],
                      })
                    }
                  >
                    <Icon name="plus" size={15} />
                  </button>
                </div>
                {groups.map((g) => (
                  <button
                    className="sidebar-group"
                    key={g.id}
                    onClick={() =>
                      openGroupEditor({ ...g, tables: [...g.tables] })
                    }
                  >
                    <Icon name="folder" size={16} />
                    <span>{g.name}</span>
                    <small>{g.tables.length}</small>
                  </button>
                ))}
                <button
                  className="new-group"
                  onClick={() =>
                    openGroupEditor({
                      id: createGroupId(),
                      name: "",
                      tables: [],
                    })
                  }
                >
                  <Icon name="plus" size={14} />
                  Nuevo grupo
                </button>
              </aside>
              <section className="table-details">
                {currentTable ? (
                  <>
                    <div className="table-title">
                      <div className="soft-icon">
                        <Icon name="grid" size={23} />
                      </div>
                      <div>
                        <span className="eyebrow">TABLA</span>
                        <h2>{currentTable.name}</h2>
                      </div>
                      <span className="pill">
                        {currentTable.fields.length} campos
                      </span>
                    </div>
                    <label className="not-used-control">
                      <input
                        type="checkbox"
                        checked={!!currentTable.notUsed}
                        disabled={busy}
                        onChange={(e) =>
                          updateModelTables([
                            {
                              name: currentTable.name,
                              notUsed: e.target.checked,
                            },
                          ])
                        }
                      />
                      <span>
                        <strong>NOT USED</strong> — excluir esta tabla de todo
                        el contexto de IA y del etiquetado automático.
                      </span>
                    </label>
                    <label className="form-label" htmlFor="table-description">
                      ¿Qué contiene esta tabla?
                    </label>
                    <textarea
                      id="table-description"
                      maxLength={2000}
                      value={currentTable.description || ""}
                      onChange={(e) => describe(e.target.value)}
                      placeholder="Describe esta tabla para ayudar a la IA a entender tus datos…"
                    />
                    {currentTable.labelEvidence && (
                      <LabelEvidenceDetails
                        evidence={currentTable.labelEvidence}
                      />
                    )}
                    <div className="table-group-tags">
                      {groups
                        .filter((g) => g.tables.includes(currentTable.name))
                        .map((g) => (
                          <button
                            className="pill"
                            key={g.id}
                            onClick={() => openGroupEditor({ ...g })}
                          >
                            <Icon name="folder" size={12} />
                            {g.name}
                          </button>
                        ))}
                    </div>
                    <div className="fields-heading">
                      <h3>Campos</h3>
                      <span>Una breve descripción marca la diferencia.</span>
                    </div>
                    <div className="fields-list">
                      <div className="field-row field-header">
                        <span>NOMBRE DEL CAMPO</span>
                        <span>TIPO</span>
                        <span>DESCRIPCIÓN</span>
                      </div>
                      {currentTable.fields.map((field) => (
                        <div className="field-row" key={field.name}>
                          <div className="field-name">
                            <code>{field.name}</code>
                            {field.key === "PRI" && (
                              <small title="Clave primaria">PK</small>
                            )}
                            <span>
                              {field.nullable ? "admite nulos" : "obligatorio"}
                            </span>
                          </div>
                          <code className="field-type">{field.type}</code>
                          <input
                            aria-label={`Descripción de ${field.name}`}
                            maxLength={2000}
                            value={field.description || ""}
                            onChange={(e) => describe(e.target.value, field)}
                            placeholder="Añade una descripción…"
                          />
                        </div>
                      ))}
                    </div>
                  </>
                ) : (
                  <p className="muted">
                    No se encontraron tablas en esta base de datos.
                  </p>
                )}
              </section>
            </div>
          )}
        </main>
      )}

      {groupEditor && tab === "Database" && connection && (
        <div className="modal-backdrop" onClick={() => setGroupEditor(null)}>
          <form
            className="group-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="group-title"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === "Escape") setGroupEditor(null);
              if (e.key === "Tab") {
                const controls = e.currentTarget.querySelectorAll<HTMLElement>(
                  "button:not(:disabled), input, textarea",
                );
                const first = controls[0];
                const last = controls[controls.length - 1];
                if (e.shiftKey && document.activeElement === first) {
                  e.preventDefault();
                  last.focus();
                }
                if (!e.shiftKey && document.activeElement === last) {
                  e.preventDefault();
                  first.focus();
                }
              }
            }}
            onSubmit={(e) => {
              e.preventDefault();
              if (!groupEditor.name.trim()) return;
              setGroups((old) => [
                ...old.filter((g) => g.id !== groupEditor.id),
                { ...groupEditor, name: groupEditor.name.trim() },
              ]);
              resetConversation();
              setGroupEditor(null);
            }}
          >
            <div className="modal-heading">
              <h2 id="group-title">
                {groups.some((g) => g.id === groupEditor.id)
                  ? "Editar grupo"
                  : "Crear un grupo"}
              </h2>
              <button
                type="button"
                aria-label="Cerrar editor de grupos"
                onClick={() => setGroupEditor(null)}
              >
                ×
              </button>
            </div>
            <p className="muted">
              Reúne las tablas relacionadas para hacer preguntas más concretas.
            </p>
            <label className="form-label" htmlFor="group-name">
              Nombre del grupo
            </label>
            <input
              id="group-name"
              autoFocus
              required
              maxLength={80}
              placeholder="p. ej., Trabajadores"
              value={groupEditor.name}
              onChange={(e) =>
                setGroupEditor({ ...groupEditor, name: e.target.value })
              }
            />
            <div className="section-label">
              INCLUIR TABLAS{" "}
              <span>{groupEditor.tables.length} seleccionadas</span>
            </div>
            <input
              type="search"
              aria-label="Buscar tablas para incluir en el grupo"
              placeholder="Buscar tablas…"
              value={groupTableSearch}
              onChange={(e) => setGroupTableSearch(e.target.value)}
            />
            <div className="modal-tables">
              {matchingGroupTables.map((t) => (
                <label key={t.name}>
                  <input
                    type="checkbox"
                    checked={groupEditor.tables.includes(t.name)}
                    onChange={(e) =>
                      setGroupEditor({
                        ...groupEditor,
                        tables: e.target.checked
                          ? [...groupEditor.tables, t.name]
                          : groupEditor.tables.filter((n) => n !== t.name),
                      })
                    }
                  />
                  <Icon name="grid" size={16} />
                  {t.name}
                </label>
              ))}
              {matchingGroupTables.length === 0 && (
                <p className="muted" role="status">
                  {tables.length === 0
                    ? "No hay tablas disponibles."
                    : "Ninguna tabla coincide con tu búsqueda."}
                </p>
              )}
            </div>
            <div className="modal-actions">
              {groups.some((g) => g.id === groupEditor.id) && (
                <button
                  className="delete-button"
                  type="button"
                  onClick={() => {
                    setGroups((old) =>
                      old.filter((g) => g.id !== groupEditor.id),
                    );
                    setSelectedGroups((old) =>
                      old.filter((id) => id !== groupEditor.id),
                    );
                    resetConversation();
                    setGroupEditor(null);
                  }}
                >
                  Eliminar grupo
                </button>
              )}
              <button
                type="button"
                className="button secondary"
                onClick={() => setGroupEditor(null)}
              >
                Cancelar
              </button>
              <button className="button primary">Guardar grupo</button>
            </div>
          </form>
        </div>
      )}
      <footer className="footer">
        <span>Hecho para mentes curiosas.</span>
        <span>
          <span className="dot green" />
          Solo lectura por diseño
        </span>
      </footer>
    </div>
  );
}
