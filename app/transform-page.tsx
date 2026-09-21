"use client";

import { useRef, useState } from "react";
import {
  parseCatalog,
  validateCatalog,
  type CatalogTable,
} from "@/lib/catalog";
import type { Table } from "@/lib/types";

export default function TransformPage({
  tables,
  connectionName,
  onApply,
  onConnect,
}: {
  tables: Table[];
  connectionName?: string;
  onApply: (catalog: CatalogTable[], filename: string) => void;
  onConnect: () => void;
}) {
  const [catalog, setCatalog] = useState<CatalogTable[] | null>(null);
  const [filename, setFilename] = useState("");
  const [error, setError] = useState("");
  const [reading, setReading] = useState(false);
  const [applied, setApplied] = useState(false);
  const [onlyIssues, setOnlyIssues] = useState(false);
  const request = useRef(0);
  const validation = catalog ? validateCatalog(catalog, tables) : [];
  const missingTables = validation.filter((t) => !t.exists).length;
  const missingFields = validation
    .filter((t) => t.exists)
    .flatMap((t) => t.fields)
    .filter((f) => !f.exists).length;
  const hasIssues = missingTables > 0 || missingFields > 0;
  const tableDescriptions =
    catalog?.filter((t) => t.descripcion !== undefined).length ?? 0;
  const fieldDescriptions =
    catalog
      ?.flatMap((t) => t.columnas)
      .filter((f) => f.descripcion !== undefined).length ?? 0;

  async function readFile(file?: File) {
    const id = ++request.current;
    setCatalog(null);
    setError("");
    setApplied(false);
    setOnlyIssues(false);
    setFilename(file?.name ?? "");
    if (!file) {
      setReading(false);
      return;
    }
    setReading(true);
    try {
      const parsed = parseCatalog(await file.text());
      if (id === request.current) setCatalog(parsed);
    } catch (e) {
      if (id === request.current)
        setError(
          e instanceof Error ? e.message : "No se pudo leer el archivo.",
        );
    } finally {
      if (id === request.current) setReading(false);
    }
  }

  return (
    <main className="settings-page transform-page">
      <div className="page-bar">
        <div>
          <span className="transform-eyebrow">CATÁLOGO DE DATOS</span>
          <h1>Transformar</h1>
          <p>
            Valida tu catálogo y agrega sus descripciones a tu base de datos.
          </p>
        </div>
      </div>
      {!connectionName ? (
        <section className="transform-card">
          <h2>Conecta una base de datos para comenzar</h2>
          <p>
            Necesitamos su esquema para comprobar las tablas y los campos del
            archivo.
          </p>
          <button className="button primary" onClick={onConnect}>
            Conectarse
          </button>
        </section>
      ) : (
        <>
          <section className="transform-card">
            <h2>
              <span className="transform-step">1</span> Seleccionar catálogo
            </h2>
            <p>
              Comprobaremos los nombres exactos contra el esquema cargado de{" "}
              <strong>{connectionName}</strong>.
            </p>
            <label className="transform-upload">
              Archivo JSON
              <input
                type="file"
                accept=".json,application/json"
                onChange={(e) => void readFile(e.target.files?.[0])}
              />
            </label>
            <p className="transform-hint">
              Formato: lista de tablas con «tabla», «descripcion» y «columnas»
              (cada campo con «nombre» y «descripcion»).
            </p>
            {reading && <p role="status">Leyendo catálogo…</p>}
            {error && (
              <p className="transform-error" role="alert">
                {error}
              </p>
            )}
          </section>
          {catalog && (
            <>
              <section className="transform-card">
                <h2>
                  <span className="transform-step">2</span> Resultado de
                  validación
                </h2>
                <div className="transform-stats" role="status">
                  <div>
                    <strong>
                      {validation.filter((t) => t.exists).length} /{" "}
                      {validation.length}
                    </strong>
                    <span>Tablas encontradas</span>
                  </div>
                  <div>
                    <strong>{missingTables}</strong>
                    <span>Tablas inexistentes</span>
                  </div>
                  <div>
                    <strong>{missingFields}</strong>
                    <span>Campos inexistentes en tablas encontradas</span>
                  </div>
                </div>
                <p
                  className={
                    hasIssues ? "transform-error" : "transform-success"
                  }
                >
                  {hasIssues
                    ? "Hay diferencias con el esquema. Corrige el archivo y vuelve a seleccionarlo para continuar."
                    : "Todo correcto. Todas las tablas y sus campos existen."}
                </p>
                <label className="transform-filter">
                  <input
                    type="checkbox"
                    checked={onlyIssues}
                    onChange={(e) => setOnlyIssues(e.target.checked)}
                  />
                  Mostrar solo incidencias
                </label>
                <div className="transform-results">
                  {validation
                    .filter(
                      (t) =>
                        !onlyIssues ||
                        !t.exists ||
                        t.fields.some((f) => !f.exists),
                    )
                    .map((table) => {
                      const missing = table.fields.filter((f) => !f.exists);
                      return (
                        <details
                          key={table.name}
                          open={!table.exists || missing.length > 0}
                        >
                          <summary>
                            <strong>{table.name}</strong>
                            <span
                              className={`transform-badge ${!table.exists || missing.length ? "invalid" : "valid"}`}
                            >
                              {!table.exists
                                ? "Tabla inexistente"
                                : missing.length
                                  ? `${missing.length} campos inexistentes`
                                  : `${table.fields.length} campos válidos`}
                            </span>
                          </summary>
                          {!table.exists ? (
                            <p>
                              Esta tabla no existe en la base conectada. No se
                              pueden validar sus {table.fields.length} campos.
                            </p>
                          ) : (
                            <ul>
                              {table.fields
                                .filter((f) => !onlyIssues || !f.exists)
                                .map((field) => (
                                  <li key={field.name}>
                                    <code>{field.name}</code>
                                    <span
                                      className={
                                        field.exists
                                          ? "transform-success"
                                          : "transform-error"
                                      }
                                    >
                                      {field.exists ? "Existe" : "No existe"}
                                    </span>
                                  </li>
                                ))}
                            </ul>
                          )}
                        </details>
                      );
                    })}
                  {onlyIssues && !hasIssues && <p>No hay incidencias.</p>}
                </div>
              </section>
              <section className="transform-card">
                <h2>
                  <span className="transform-step">3</span> Agregar Datos
                </h2>
                <p>
                  Se agregarán o reemplazarán {tableDescriptions} descripciones
                  de tablas y {fieldDescriptions} descripciones de campos. Las
                  descripciones vacías o ausentes conservarán el texto actual.
                </p>
                <p>
                  Se creará el grupo <strong>{filename}</strong> con las{" "}
                  {catalog.length} tablas del archivo. Las demás tablas y los
                  grupos existentes se conservarán.
                </p>
                <button
                  className="button primary"
                  disabled={hasIssues || applied || reading}
                  onClick={() => {
                    try {
                      onApply(catalog, filename);
                      setApplied(true);
                      setError("");
                    } catch (e) {
                      setError(
                        e instanceof Error
                          ? e.message
                          : "No se pudo agregar el catálogo.",
                      );
                    }
                  }}
                >
                  {applied ? "Datos agregados" : "Agregar Datos"}
                </button>
                {applied && (
                  <p className="transform-success" role="status">
                    Descripciones actualizadas y grupo «{filename}» creado.
                    Puedes revisarlos en Base de Datos.
                  </p>
                )}
              </section>
            </>
          )}
        </>
      )}
    </main>
  );
}
