import type { ChatAnswer } from "@/lib/types";

function display(value: unknown): string {
  if (value === null || value === undefined) return "—";
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

export default function AnswerView({ answer }: { answer: ChatAnswer }) {
  return (
    <div className="answer-view">
      <p className="answer-text">{answer.text}</p>
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
              <p className="muted">No matching rows.</p>
            )}
          </section>
        );
      })}
      {answer.steps.some((step) => step.truncated) && (
        <p className="muted">
          Some results were limited to 500 rows or 100 KB. The answer may use
          incomplete data.
        </p>
      )}
      {!!answer.steps.length && (
        <details className="sql">
          <summary>
            View {answer.steps.length} query{" "}
            {answer.steps.length === 1 ? "step" : "steps"}
            <span>SELECT · read only</span>
          </summary>
          {answer.steps.map((step, index) => (
            <div className="query-step" key={index}>
              <small>
                Step {index + 1} · {step.rows.length} rows · {step.duration} ms
                {step.truncated ? " · limited" : ""}
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
