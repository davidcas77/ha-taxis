import type { Change } from "./types.ts";

export type ChangeField = { path: string[]; beforeKnown: boolean; before: unknown; after: unknown; added?: unknown[]; removed?: unknown[] };

const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);

// Only enumerate proposed fields. A missing baseline is not an empty value.
export function changeFields(change: Change): ChangeField[] {
  const rows: ChangeField[] = [];
  const walk = (after: unknown, before: unknown, known: boolean, path: string[]) => {
    if (record(after) && Object.keys(after).length > 0) {
      for (const [key, value] of Object.entries(after)) {
        const has = known && record(before) && Object.hasOwn(before, key);
        walk(value, has ? (before as Record<string, unknown>)[key] : undefined, has, [...path, key]);
      }
      return;
    }
    const row: ChangeField = { path, beforeKnown: known, before, after };
    if (Array.isArray(after) && Array.isArray(before) && after.every((v) => typeof v === "string") && before.every((v) => typeof v === "string")) {
      row.added = after.filter((v) => !before.includes(v));
      row.removed = before.filter((v) => !after.includes(v));
    }
    rows.push(row);
  };
  for (const [key, value] of Object.entries(change.after)) {
    const rename = change.kind === "entity" && key === "new_entity_id";
    const known = rename || Object.hasOwn(change.before, key);
    walk(value, rename ? change.targetId : change.before[key], known, [key]);
  }
  if (change.op === "delete") {
    for (const [key, value] of Object.entries(change.before)) {
      if (key !== "configSnapshot" && !Object.hasOwn(change.after, key)) rows.push({ path: [key], beforeKnown: true, before: value, after: undefined });
    }
  }
  return rows;
}
