"use client";

import { useEffect, useRef, useState } from "react";
import { modelJson, type Analysis } from "@/lib/yii-analysis";
import UsageImport, { type ModelWorkspaceProps } from "./usage-import";
import CodeArchive from "./code-archive";

function download(content: BlobPart, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export default function ModelsPage(props: ModelWorkspaceProps) {
  const [result, setResult] = useState<Analysis | null>(null);
  const [zip, setZip] = useState<Uint8Array<ArrayBuffer> | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const worker = useRef<Worker | null>(null);
  useEffect(() => () => worker.current?.terminate(), []);
  function analyze(files: FileList | null) {
    if (!files?.length) return;
    worker.current?.terminate();
    setBusy(true);
    setError("");
    setResult(null);
    setZip(null);
    setQuery("");
    setStatus("Leyendo proyecto…");
    const next = new Worker(new URL("./yii.worker.ts", import.meta.url));
    worker.current = next;
    next.onmessage = ({ data }) => {
      if (data.type === "progress") setStatus(data.message);
      else {
        setBusy(false);
        if (data.type === "error") {
          setError(data.message);
          setStatus("");
        } else {
          setResult(data.result);
          setZip(data.zip);
          setStatus("Análisis terminado.");
        }
        next.terminate();
      }
    };
    next.onerror = () => {
      setBusy(false);
      setError(
        "No se pudo iniciar el analizador. Recarga la página e inténtalo de nuevo.",
      );
      setStatus("");
      next.terminate();
    };
    next.postMessage(Array.from(files));
  }
  const visible =
    result?.models.filter((m) =>
      `${m.model} ${m.module || ""} ${m.file}`
        .toLowerCase()
        .includes(query.toLowerCase()),
    ) || [];
  return (
    <main className="settings-page transform-page yii-page">
      <div className="page-bar">
        <div>
          <span className="transform-eyebrow">EXPLORADOR DE CÓDIGO YII2</span>
          <h1>Modelos, Controladores y Más</h1>
          <p>
            Convierte tu proyecto PHP en un mapa de tablas, modelos y funciones
            para compartir con tu IA.
          </p>
        </div>
      </div>
      <CodeArchive
        key={`code-${props.connectionId || "disconnected"}`}
        connectionId={props.connectionId}
      />
      <section className="transform-card">
        <h2>1. Selecciona tu proyecto</h2>
        <p>
          Sube un ZIP con todas sus subcarpetas, selecciona una carpeta completa
          o varios archivos PHP. No necesitas conectar una base de datos. El
          análisis se realiza en tu navegador.
        </p>
        <div className="yii-inputs">
          <label className="transform-upload">
            ZIP o archivos PHP
            <input
              type="file"
              multiple
              accept=".zip,.php"
              disabled={busy}
              onChange={(e) => {
                analyze(e.target.files);
                e.target.value = "";
              }}
            />
          </label>
          <label className="transform-upload">
            Carpeta y todas sus subcarpetas
            <input
              type="file"
              multiple
              {...{ webkitdirectory: "" }}
              disabled={busy}
              onChange={(e) => {
                analyze(e.target.files);
                e.target.value = "";
              }}
            />
          </label>
        </div>
        <p className="transform-hint">
          Hasta 20.000 archivos PHP y 100 MB descomprimidos. Se detectan clases
          que heredan de yii\db\ActiveRecord, incluso a través de clases base
          incluidas. Los modelos de formulario sin tabla no se exportan.
        </p>
        <p role="status" aria-live="polite">
          {status}
        </p>
        {busy && (
          <button
            className="button"
            onClick={() => {
              worker.current?.terminate();
              setBusy(false);
              setStatus("Análisis cancelado.");
            }}
          >
            Cancelar
          </button>
        )}
        {error && (
          <p role="alert" className="transform-error">
            {error}
          </p>
        )}
      </section>
      {result && (
        <>
          <section className="transform-card">
            <h2>2. Descarga el contexto para tu IA</h2>
            <div className="transform-stats">
              <div>
                <strong>{result.files}</strong>
                <span>Archivos PHP leídos</span>
              </div>
              <div>
                <strong>{result.models.length}</strong>
                <span>Modelos detectados</span>
              </div>
              <div>
                <strong>
                  {result.models.reduce((n, m) => n + m.functions.length, 0)}
                </strong>
                <span>Vínculos entre modelos y funciones</span>
              </div>
            </div>
            <p>
              El ZIP incluye tres JSON por modelo: <code>sin-codigo/</code> con
              tabla, funciones, controlador, clase, archivo y línea; y{" "}
              <code>con-codigo/</code> con el mismo mapa, la función completa y
              su cuerpo original sin modificar; y <code>simplificado/</code> con
              el nombre y archivo de cada función para el etiquetado automático.
            </p>
            <button
              className="button primary"
              disabled={!zip || !result.models.length}
              onClick={() =>
                zip && download(zip, "modelos-yii2.zip", "application/zip")
              }
            >
              Descargar todos los JSON (.zip)
            </button>
            {!result.models.length && (
              <p>
                No se detectaron modelos de base de datos. Incluye los modelos y
                sus clases base en la selección y revisa las incidencias.
              </p>
            )}
            <p className="transform-hint">
              Análisis estático, sin IA ni ejecución de PHP. Reconoce
              referencias a clases y llamadas a métodos estáticos o de $this,
              incluidos helpers como findModel. SQL libre, reflexión, clases
              dinámicas, métodos de traits y algunos flujos de variables pueden
              quedar sin vincular. Las tablas dinámicas se marcan como
              pendientes; los prefijos de conexión de Yii no se inventan.
            </p>
            {result.warnings.length > 0 && (
              <details>
                <summary>
                  {result.warnings.length} incidencias — revisa la cobertura
                </summary>
                <ul className="yii-warnings">
                  {result.warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </details>
            )}
          </section>
          <section className="transform-card">
            <h2>3. Explora los modelos</h2>
            <input
              aria-label="Buscar modelo o tabla"
              placeholder="Buscar modelo, tabla o archivo…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <div className="transform-results">
              {visible.map((m, index) => (
                <details key={`${m.file}:${m.model}`}>
                  <summary>
                    <strong>{m.module || "Tabla pendiente"}</strong> · {m.model}{" "}
                    <span className="transform-badge valid">
                      {m.functions.length} funciones
                    </span>
                  </summary>
                  <p>
                    <code>{m.file}</code> · Tabla: {m.tableResolution}
                  </p>
                  <div className="yii-actions">
                    {[false, true].map((code) => (
                      <button
                        key={String(code)}
                        className="button"
                        onClick={() =>
                          download(
                            modelJson(m, code),
                            `${index + 1}-${m.model.replace(/[^a-zA-Z0-9_-]/g, "_")}${code ? "-codigo" : ""}.json`,
                            "application/json",
                          )
                        }
                      >
                        {code ? "JSON con código" : "JSON sin código"}
                      </button>
                    ))}
                  </div>
                  <ul>
                    {m.functions.map((f, i) => (
                      <li key={i}>
                        <div>
                          <strong>{f.name}</strong>
                          <br />
                          <code>
                            {f.controller || f.class || "Función global"}
                          </code>
                          <br />
                          <small>
                            {f.file}:{f.line}
                          </small>
                        </div>
                      </li>
                    ))}
                  </ul>
                </details>
              ))}
            </div>
            {!visible.length && result.models.length > 0 && (
              <p>No hay modelos que coincidan con la búsqueda.</p>
            )}
          </section>
        </>
      )}
      <UsageImport key={props.connectionId || "disconnected"} {...props} />
    </main>
  );
}
