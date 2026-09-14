export type Field = {
  name: string;
  type: string;
  key: string;
  nullable: boolean;
  description?: string;
};
export type Table = { name: string; description?: string; fields: Field[] };
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
  text: string;
  views: AnswerView[];
  steps: QueryStep[];
};
