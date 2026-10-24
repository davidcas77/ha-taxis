import type { DatabaseSync } from "node:sqlite";

import { DEFAULT_NAMING, DEFAULT_TYPE_WORDS, slug, type NamingSettings } from "../shared/naming.ts";
import type { EntityRole } from "../shared/types.ts";

// App settings, one JSON value per key in SQLite. Only naming for now.

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
