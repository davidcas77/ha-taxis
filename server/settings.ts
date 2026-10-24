import type { DatabaseSync } from "node:sqlite";

import { GROUP_ID, GROUP_LISTS, MAX_GROUPS, MAX_ITEMS, MAX_NAME, type GroupSettings } from "../shared/groups.ts";
import { DEFAULT_NAMING, DEFAULT_TYPE_WORDS, slug, type NamingSettings } from "../shared/naming.ts";
import type { EntityRole } from "../shared/types.ts";

// App settings, one JSON value per key in SQLite: naming and groups.

export function settingsStore(db: DatabaseSync) {
  const get = db.prepare("SELECT value FROM settings WHERE key = ?");
  const put = db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value");
  return {
    naming(): NamingSettings {
      const row = get.get("naming") as { value: string } | undefined;
      if (!row) return structuredClone(DEFAULT_NAMING);
      try {
        return { ...structuredClone(DEFAULT_NAMING), ...(JSON.parse(row.value) as Partial<NamingSettings>) };
      } catch {
        return structuredClone(DEFAULT_NAMING);
      }
    },
    saveNaming(s: NamingSettings): void {
      put.run("naming", JSON.stringify(s));
    },
    groups(): GroupSettings {
      const row = get.get("groups") as { value: string } | undefined;
      if (!row) return {};
      try {
        // Stored values passed the validator; run it again in case the row was edited by hand.
        const checked = validateGroups(JSON.parse(row.value));
        return checked.ok ? checked.value : {};
      } catch {
        return {};
      }
    },
    saveGroups(s: GroupSettings): void {
      put.run("groups", JSON.stringify(s));
    },
  };
}

// Null when the settings are usable; otherwise what's wrong, in words.
const isRecord = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === "object" && !Array.isArray(v);

// areaIds: the areas Home Assistant has; codes for any other id are dropped.
export function validateNaming(input: unknown, areaIds?: ReadonlySet<string>): { ok: true; value: NamingSettings } | { ok: false; error: string } {
  if (!isRecord(input)) return { ok: false, error: "The settings weren't readable." };
  const s = input as Partial<NamingSettings>;
  if (s.areaCodes !== undefined && !isRecord(s.areaCodes)) return { ok: false, error: "The area codes weren't readable." };
  if (s.typeWords !== undefined && !isRecord(s.typeWords)) return { ok: false, error: "The type words weren't readable." };
  const pattern = (v: unknown, need: string[], what: string) => {
    if (typeof v !== "string" || v.trim().length === 0) return `The ${what} pattern can't be empty.`;
    if (v.length > 120) return `The ${what} pattern is longer than 120 characters.`;
    const missing = need.filter((t) => !v.includes(t));
    return missing.length ? `The ${what} pattern needs ${missing.join(" and ")}.` : null;
  };
  const idErr = pattern(s.idPattern, ["{area}", "{name}"], "entity id");
  if (idErr) return { ok: false, error: idErr };
  const nameErr = pattern(s.namePattern, ["{Name}"], "name");
  if (nameErr) return { ok: false, error: nameErr };
  const codes: Record<string, string> = {};
  for (const [area, code] of Object.entries(s.areaCodes ?? {})) {
    if (typeof code !== "string" || area.length > 100 || (areaIds && !areaIds.has(area))) continue;
    const clean = slug(code);
    if (!clean) return { ok: false, error: `The code for ${area} has no letters or digits.` };
    if (clean.length > 40) return { ok: false, error: `The code for ${area} is longer than 40 characters.` };
    codes[area] = clean;
  }
  if (Object.keys(codes).length > 1000) return { ok: false, error: "Too many area codes." };
  const words: Partial<Record<EntityRole, string>> = {};
  for (const [role, word] of Object.entries(s.typeWords ?? {})) {
    if (!Object.hasOwn(DEFAULT_TYPE_WORDS, role) || typeof word !== "string") continue;
    if (word.length > 40) return { ok: false, error: `The word for ${role} is longer than 40 characters.` };
    const clean = slug(word);
    if (word.trim() && !clean) return { ok: false, error: `The word for ${role} has no letters or digits.` };
    words[role as EntityRole] = clean;
  }
  return { ok: true, value: { idPattern: s.idPattern!.trim(), namePattern: s.namePattern!.trim(), areaCodes: codes, typeWords: words } };
}

// Groups for labels and categories. Only the five known lists are kept; an
// item can sit in one group of a list.
export function validateGroups(input: unknown): { ok: true; value: GroupSettings } | { ok: false; error: string } {
  if (!isRecord(input)) return { ok: false, error: "The groups weren't readable." };
  const value: GroupSettings = {};
  for (const list of Object.keys(input)) {
    if (!(GROUP_LISTS as readonly string[]).includes(list)) return { ok: false, error: `${list.slice(0, 40)} isn't a list that can have groups.` };
  }
  for (const list of GROUP_LISTS) {
    if (!Object.hasOwn(input, list)) continue;
    const entry = input[list];
    if (!isRecord(entry) || !Array.isArray(entry.groups)) return { ok: false, error: `The groups for ${list} weren't readable.` };
    if (entry.groups.length > MAX_GROUPS) return { ok: false, error: `${list} has more than ${MAX_GROUPS} groups.` };
    const ids = new Set<string>();
    const seen = new Set<string>();
    const groups: { id: string; name: string; items: string[] }[] = [];
    for (const g of entry.groups) {
      if (!isRecord(g) || !Array.isArray(g.items)) return { ok: false, error: `A group in ${list} wasn't readable.` };
      if (typeof g.id !== "string" || !GROUP_ID.test(g.id)) return { ok: false, error: "A group id can use a–z, 0–9, - and _, up to 40 characters." };
      if (ids.has(g.id)) return { ok: false, error: `Two groups in ${list} share the id ${g.id}.` };
      ids.add(g.id);
      const name = typeof g.name === "string" ? g.name.trim() : "";
      if (name.length === 0) return { ok: false, error: "A group needs a name." };
      if (name.length > MAX_NAME) return { ok: false, error: `A group name is longer than ${MAX_NAME} characters.` };
      const items: string[] = [];
      for (const item of g.items) {
        if (typeof item !== "string" || item.length === 0 || item.length > 200) return { ok: false, error: `An item in group “${name}” wasn't readable.` };
        if (seen.has(item)) return { ok: false, error: `An item is in more than one group in ${list}. An item can be in only one group.` };
        seen.add(item);
        items.push(item);
      }
      if (seen.size > MAX_ITEMS) return { ok: false, error: `${list} has more than ${MAX_ITEMS} grouped items.` };
      groups.push({ id: g.id, name, items });
    }
    value[list] = { groups };
  }
  return { ok: true, value };
}
