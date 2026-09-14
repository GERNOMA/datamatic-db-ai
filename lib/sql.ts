import sqlParser from "node-sql-parser";
const parser = new sqlParser.Parser();

// Reject unknown functions too: SELECT can otherwise invoke stored functions with side effects.
const functions = new Set(
  "COUNT SUM AVG MIN MAX ABS ROUND CEIL CEILING FLOOR MOD COALESCE IFNULL NULLIF IF CONCAT CONCAT_WS LOWER UPPER TRIM LTRIM RTRIM LENGTH CHAR_LENGTH SUBSTRING SUBSTR LEFT RIGHT REPLACE DATE YEAR MONTH DAY DAYOFMONTH DAYOFWEEK DATE_FORMAT DATEDIFF TIMESTAMPDIFF DATE_ADD DATE_SUB NOW CURDATE CURRENT_DATE CURRENT_TIMESTAMP CAST CONVERT GREATEST LEAST GROUP_CONCAT JSON_EXTRACT JSON_UNQUOTE ROW_NUMBER RANK DENSE_RANK LAG LEAD".split(
    " ",
  ),
);

export function validateQuery(input: string, tables: string[]) {
  const sql = input.trim().replace(/;$/, "");
  if (
    !sql ||
    sql.length > 20000 ||
    /;|--|\/\*|#|@|\b(INTO|OUTFILE|DUMPFILE|PROCEDURE|FOR\s+UPDATE|LOCK|SLEEP|BENCHMARK|LOAD_FILE)\b/i.test(
      sql,
    )
  ) {
    throw new Error(
      "Solo se permite una única consulta SELECT de solo lectura.",
    );
  }
  let ast;
  try {
    ast = parser.astify(sql, { database: "MySQL" });
  } catch {
    throw new Error(
      "No se pudo validar el SQL devuelto por el modelo. Prueba a reformular tu pregunta.",
    );
  }
  if (Array.isArray(ast) || ast.type !== "select")
    throw new Error("El modelo debe devolver una consulta SELECT.");
  function check(node: unknown) {
    if (!node || typeof node !== "object") return;
    const value = node as Record<string, unknown>;
    if (value.type === "function" || value.type === "aggr_func") {
      if (
        typeof value.name === "object" &&
        value.name &&
        "schema" in value.name
      ) {
        throw new Error("No se permiten funciones calificadas con un esquema.");
      }
      const name =
        typeof value.name === "string"
          ? value.name
          : ((value.name as { name?: { value: string }[] })?.name ?? [])
              .map((n) => n.value)
              .join(".");
      if (!functions.has(name.toUpperCase()))
        throw new Error(`La función SQL ${name} no está permitida.`);
    }
    for (const child of Object.values(value)) check(child);
  }
  check(ast);
  for (const reference of parser.tableList(sql, { database: "MySQL" })) {
    const [operation, database, table] = reference.split("::");
    if (
      operation !== "select" ||
      database !== "null" ||
      !tables.includes(table)
    ) {
      throw new Error(
        "La consulta hace referencia a una tabla fuera de los grupos seleccionados.",
      );
    }
  }
  return sql;
}
