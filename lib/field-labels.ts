import type { Field, FieldLabel } from "./types.ts";

export function validFieldLabels(value: unknown): value is FieldLabel[] {
  return (
    Array.isArray(value) &&
    value.every(
      (f) =>
        f &&
        typeof f.name === "string" &&
        f.name.length > 0 &&
        typeof f.description === "string" &&
        f.description.trim().length > 0 &&
        f.description.length <= 240 &&
        !/[\r\n]/.test(f.description) &&
        typeof f.reason === "string" &&
        f.reason.trim().length > 0 &&
        f.reason.length <= 500 &&
        Array.isArray(f.sources) &&
        f.sources.length > 0 &&
        f.sources.length <= 12 &&
        f.sources.every((source: unknown) => typeof source === "string"),
    ) &&
    new Set(value.map((f) => f.name)).size === value.length
  );
}

// Preserve manual/existing descriptions, including edits made during a labeling run.
export function applyFieldLabels(
  fields: Field[],
  labels: FieldLabel[],
): Field[] {
  const byName = new Map(
    labels.map((label) => [label.name, label.description]),
  );
  return fields.map((field) => {
    const description = byName.get(field.name);
    return description && !field.description?.trim()
      ? { ...field, description }
      : field;
  });
}
