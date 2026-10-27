import type { AreaNaming, NamingRow } from "./naming.ts";

// Suggestions the user has decided to ignore: an entity whose name or id Taxis
// would change but that is fine as it is. Kept in Taxis only, per entity and per
// field: the name suggestion and the id suggestion are ignored on their own. An
// older version kept one list of entity ids, where an id meant both; it is read
// as both (readNamingIgnores). Pure functions; nothing here changes anything.

export const NAMING_FIELDS = ["name", "id"] as const;
export type NamingField = (typeof NAMING_FIELDS)[number];

// Only a field that is ignored is stored, as true.
export type FieldIgnore = { name?: true; id?: true };
export type NamingIgnores = { entities: Record<string, FieldIgnore> };

export const EMPTY_NAMING_IGNORES: NamingIgnores = { entities: {} };

export const MAX_NAMING_IGNORES = 5000;

export const NAMING_IGNORE_ID = /^[a-z_]+\.[a-z0-9_]+$/;

const own = (s: NamingIgnores, entityId: string): FieldIgnore | undefined => (Object.hasOwn(s.entities, entityId) ? s.entities[entityId] : undefined);

// Whether the entity's name, its id, or (with no field) either is ignored.
export const isIgnored = (s: NamingIgnores, entityId: string, field?: NamingField): boolean => {
  const f = own(s, entityId);
  return Boolean(f && (field ? f[field] === true : f.name === true || f.id === true));
};

// A row Taxis has something to say about: only these can be ignored.
export const hasSuggestion = (r: NamingRow): boolean => r.editable && (r.suggestedName !== null || r.suggestedId !== null);

const suggestionOf = (r: NamingRow, field: NamingField): boolean => (field === "name" ? r.suggestedName !== null : r.suggestedId !== null);

// Whether this row's suggestion for the field is ignored (a field with no
// suggestion has nothing to ignore).
export const fieldIgnored = (r: NamingRow, s: NamingIgnores, field: NamingField): boolean => r.editable && suggestionOf(r, field) && isIgnored(s, r.entityId, field);

// A row with something ignored, the other suggestion maybe still open.
export const anyIgnored = (r: NamingRow, s: NamingIgnores): boolean => NAMING_FIELDS.some((f) => fieldIgnored(r, s, f));

// Every suggestion the row has is ignored: nothing is left to do for it.
export const allIgnored = (r: NamingRow, s: NamingIgnores): boolean => hasSuggestion(r) && NAMING_FIELDS.every((f) => !suggestionOf(r, f) || fieldIgnored(r, s, f));

// Keys in order, so what is stored is always the same for the same choices.
function sortedEntities(e: Record<string, FieldIgnore>): Record<string, FieldIgnore> {
  return Object.fromEntries(Object.entries(e).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

// The same object back when nothing changes, so a save is skipped. Without
// `fields`, both are ignored.
export function ignoreSuggestions(s: NamingIgnores, ids: readonly string[], fields: readonly NamingField[] = NAMING_FIELDS): NamingIgnores {
  let entities: Record<string, FieldIgnore> | null = null;
  for (const id of ids) {
    const cur = own(s, id) ?? {};
    if (fields.every((f) => cur[f] === true)) continue;
    entities ??= { ...s.entities };
    const next: FieldIgnore = { ...cur };
    for (const f of fields) next[f] = true;
    Object.defineProperty(entities, id, { value: next, enumerable: true, writable: true, configurable: true });
  }
  return entities ? { entities: sortedEntities(entities) } : s;
}

export function restoreSuggestions(s: NamingIgnores, ids: readonly string[], fields: readonly NamingField[] = NAMING_FIELDS): NamingIgnores {
  let entities: Record<string, FieldIgnore> | null = null;
  for (const id of ids) {
    const cur = own(s, id);
    if (!cur || !fields.some((f) => cur[f] === true)) continue;
    entities ??= { ...s.entities };
    const next: FieldIgnore = { ...cur };
    for (const f of fields) delete next[f];
    if (Object.keys(next).length === 0) delete entities[id];
    else Object.defineProperty(entities, id, { value: next, enumerable: true, writable: true, configurable: true });
  }
  return entities ? { entities: sortedEntities(entities) } : s;
}

// Reads what was stored or sent: the current shape, or the older list of entity
// ids (each ignoring both fields). Anything else is refused with a message.
// Entities with nothing ignored are left out; the result is sorted.
export function readNamingIgnores(input: unknown): { ok: true; value: NamingIgnores } | { ok: false; error: string } {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return { ok: false, error: "The ignored suggestions weren't readable." };
  for (const key of Object.keys(input)) {
    if (key !== "entities") return { ok: false, error: `${key.slice(0, 40)} isn't part of the ignored suggestions.` };
  }
  const raw = (input as { entities?: unknown }).entities ?? {};
  const checkId = (id: unknown): string | null => (typeof id !== "string" || id.length > 255 || !NAMING_IGNORE_ID.test(id) ? `${String(id).slice(0, 60)} isn't an entity id.` : null);
  const tooMany = { ok: false as const, error: `More than ${MAX_NAMING_IGNORES} suggestions are ignored.` };
  // Built from entries, not by assignment: an id is a key, and "__proto__" must stay one.
  const merged = new Map<string, FieldIgnore>();
  if (Array.isArray(raw)) {
    if (raw.length > MAX_NAMING_IGNORES) return tooMany;
    for (const id of raw) {
      const bad = checkId(id);
      if (bad) return { ok: false, error: bad };
      merged.set(id as string, { name: true, id: true });
    }
  } else if (typeof raw === "object" && raw !== null) {
    const entries = Object.entries(raw);
    if (entries.length > MAX_NAMING_IGNORES) return tooMany;
    for (const [id, v] of entries) {
      const bad = checkId(id);
      if (bad) return { ok: false, error: bad };
      if (typeof v !== "object" || v === null || Array.isArray(v)) return { ok: false, error: `The ignored fields of ${id} weren't readable.` };
      const fields: FieldIgnore = {};
      for (const [key, flag] of Object.entries(v)) {
        if (key !== "name" && key !== "id") return { ok: false, error: `${key.slice(0, 40)} isn't a field that can be ignored (${id}).` };
        if (typeof flag !== "boolean") return { ok: false, error: `${key} for ${id} must be true or false.` };
        if (flag) fields[key] = true;
      }
      if (fields.name || fields.id) merged.set(id, fields);
    }
  } else {
    return { ok: false, error: "The ignored entities weren't readable." };
  }
  return { ok: true, value: { entities: sortedEntities(Object.fromEntries(merged)) } };
}

// The rows of an area split by the user's decision. A row is ignored when
// everything Taxis suggests for it is; one with a suggestion left is active. An
// ignored entity that no longer has a suggestion is just a row that fits.
export function splitIgnored(rows: readonly NamingRow[], s: NamingIgnores): { active: NamingRow[]; ignored: NamingRow[] } {
  const active: NamingRow[] = [];
  const ignored: NamingRow[] = [];
  for (const r of rows) (allIgnored(r, s) ? ignored : active).push(r);
  return { active, ignored };
}

// How many ids fit: those that start with the area's code, and those whose
// suggestions the user ignored (they said it's fine).
export function namingFit(analysis: Pick<AreaNaming, "rows">, s: NamingIgnores): { fits: number; total: number; ignored: number } {
  const { ignored } = splitIgnored(analysis.rows, s);
  const fits = analysis.rows.filter((r) => r.status === "ok").length + ignored.filter((r) => r.status !== "ok").length;
  return { fits, total: analysis.rows.length, ignored: ignored.length };
}
