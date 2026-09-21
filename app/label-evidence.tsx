import type { LabelEvidence } from "@/lib/types";

export default function LabelEvidenceDetails({
  evidence,
}: {
  evidence: LabelEvidence;
}) {
  return (
    <details className="label-response">
      <summary>Ver evidencia de la descripción</summary>
      <p>
        {evidence.model} · {evidence.generatedAt}
      </p>
      <ul>
        {evidence.claims.map((claim, i) => (
          <li key={i}>
            {claim.text}
            <ul>
              {claim.sources.map((source) => {
                const fn = evidence.functions.find((f) => f.id === source);
                return (
                  <li key={source}>
                    <code>
                      {fn ? `${fn.file}:${fn.line} · ${fn.name}` : source}
                    </code>
                  </li>
                );
              })}
            </ul>
          </li>
        ))}
      </ul>
      <details>
        <summary>
          Funciones inspeccionadas ({evidence.functions.length})
        </summary>
        <ul>
          {evidence.functions.map((fn) => (
            <li key={fn.id}>
              <code>
                {fn.file}:{fn.line}
              </code>{" "}
              · {fn.name}
            </li>
          ))}
        </ul>
      </details>
      {evidence.queries.map((query) => (
        <details key={query.id}>
          <summary>
            {query.id} ·{" "}
            {query.error
              ? "Fallida"
              : `${query.rowCount} filas${query.truncated ? " · truncadas" : ""}`}
          </summary>
          <pre>{query.sql}</pre>
          {query.error && <p>{query.error}</p>}
        </details>
      ))}
      {evidence.warnings.length > 0 && (
        <ul>
          {evidence.warnings.map((warning, i) => (
            <li key={i}>{warning}</li>
          ))}
        </ul>
      )}
      <p>
        Referencias de la generación; los datos y el código pueden haber
        cambiado. Los resultados SQL y el código completo no se guardan aquí.
      </p>
    </details>
  );
}
