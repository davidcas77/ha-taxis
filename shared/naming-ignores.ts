import type { AreaNaming, NamingRow } from "./naming.ts";

// Suggestions the user has decided to ignore: an entity whose name or id Taxis
// would change but that is fine as it is. Kept in Taxis only, one list of
// entity ids; ignoring hides both its name and its id suggestion. Pure
// functions; nothing here changes anything.

export type NamingIgnores = { entities: string[] };

export const EMPTY_NAMING_IGNORES: NamingIgnores = { entities: [] };

export const MAX_NAMING_IGNORES = 5000;

export const NAMING_IGNORE_ID = /^[a-z_]+\.[a-z0-9_]+$/;

export const isIgnored = (s: NamingIgnores, entityId: string): boolean => s.entities.includes(entityId);

// A row Taxis has something to say about: only these can be ignored.
export const hasSuggestion = (r: NamingRow): boolean => r.editable && (r.suggestedName !== null || r.suggestedId !== null);

// The same object back when nothing changes, so a save is skipped.
export function ignoreSuggestions(s: NamingIgnores, ids: readonly string[]): NamingIgnores {
  const add = ids.filter((id) => !s.entities.includes(id));
  return add.length === 0 ? s : { entities: [...new Set([...s.entities, ...add])].sort() };
}

export function restoreSuggestions(s: NamingIgnores, ids: readonly string[]): NamingIgnores {
  return ids.some((id) => s.entities.includes(id)) ? { entities: s.entities.filter((id) => !ids.includes(id)) } : s;
}

// The rows of an area split by the user's decision. Only rows with a
// suggestion can be ignored; an ignored entity that no longer has one is just
// a row that fits.
export function splitIgnored(rows: readonly NamingRow[], s: NamingIgnores): { active: NamingRow[]; ignored: NamingRow[] } {
  const set = new Set(s.entities);
  const active: NamingRow[] = [];
  const ignored: NamingRow[] = [];
  for (const r of rows) (set.has(r.entityId) && hasSuggestion(r) ? ignored : active).push(r);
  return { active, ignored };
}

// How many ids fit: those that start with the area's code, and those with a
// suggestion the user ignored (they said it's fine).
export function namingFit(analysis: Pick<AreaNaming, "rows">, s: NamingIgnores): { fits: number; total: number; ignored: number } {
  const { ignored } = splitIgnored(analysis.rows, s);
  const fits = analysis.rows.filter((r) => r.status === "ok").length + ignored.filter((r) => r.status !== "ok").length;
  return { fits, total: analysis.rows.length, ignored: ignored.length };
}
