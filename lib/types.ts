export type Field = {
  name: string;
  type: string;
  key: string;
  nullable: boolean;
  description?: string;
};
export type Table = {
  name: string;
  labelEvidence?: LabelEvidence;
  description?: string;
  notUsed?: boolean;
  fields: Field[];
};

export type LabelEvidence = {
  generatedAt: string;
  model: string;
  description: string;
  claims: { text: string; sources: string[] }[];
  functions: {
    id: string;
    name: string;
    file: string;
    line: number;
    hash: string;
  }[];
  queries: {
    id: string;
    sql: string;
    rowCount: number;
    truncated: boolean;
    error?: string;
  }[];
  warnings: string[];
};
export type Group = { id: string; name: string; tables: string[] };

export type QueryStep = {
  sql: string;
  rows: Record<string, unknown>[];
  duration: number;
  truncated: boolean;
  error?: string;
};

// The AI describes a small view; React renders it using actual query results.
export type AnswerView = {
  type: "table" | "metric" | "bars";
  title: string;
  query: number;
  column?: string;
  label?: string;
  animated?: boolean;
};

export type ChatAnswer = {
  contextFunctions?: import("./code-context").SelectedFunction[];
  contextTables?: string[];
  text: string;
  html?: string;
  views: AnswerView[];
  steps: QueryStep[];
};
