import type { ChatAnswer } from "@/lib/types";
import { visualizationDocument } from "@/lib/visualization";

function display(value: unknown): string {
  if (value === null || value === undefined) return "—";
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

export default function AnswerView({ answer }: { answer: ChatAnswer }) {
  return (
    <div className="answer-view">
      <p className="answer-text">{answer.text}</p>
      {answer.html && (
        <>
          <div className="free-visualization-frame">
            <iframe
              title="Visualización libre"
              sandbox="allow-scripts"
              referrerPolicy="no-referrer"
              srcDoc={visualizationDocument(answer.html, answer.steps)}
            />
          </div>
          <details className="sql">
            <summary>Ver código de la visualización</summary>
            <pre>{answer.html}</pre>
          </details>
        </>
      )}
      {answer.views.map((view, index) => {
        const rows = answer.steps[view.query].rows;
        const columns = Array.from(new Set(rows.flatMap(Object.keys)));
        const maximum =
          view.type === "bars"
            ? Math.max(1, ...rows.map((row) => Number(row[view.column!])))
            : 1;
        return (
          <section className="answer-card" key={index} aria-label={view.title}>
            <h3>{view.title}</h3>
            {view.type === "metric" ? (
              <p className="answer-metric">
                {display(rows[0]?.[view.column!])}
              </p>
            ) : view.type === "bars" ? (
              <div className="answer-bars">
                {rows.map((row, i) => (
                  <div className="answer-bar" key={i}>
                    <span>{display(row[view.label!])}</span>
                    <div className="bar-track" aria-hidden="true">
                      <div
                        className={
                          view.animated ? "bar-fill animated" : "bar-fill"
                        }
                        style={{
                          width: `${(Number(row[view.column!]) / maximum) * 100}%`,
                        }}
                      />
                    </div>
                    <strong>{display(row[view.column!])}</strong>
                  </div>
                ))}
              </div>
            ) : rows.length ? (
              <div
                className="answer-table"
                tabIndex={0}
                role="region"
                aria-label={view.title}
              >
                <table>
                  <thead>
                    <tr>
                      {columns.map((column) => (
                        <th scope="col" key={column}>
                          {column}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row, i) => (
                      <tr key={i}>
                        {columns.map((column) => (
                          <td key={column}>{display(row[column])}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="muted">No hay filas que coincidan.</p>
            )}
          </section>
        );
      })}
      {answer.steps.some((step) => step.truncated) && (
        <p className="muted">
          Algunos resultados se limitaron a 500 filas o 100 KB. La respuesta
          puede basarse en datos incompletos.
        </p>
      )}
      {!!answer.steps.length && (
        <details className="sql">
          <summary>
            Ver {answer.steps.length}{" "}
            {answer.steps.length === 1
              ? "paso de consulta"
              : "pasos de consulta"}
            <span>SELECT · solo lectura</span>
          </summary>
          {answer.steps.map((step, index) => (
            <div className="query-step" key={index}>
              <small>
                Paso {index + 1} · {step.rows.length} filas · {step.duration} ms
                {step.truncated ? " · limitado" : ""}
              </small>
              <pre>{step.sql}</pre>
              {step.error && <p className="query-error">{step.error}</p>}
            </div>
          ))}
        </details>
      )}
    </div>
  );
}
