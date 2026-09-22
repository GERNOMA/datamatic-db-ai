"use client";

import { useEffect, useState } from "react";
import type { CodeArchiveInfo } from "@/lib/code-context";

export default function CodeArchive({
  connectionId,
}: {
  connectionId?: string;
}) {
  const [archive, setArchive] = useState<CodeArchiveInfo | null>(null);
  const [databaseTables, setDatabaseTables] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  useEffect(() => {
    if (!connectionId) return;
    const controller = new AbortController();
    fetch("/api/code", { signal: controller.signal })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error);
        setArchive(data.archive);
        setDatabaseTables(data.databaseTables);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, [connectionId]);
  async function save(init: RequestInit) {
    setBusy(true);
    setError("");
    setStatus("");
    try {
      const response = await fetch("/api/code", init);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setArchive(data.archive);
      setDatabaseTables(data.databaseTables);
      setStatus("Guardado. Disponible para la próxima pregunta del chat.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="transform-card code-archive-card">
      <span className="transform-eyebrow">CÓDIGO PARA EL CHAT · JEV</span>
      <h2>Archivo guardado en la web</h2>
      <p>
        Guarda un RAR o ZIP con los JSON de <code>con-codigo/</code>. La IA
        podrá pedir a JEV que busque funciones relacionadas con lo que necesita
        resolver, entre los modelos de las tablas en contexto. Solo recibirá el
        código de las coincidencias.
      </p>
      {!connectionId ? (
        <p>Conecta una base de datos para guardar su archivo de código.</p>
      ) : (
        <>
          {databaseTables !== null && (
            <p>{databaseTables} tablas en la base de datos actual.</p>
          )}
          {archive && (
            <div className="code-archive-summary">
              <strong>{archive.name}</strong>
              <span>
                {archive.models} modelos · {archive.functions} funciones únicas
              </span>
              <span>
                {archive.storedTables} tablas guardadas de {archive.jsonTables}{" "}
                tablas en los JSON
                {databaseTables !== null &&
                  ` · ${archive.storedTables} de ${databaseTables} tablas de la base de datos con JSON guardado`}
              </span>
              <small>
                {archive.jsonModels} archivos JSON en la carga original.
              </small>
              <small>
                Guardado: {new Date(archive.savedAt).toLocaleString("es")}
              </small>
              <a className="button" href="/api/code?download=1">
                Descargar archivo guardado
              </a>
            </div>
          )}
          <label className="transform-upload">
            {busy
              ? "Guardando…"
              : archive
                ? "Reemplazar RAR / ZIP"
                : "Guardar RAR / ZIP"}
            <input
              type="file"
              accept=".rar,.zip"
              disabled={busy}
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (!file) return;
                if (file.size > 100 * 1024 * 1024) {
                  setError("El archivo supera 100 MB.");
                  return;
                }
                const form = new FormData();
                form.set("archive", file);
                void save({ method: "POST", body: form });
              }}
            />
          </label>
          <p className="transform-hint">
            Solo se guardan los JSON de tablas que existen en esta base de
            datos, en un ZIP filtrado para esta conexión; reemplazarlo no
            modifica el código ya incorporado al chat. Hasta 100 MB.
          </p>
        </>
      )}
      {status && <p role="status">{status}</p>}
      {error && (
        <p role="alert" className="transform-error">
          {error}
        </p>
      )}
    </section>
  );
}
