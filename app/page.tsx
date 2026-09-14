"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { createGroupId } from "@/lib/group-id";
import AnswerView from "./answer-view";
import type { ChatAnswer, Field, Group, Table } from "@/lib/types";

type Connection = {
  name: string;
  id: string;
  tables: Table[];
  model: string;
  aiReady: boolean;
};
type Result = { question: string; answer?: ChatAnswer; error?: string };
type Tab = "Chat" | "Database" | "Connect";

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
  const [model, setModel] = useState("openrouter/auto");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [question, setQuestion] = useState("");
  const [results, setResults] = useState<Result[]>([]);
  const [groupEditor, setGroupEditor] = useState<Group | null>(null);
  const [groupTableSearch, setGroupTableSearch] = useState("");
  const [showAllTables, setShowAllTables] = useState(false);
  const [contextOpen, setContextOpen] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);

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

  function loadConnection(data: Connection) {
    let saved: { tables?: Table[]; groups?: Group[] } = {};
    try {
      saved = JSON.parse(localStorage.getItem(`datamatic:${data.id}`) || "{}");
    } catch {
      /* Start fresh if browser storage is unavailable. */
    }
    const merged = data.tables.map((t) => {
      const previous = saved.tables?.find((old) => old.name === t.name);
      return {
        ...t,
        description: previous?.description || "",
        fields: t.fields.map((f) => ({
          ...f,
          description:
            previous?.fields.find((old) => old.name === f.name)?.description ||
            "",
        })),
      };
    });
    const restored = (saved.groups || []).map((g) => ({
      ...g,
      tables: g.tables.filter((name) => merged.some((t) => t.name === name)),
    }));
    setConnection(data);
    setTables(merged);
    setShowAllTables(false);
    setGroups(restored);
    setSelectedGroups([]);
    setSelectedTable(merged[0]?.name || "");
    setModel(data.model);
    setResults([]);
  }

  useEffect(() => {
    fetch("/api/connect")
      .then((r) => r.json())
      .then((data) => {
        if (data.id) loadConnection(data);
      })
      .catch(() =>
        setError("Unable to restore the connection. Please reconnect."),
      );
  }, []);

  useEffect(() => {
    if (!connection) return;
    try {
      localStorage.setItem(
        `datamatic:${connection.id}`,
        JSON.stringify({ tables, groups }),
      );
    } catch {
      setError(
        "Browser storage is unavailable. Descriptions and groups will not survive a refresh.",
      );
    }
  }, [tables, groups, connection]);

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
        body: JSON.stringify({ url, apiKey, model }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      loadConnection(data);
      setUrl("");
      setApiKey("");
      setTab("Database");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Connection failed.");
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/connect", { method: "DELETE" });
      if (!response.ok) throw new Error("Could not disconnect. Try again.");
      setConnection(null);
      setTables([]);
      setGroups([]);
      setSelectedGroups([]);
      setResults([]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not disconnect.");
    } finally {
      setBusy(false);
    }
  }

  const contextTables = tables.filter((t) =>
    groups.some(
      (g) => selectedGroups.includes(g.id) && g.tables.includes(t.name),
    ),
  );
  const currentTable = tables.find((t) => t.name === selectedTable);

  async function ask(event: React.FormEvent) {
    event.preventDefault();
    if (!question.trim() || busy) return;
    if (!connection) {
      setTab("Connect");
      return;
    }
    if (!contextTables.length) {
      setError(
        "Select a group with at least one table before asking a question.",
      );
      setContextOpen(true);
      return;
    }
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
              queries: r.answer!.steps.map((step) => step.sql),
            }),
          },
        ]);
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: text,
          tables: contextTables,
          history,
        }),
      });
      const data = await response.json();
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
          error: e instanceof Error ? e.message : "Query failed.",
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
            : { ...t, description: value },
      ),
    );
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <Link className="brand" href="/" aria-label="Datamatic home">
          <span className="brand-mark">
            <i />
            <i />
            <i />
          </span>
          datamatic<span className="beta">BETA</span>
        </Link>
        <nav aria-label="Main navigation">
          {(["Chat", "Database", "Connect"] as Tab[]).map((item) => (
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
              {item}
            </button>
          ))}
        </nav>
        <button
          className="connection-status"
          disabled={busy}
          onClick={() => setTab("Connect")}
        >
          <span className={connection ? "dot green" : "dot"} />
          {connection ? connection.name : "No database connected"}
          <span className="status-chevron">⌄</span>
        </button>
      </header>
      {error && (
        <div className="error-banner" role="alert">
          {error}
          <button aria-label="Dismiss error" onClick={() => setError("")}>
            ×
          </button>
        </div>
      )}

      {tab === "Chat" && (
        <main className="chat-layout">
          <div className="page-bar">
            <div>
              <h1>Chat with your data</h1>
              <p>Good questions. Clear answers. Straight from your database.</p>
            </div>
            <button
              className="button secondary small"
              disabled={busy || !results.length}
              onClick={() => {
                setResults([]);
                setQuestion("");
              }}
            >
              <Icon name="plus" size={15} />
              New chat
            </button>
          </div>
          <div className="chat-workspace">
            <section className="conversation" aria-label="Chat conversation">
              {!results.length ? (
                <div className="welcome">
                  <div className="welcome-icon">
                    <Icon name="spark" size={29} />
                    <span className="mini-spark">✦</span>
                  </div>
                  <span className="eyebrow">
                    A LITTLE CURIOSITY GOES A LONG WAY
                  </span>
                  <h2>
                    Your data has answers.
                    <br />
                    <span>Just ask.</span>
                  </h2>
                  <p>
                    Explore your database in plain English.
                    <br />
                    Choose your groups, ask a question, and explore a clear
                    answer.
                  </p>
                  <div className="suggestions">
                    {[
                      [
                        "Find an overview",
                        "How many workers are in each company?",
                        "grid",
                      ],
                      [
                        "Connect the dots",
                        "Which workers have no assigned route?",
                        "connect",
                      ],
                      [
                        "Explore a little deeper",
                        "Show the 10 companies with the most workers.",
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
                      Connect your first database to get started <span>→</span>
                    </button>
                  )}
                </div>
              ) : (
                <div className="messages">
                  {results.map((result, index) => (
                    <article className="message" key={index}>
                      <div className="user-question">
                        <span className="avatar">Y</span>
                        <div>
                          <small>You</small>
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
                              Generating and running your query…
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
                    aria-label="Ask a question about your data"
                    placeholder="Ask anything about your data…"
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
                      onClick={() => setContextOpen(!contextOpen)}
                    >
                      <Icon name="folder" size={15} />
                      {selectedGroups.length
                        ? `${selectedGroups.length} group${selectedGroups.length > 1 ? "s" : ""} selected`
                        : "Select groups"}
                      <span>⌄</span>
                    </button>
                    <div className="send-controls">
                      <span>Enter to send</span>
                      <button
                        className="send-button"
                        aria-label="Send question"
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
                    Read-only queries. Query results are shared with AI.
                  </span>
                  <span>Powered by OpenRouter</span>
                </div>
              </div>
            </section>
            <aside
              className={`context-panel ${contextOpen ? "mobile-open" : ""}`}
            >
              <div className="aside-heading">
                <span>Conversation context</span>
                <Icon name="folder" size={17} />
              </div>
              <p>
                Select the groups you want to explore.
                <br />
                Their schema and query results are shared with AI.
              </p>
              <div className="section-label">
                YOUR GROUPS{" "}
                <button
                  aria-label="Create group"
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
                          setResults([]);
                        }}
                      />
                      <span>
                        <strong>{g.name}</strong>
                        <small>{g.tables.length} tables</small>
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
                  <strong>A little context helps</strong>
                  <p>
                    Organize related tables into groups
                    <br />
                    to give your questions a focus.
                  </p>
                  <button
                    onClick={() => setTab(connection ? "Database" : "Connect")}
                  >
                    {connection ? "Create a group" : "Connect a database"}{" "}
                    <span>→</span>
                  </button>
                </div>
              )}
              <div className="context-summary">
                <span>Tables in context</span>
                <b>{contextTables.length.toString().padStart(2, "0")}</b>
              </div>
              {!!contextTables.length && (
                <div className="context-tables">
                  {contextTables.map((t) => (
                    <span key={t.name}>
                      <Icon name="grid" size={13} />
                      {t.name}
                    </span>
                  ))}
                  <details>
                    <summary>Preview schema JSON</summary>
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
              <div className="context-tip">
                <Icon name="spark" size={17} />
                <p>
                  <strong>Better context, better answers</strong>Add
                  descriptions to your tables and fields to help AI understand
                  your data.
                  <button disabled={busy} onClick={() => setTab("Database")}>
                    Manage your database →
                  </button>
                </p>
              </div>
              <button
                className="mobile-done button secondary"
                onClick={() => setContextOpen(false)}
              >
                Done
              </button>
            </aside>
          </div>
        </main>
      )}

      {tab === "Connect" && (
        <main className="settings-page">
          <div className="page-bar">
            <div>
              <span className="eyebrow">LET’S MAKE A CONNECTION</span>
              <h1>Bring your data along.</h1>
              <p>Your database, a little more approachable.</p>
            </div>
          </div>
          <div className="connect-grid">
            <form className="settings-card" onSubmit={connect}>
              <div className="card-heading">
                <div className="soft-icon">
                  <Icon name="database" size={22} />
                </div>
                <div>
                  <h2>Connect to MySQL</h2>
                  <p>One connection. A whole new way to explore.</p>
                </div>
              </div>
              {connection && (
                <div className="connected-notice">
                  <span className="dot green" />
                  Connected to <strong>{connection.name}</strong>
                  <button type="button" disabled={busy} onClick={disconnect}>
                    Disconnect
                  </button>
                </div>
              )}
              <label className="form-label" htmlFor="mysql-url">
                Connection URL
              </label>
              <input
                id="mysql-url"
                type="password"
                autoComplete="off"
                required
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="mysql://user:password@host:3306/database"
              />
              <p className="field-help">
                Use a MySQL user with SELECT-only permissions. Add ?ssl=true for
                TLS.
              </p>
              <div className="form-divider" />
              <h3>Meet your AI</h3>
              <p className="muted">
                Connect an OpenRouter model to translate questions into SQL.
              </p>
              <label className="form-label" htmlFor="api-key">
                OpenRouter API key <span>Optional if set on the server</span>
              </label>
              <input
                id="api-key"
                type="password"
                autoComplete="off"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="sk-or-v1-…"
              />
              <label className="form-label" htmlFor="model">
                Model
              </label>
              <input
                id="model"
                required
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder="openrouter/auto"
              />
              <p className="field-help">
                Enter any model ID available in your OpenRouter account.
              </p>
              <button className="button primary connect-button" disabled={busy}>
                {busy
                  ? "Connecting…"
                  : connection
                    ? "Reconnect & refresh schema"
                    : "Connect database"}
                <span>→</span>
              </button>
            </form>
            <div className="setup-guide">
              <span className="eyebrow">FROM CONNECTION TO CONVERSATION</span>
              {[
                [
                  "01",
                  "Connect your database",
                  "Securely connect to MySQL with your connection URL.",
                ],
                [
                  "02",
                  "Give your data context",
                  "Describe your tables and fields, then put related tables into groups.",
                ],
                [
                  "03",
                  "Let curiosity lead",
                  "Choose a group and ask a question. Get a clear answer with tables or charts.",
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
                <h3>Built to look, never change.</h3>
                <p>
                  Queries are validated and run in a read-only transaction. Only
                  your selected schema, questions, and bounded query results go
                  to the model so it can explain the data and choose a useful
                  view.
                </p>
                <p>
                  Credentials are held in a server session for up to 8 hours,
                  not in browser storage.
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
              <h1>Your database, with context.</h1>
              <p>Describe what matters. Group what belongs together.</p>
            </div>
            {connection && (
              <span className="save-status">
                <Icon name="check" size={14} />
                Saved in this browser
              </span>
            )}
          </div>
          {!connection ? (
            <div className="large-empty">
              <div className="welcome-icon">
                <Icon name="database" size={28} />
              </div>
              <h2>A home for your data.</h2>
              <p>
                Connect your MySQL database to see its tables,
                <br />
                add descriptions, and create your first group.
              </p>
              <button
                className="button primary"
                onClick={() => setTab("Connect")}
              >
                Connect database <span>→</span>
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
                  aria-label="Search tables"
                  className="table-search"
                  placeholder="Search tables…"
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setShowAllTables(false);
                  }}
                />
                <div className="section-label">
                  TABLES <span>{tables.length}</span>
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
                      <small>{t.fields.length}</small>
                    </button>
                  ))}
                  {matchingTables.length === 0 && (
                    <p className="muted">No tables found.</p>
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
                    {showAllTables ? "− see less" : "+ see more"}
                  </button>
                )}
                <div className="section-label group-label">
                  GROUPS{" "}
                  <button
                    aria-label="Add group"
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
                  New group
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
                        <span className="eyebrow">TABLE</span>
                        <h2>{currentTable.name}</h2>
                      </div>
                      <span className="pill">
                        {currentTable.fields.length} fields
                      </span>
                    </div>
                    <label className="form-label" htmlFor="table-description">
                      What’s in this table?
                    </label>
                    <textarea
                      id="table-description"
                      maxLength={2000}
                      value={currentTable.description || ""}
                      onChange={(e) => describe(e.target.value)}
                      placeholder="Describe this table to help AI understand your data…"
                    />
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
                      <h3>Fields</h3>
                      <span>A little description makes a big difference.</span>
                    </div>
                    <div className="fields-list">
                      <div className="field-row field-header">
                        <span>FIELD NAME</span>
                        <span>TYPE</span>
                        <span>DESCRIPTION</span>
                      </div>
                      {currentTable.fields.map((field) => (
                        <div className="field-row" key={field.name}>
                          <div className="field-name">
                            <code>{field.name}</code>
                            {field.key === "PRI" && (
                              <small title="Primary key">PK</small>
                            )}
                            <span>
                              {field.nullable ? "nullable" : "required"}
                            </span>
                          </div>
                          <code className="field-type">{field.type}</code>
                          <input
                            aria-label={`Description for ${field.name}`}
                            maxLength={2000}
                            value={field.description || ""}
                            onChange={(e) => describe(e.target.value, field)}
                            placeholder="Add a description…"
                          />
                        </div>
                      ))}
                    </div>
                  </>
                ) : (
                  <p className="muted">
                    No tables were found in this database.
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
              setResults([]);
              setGroupEditor(null);
            }}
          >
            <div className="modal-heading">
              <h2 id="group-title">
                {groups.some((g) => g.id === groupEditor.id)
                  ? "Edit group"
                  : "Create a group"}
              </h2>
              <button
                type="button"
                aria-label="Close group editor"
                onClick={() => setGroupEditor(null)}
              >
                ×
              </button>
            </div>
            <p className="muted">
              Bring related tables together for more focused questions.
            </p>
            <label className="form-label" htmlFor="group-name">
              Group name
            </label>
            <input
              id="group-name"
              autoFocus
              required
              maxLength={80}
              placeholder="e.g. Workers"
              value={groupEditor.name}
              onChange={(e) =>
                setGroupEditor({ ...groupEditor, name: e.target.value })
              }
            />
            <div className="section-label">
              INCLUDE TABLES <span>{groupEditor.tables.length} selected</span>
            </div>
            <input
              type="search"
              aria-label="Search tables to include in group"
              placeholder="Search tables…"
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
                    ? "No tables available."
                    : "No tables match your search."}
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
                    setResults([]);
                    setGroupEditor(null);
                  }}
                >
                  Delete group
                </button>
              )}
              <button
                type="button"
                className="button secondary"
                onClick={() => setGroupEditor(null)}
              >
                Cancel
              </button>
              <button className="button primary">Save group</button>
            </div>
          </form>
        </div>
      )}
      <footer className="footer">
        <span>Made for curious minds.</span>
        <span>
          <span className="dot green" />
          Read-only by design
        </span>
      </footer>
    </div>
  );
}
