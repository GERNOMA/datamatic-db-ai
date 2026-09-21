"use client";

import { useEffect, useRef, useState } from "react";
import {
  groupTableUsage,
  reviewTableUsage,
  type ImportedZip,
} from "@/lib/yii-import";
import type { LabelResult } from "@/lib/automatic-labels";
import type { Table } from "@/lib/types";

export type TableUpdate = {
  name: string;
  notUsed?: boolean;
  description?: string;
};
export type ModelWorkspaceProps = {
  tables: Table[];
  connectionId?: string;
  connectionName?: string;
  aiReady?: boolean;
  onUpdate: (updates: TableUpdate[]) => void;
  onConnect: () => void;
};

export default function UsageImport({
  tables,
  connectionId,
  connectionName,
  aiReady,
  onUpdate,
  onConnect,
}: ModelWorkspaceProps) {
  const [imported, setImported] = useState<ImportedZip | null>(null);
  const [filename, setFilename] = useState("");
  const [reading, setReading] = useState(false);
  const [error, setError] = useState("");
  const [applied, setApplied] = useState(false);
  const [model, setModel] = useState("");
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<LabelResult[]>([]);
  const [total, setTotal] = useState(0);
  const [message, setMessage] = useState("");
  const worker = useRef<Worker | null>(null);
  const abort = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      worker.current?.terminate();
      abort.current?.abort();
    },
    [],
  );
  const usages = groupTableUsage(imported?.models || []);
  const known = new Map(tables.map((t) => [t.name, t]));
  const matched = usages.filter((u) => known.has(u.name));
  const review = reviewTableUsage(usages, tables);
  const unused = review.filter((u) => u.notUsed);
  const absent = review.filter((u) => !u.detected);
  const missing = usages.filter((u) => !known.has(u.name));
  const eligible = matched.filter((u) => !known.get(u.name)?.notUsed);
  const errors = results.filter((r) => r.error);

  function read(file?: File) {
    if (!file) return;
    worker.current?.terminate();
    setImported(null);
    setApplied(false);
    setResults([]);
    setTotal(0);
    setError("");
    setMessage("");
    setFilename(file.name);
    setReading(true);
    const next = new Worker(new URL("./import.worker.ts", import.meta.url));
    worker.current = next;
    next.onmessage = ({ data }) => {
      setReading(false);
      if (data.error) setError(data.error);
      else setImported(data.result);
      next.terminate();
    };
    next.onerror = () => {
      setReading(false);
      setError("No se pudo leer el ZIP. Inténtalo de nuevo.");
      next.terminate();
    };
    next.postMessage(file);
  }
  function apply() {
    onUpdate(unused.map((u) => ({ name: u.name, notUsed: true })));
    setApplied(true);
  }
  async function label(retry = false) {
    const targets = eligible.filter(
      (u) => !retry || errors.some((r) => r.table === u.name),
    );
    if (!targets.length || !model.trim()) return;
    const controller = new AbortController();
    abort.current = controller;
    setRunning(true);
    setError("");
    setMessage("");
    setResults([]);
    setTotal(targets.length);
    let completed = 0;
    try {
      const response = await fetch("/api/labels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          connectionId,
          model: model.trim(),
          notUsedTables: tables.filter((t) => t.notUsed).map((t) => t.name),
          tables: targets.map((u) => ({
            module: u.name,
            functions: u.functions,
          })),
        }),
      });
      if (!response.ok) throw new Error((await response.json()).error);
      if (!response.body) throw new Error("No se recibieron resultados.");
      const reader = response.body.getReader(),
        decoder = new TextDecoder();
      let buffer = "",
        done = false;
      for (;;) {
        const chunk = await reader.read();
        buffer += decoder.decode(chunk.value, { stream: !chunk.done });
        const lines = buffer.split("\n");
        buffer = lines.pop()!;
        for (const line of lines) {
          if (!line.trim()) continue;
          const item = JSON.parse(line);
          if (item.done) {
            done = true;
            continue;
          }
          completed++;
          setResults((previous) => [...previous, item]);
          if (typeof item.description === "string")
            onUpdate([{ name: item.table, description: item.description }]);
        }
        if (chunk.done) break;
      }
      if (!done || completed !== targets.length)
        throw new Error(
          "El lote se interrumpió. Las descripciones recibidas ya están guardadas; puedes volver a iniciar el etiquetado.",
        );
      setMessage(
        "Etiquetado terminado. Las descripciones correctas se han guardado en las tablas.",
      );
    } catch (e) {
      if (controller.signal.aborted)
        setMessage(
          "Etiquetado cancelado. Se conservan las descripciones recibidas.",
        );
      else setError(e instanceof Error ? e.message : "No se pudo etiquetar.");
    } finally {
      setRunning(false);
    }
  }
  return (
    <>
      <section className="transform-card">
        <h2>4. Revisa qué tablas se usan</h2>
        <p>
          Sube el ZIP de JSON generado arriba. Comparamos la clase de cada
          función con su modelo: si ninguna función pertenece a otra clase, su
          tabla se puede marcar como <strong>NOT USED</strong>.
        </p>
        {!connectionId ? (
          <>
            <p>
              Conecta la base de datos para guardar los estados en sus tablas.
            </p>
            <button className="button primary" onClick={onConnect}>
              Conectarse
            </button>
          </>
        ) : (
          <>
            <p className="transform-hint">
              Base de datos: <strong>{connectionName}</strong>. Las tablas que
              no aparecen en el ZIP también se marcarán NOT USED. Una tabla
              compartida por varios modelos se considera usada si cualquiera
              tiene uso externo.
            </p>
            <label className="transform-upload">
              ZIP de modelos (JSON)
              <input
                type="file"
                accept=".zip"
                disabled={running || reading}
                onChange={(e) => {
                  read(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
            </label>
            {reading && <p role="status">Leyendo y comprobando los JSON…</p>}
            {imported && (
              <>
                <p>
                  {filename} · {imported.models.length} modelos
                </p>
                <div className="transform-stats">
                  <div>
                    <strong>
                      {matched.filter((u) => !u.externallyUsed).length}
                    </strong>
                    <span>Detectadas sin uso externo</span>
                  </div>
                  <div>
                    <strong>{absent.length}</strong>
                    <span>Ausentes del ZIP → NOT USED</span>
                  </div>
                  <div>
                    <strong>{unused.length}</strong>
                    <span>Total a marcar NOT USED</span>
                  </div>
                </div>
                <p>
                  NOT USED excluye una tabla de todo el contexto de IA y del
                  etiquetado. Se guarda en este navegador y en las copias del
                  espacio de trabajo; puedes quitar la marca en Base de Datos.
                </p>
                <details>
                  <summary>Ver resultado por tabla</summary>
                  <ul className="yii-warnings">
                    {review.map((u) => (
                      <li key={u.name}>
                        <code>{u.name}</code> —{" "}
                        {!u.detected
                          ? "Ausente del ZIP → NOT USED"
                          : u.notUsed
                            ? "Sin uso externo → NOT USED"
                            : "Con uso externo"}
                        {known.get(u.name)?.notUsed
                          ? " · ya marcada NOT USED"
                          : ""}
                      </li>
                    ))}
                  </ul>
                </details>
                {!!(missing.length || imported.warnings.length) && (
                  <details>
                    <summary>
                      Tablas sin resolver e incidencias (
                      {missing.length + imported.warnings.length})
                    </summary>
                    <ul className="yii-warnings">
                      {missing.map((u) => (
                        <li key={u.name}>
                          {u.name}: sin coincidencia exacta; revisa el prefijo
                          de tabla de Yii.
                        </li>
                      ))}
                      {imported.warnings.map((w, i) => (
                        <li key={i}>{w}</li>
                      ))}
                    </ul>
                  </details>
                )}
                <button
                  className="button primary"
                  disabled={applied || !tables.length || running}
                  onClick={apply}
                >
                  {applied
                    ? "Estados aplicados"
                    : `Aplicar revisión · ${unused.filter((u) => !known.get(u.name)?.notUsed).length} nuevas NOT USED`}
                </button>
                <p className="transform-hint">
                  La ausencia de referencias en este ZIP no prueba que la tabla
                  esté obsoleta. Revisa los resultados si faltan archivos o
                  existen usos dinámicos. Las marcas previas solo se quitan
                  manualmente.
                </p>
              </>
            )}
          </>
        )}
      </section>
      {imported && (
        <section className="transform-card">
          <h2>5. Automatic labeling</h2>
          <p>
            Genera una descripción muy corta para cada tabla activa del ZIP. Se
            envía una solicitud por tabla, todas en paralelo, con el nombre de
            la tabla y solo el nombre y archivo de sus funciones.
          </p>
          <label className="yii-model-label">
            Modelo de OpenRouter
            <input
              value={model}
              disabled={running}
              placeholder="proveedor/modelo"
              onChange={(e) => setModel(e.target.value)}
            />
          </label>
          <p className="transform-hint">
            {eligible.length} tablas elegibles ·{" "}
            {tables.filter((t) => t.notUsed).length} excluidas por NOT USED. Usa
            la clave de Conectarse. Las descripciones existentes se reemplazan
            solo cuando la respuesta es válida. OpenRouter cobra según el modelo
            seleccionado.
          </p>
          {!applied && (
            <p>
              Aplica primero la revisión de uso para excluir las tablas sin
              referencias externas.
            </p>
          )}
          {!aiReady && (
            <p>Añade tu clave de OpenRouter en Conectarse antes de iniciar.</p>
          )}
          <div className="yii-actions">
            <button
              className="button primary"
              disabled={
                !applied ||
                !aiReady ||
                !model.trim() ||
                !eligible.length ||
                running
              }
              onClick={() => label()}
            >
              Etiquetar {eligible.length} tablas en paralelo
            </button>
            {!!errors.length && !running && (
              <button
                className="button"
                disabled={!model.trim()}
                onClick={() => label(true)}
              >
                Reintentar fallidas ({errors.length})
              </button>
            )}
            {running && (
              <button className="button" onClick={() => abort.current?.abort()}>
                Cancelar etiquetado
              </button>
            )}
          </div>
          {!!total && (
            <p role="status">
              {results.length} / {total} completadas ·{" "}
              {results.filter((r) => r.description).length} guardadas ·{" "}
              {errors.length} fallidas
            </p>
          )}
          {!!errors.length && (
            <details>
              <summary>Ver solicitudes fallidas</summary>
              <ul className="yii-warnings">
                {errors.map((r) => (
                  <li key={r.table}>
                    <strong>{r.table}</strong>: {r.error}
                    {r.modelResponse && (
                      <details className="label-response">
                        <summary>Ver respuesta del modelo</summary>
                        <pre>{r.modelResponse}</pre>
                      </details>
                    )}
                  </li>
                ))}
              </ul>
            </details>
          )}
          {message && (
            <p role="status" className="transform-success">
              {message}
            </p>
          )}
        </section>
      )}
      {error && (
        <p className="transform-error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
