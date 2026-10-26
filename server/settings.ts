import type { DatabaseSync } from "node:sqlite";

import {
  AI_EFFORTS,
  AI_JOBS,
  AI_PROVIDERS,
  CAP_MAX,
  CAP_MIN,
  DEFAULT_AI,
  MAX_MODEL_ID,
  MAX_PRICE,
  MAX_PRICES,
  TOKENS_MAX,
  TOKENS_MIN,
  type AiKeyStatus,
  type AiProviderId,
  type AiSettings,
  type AiSettingsView,
  type Price,
} from "../shared/ai.ts";
import { checkBaseUrl } from "../shared/ai-url.ts";
import { GROUP_ID, GROUP_LISTS, MAX_GROUPS, MAX_ITEMS, MAX_NAME, type GroupSettings } from "../shared/groups.ts";
import { HELPERS, effectiveSuffixes, helperNameErrors, isHelperKey, type HelperNames } from "../shared/helpers.ts";
import {
  AREA_TYPES,
  EMPTY_INVENTORY,
  INVENTORY_AREA_ID,
  INVENTORY_ENTITY_ID,
  KIND_PAIRS,
  LIGHT_ROLES,
  MAX_INVENTORY_AREAS,
  MAX_INVENTORY_ENTITIES,
  MOTION_ROLES,
  type AreaChoice,
  type EntityChoice,
  type InventorySettings,
} from "../shared/inventory.ts";
import {
  EMPTY_PARAMETERS,
  MAX_PARAMETER_AREAS,
  MAX_PARAMETER_FLOORS,
  PARAMETER_AREA_ID,
  PARAMETER_FLOOR_ID,
  PARAM_DEF,
  checkValue,
  isParamKey,
  type ParamValue,
  type ParamValues,
  type ParameterSettings,
} from "../shared/parameters.ts";
import { DEFAULT_NAMING, DEFAULT_TYPE_WORDS, areaCodes, duplicateCodes, duplicateCodesMessage, duplicateIds, slug, type NamingSettings } from "../shared/naming.ts";
import type { EntityRole, Hierarchy } from "../shared/types.ts";

// App settings, one JSON value per key in SQLite: naming, groups, the
// capability inventory, the recipe parameters and the optional AI.

export function settingsStore(db: DatabaseSync) {
  const get = db.prepare("SELECT value FROM settings WHERE key = ?");
  const put = db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value");
  const del = db.prepare("DELETE FROM settings WHERE key = ?");
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
    inventory(): InventorySettings {
      const row = get.get("inventory") as { value: string } | undefined;
      if (!row) return structuredClone(EMPTY_INVENTORY);
      try {
        // Same as groups: validate again in case the row was edited by hand.
        const checked = validateInventory(JSON.parse(row.value));
        return checked.ok ? checked.value : structuredClone(EMPTY_INVENTORY);
      } catch {
        return structuredClone(EMPTY_INVENTORY);
      }
    },
    saveInventory(s: InventorySettings): void {
      put.run("inventory", JSON.stringify(s));
    },
    parameters(): ParameterSettings {
      const row = get.get("parameters") as { value: string } | undefined;
      if (!row) return structuredClone(EMPTY_PARAMETERS);
      try {
        // Same as the inventory: validate again in case the row was edited by hand.
        const checked = validateParameters(JSON.parse(row.value));
        return checked.ok ? checked.value : structuredClone(EMPTY_PARAMETERS);
      } catch {
        return structuredClone(EMPTY_PARAMETERS);
      }
    },
    saveParameters(s: ParameterSettings): void {
      put.run("parameters", JSON.stringify(s));
    },
    ai(): AiSettings {
      const row = get.get("ai") as { value: string } | undefined;
      if (!row) return structuredClone(DEFAULT_AI);
      try {
        // Same as the others: validate again in case the row was edited by hand.
        const checked = validateAi(JSON.parse(row.value));
        return checked.ok ? checked.value : structuredClone(DEFAULT_AI);
      } catch {
        return structuredClone(DEFAULT_AI);
      }
    },
    saveAi(s: AiSettings): void {
      put.run("ai", JSON.stringify(s));
    },
    // The API key, one per provider, in a row of its own so that the settings
    // above can be handed to the browser as they are. No endpoint returns it:
    // aiView() says only whether one is set and how it ends.
    aiKey(provider: AiProviderId): string | null {
      const row = get.get(`ai_key:${provider}`) as { value: string } | undefined;
      if (!row) return null;
      try {
        const v: unknown = JSON.parse(row.value);
        return isAiKey(v) ? v : null;
      } catch {
        return null;
      }
    },
    saveAiKey(provider: AiProviderId, key: string | null): void {
      if (key === null) del.run(`ai_key:${provider}`);
      else put.run(`ai_key:${provider}`, JSON.stringify(key));
    },
    aiView(): AiSettingsView {
      const ai = this.ai();
      // Four characters give nothing away only when the key is long.
      const status = (p: AiProviderId): AiKeyStatus => {
        const key = this.aiKey(p);
        return { set: key !== null, end: key !== null && key.length >= 16 ? key.slice(-4) : null };
      };
      const keys = { anthropic: status("anthropic"), "openai-compatible": status("openai-compatible") };
      return { ...ai, keySet: keys[ai.provider].set, keyEnd: keys[ai.provider].end, keys };
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
  if (s.helperNames !== undefined && !isRecord(s.helperNames)) return { ok: false, error: "The helper names weren't readable." };
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
  // Helper names: only real keys, only what differs from the default, each a
  // valid slug and no two the same.
  const helperNames: HelperNames = {};
  for (const [key, v] of Object.entries((s.helperNames ?? {}) as Record<string, unknown>)) {
    if (!isHelperKey(key) || v === undefined || v === null || v === "") continue;
    if (typeof v !== "string") return { ok: false, error: `The helper name for ${key} wasn't readable.` };
    helperNames[key] = v;
  }
  const bad = Object.entries(helperNameErrors(helperNames))[0];
  if (bad) return { ok: false, error: `The helper name for ${HELPERS.find((x) => x.key === bad[0])!.label.toLowerCase()}: ${bad[1]}` };
  const defaults = effectiveSuffixes({});
  for (const key of Object.keys(helperNames) as (keyof HelperNames)[]) if (helperNames[key] === defaults[key]) delete helperNames[key];
  return { ok: true, value: { idPattern: s.idPattern!.trim(), namePattern: s.namePattern!.trim(), areaCodes: codes, typeWords: words, helperNames } };
}

// Null when no two areas end up with the same code. Runs against the live
// hierarchy because detected codes count too. rawAreaIds: the area ids as
// Home Assistant listed them, to catch a repeated id before it hides in a map.
export function checkAreaCodes(settings: NamingSettings, h: Hierarchy, rawAreaIds: readonly string[] = Object.keys(h.areas)): string | null {
  const ids = duplicateIds(rawAreaIds);
  if (ids.length) return `Home Assistant lists the area id ${ids.join(", ")} more than once.`;
  const dupes = duplicateCodes(areaCodes(h, settings));
  const message = duplicateCodesMessage(dupes, (id) => h.areas[id]?.name ?? id);
  return message && `${message} Give each area its own code.`;
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

// The capability inventory: per-entity and per-area choices, only the ones that
// differ from detection. Anything the editor couldn't have produced is refused
// with a message, never silently dropped, so a typo can't go unnoticed.
const KIND_VALUES = new Set<string>(KIND_PAIRS.flat());
const has = (list: readonly string[], v: unknown): boolean => typeof v === "string" && list.includes(v);

export function validateInventory(input: unknown): { ok: true; value: InventorySettings } | { ok: false; error: string } {
  if (!isRecord(input)) return { ok: false, error: "The inventory settings weren't readable." };
  for (const key of Object.keys(input)) {
    if (key !== "entities" && key !== "areas") return { ok: false, error: `${key.slice(0, 40)} isn't part of the inventory settings.` };
  }
  const entities = input.entities ?? {};
  const areas = input.areas ?? {};
  if (!isRecord(entities)) return { ok: false, error: "The entity choices weren't readable." };
  if (!isRecord(areas)) return { ok: false, error: "The area choices weren't readable." };
  if (Object.keys(entities).length > MAX_INVENTORY_ENTITIES) return { ok: false, error: `There are choices for more than ${MAX_INVENTORY_ENTITIES} entities.` };
  if (Object.keys(areas).length > MAX_INVENTORY_AREAS) return { ok: false, error: `There are choices for more than ${MAX_INVENTORY_AREAS} areas.` };

  // Built from entries, not by assignment: an id is a key, and "__proto__" must stay one.
  const entityEntries: [string, EntityChoice][] = [];
  for (const [id, raw] of Object.entries(entities)) {
    if (id.length > 255 || !INVENTORY_ENTITY_ID.test(id)) return { ok: false, error: `${id.slice(0, 60)} isn't an entity id.` };
    if (!isRecord(raw)) return { ok: false, error: `The choices for ${id} weren't readable.` };
    const choice: EntityChoice = {};
    for (const [key, v] of Object.entries(raw)) {
      if (key === "counts" || key === "bed") {
        if (typeof v !== "boolean") return { ok: false, error: `${key} for ${id} must be true or false.` };
        choice[key] = v;
      } else if (key === "kind") {
        if (typeof v !== "string" || !KIND_VALUES.has(v)) return { ok: false, error: `kind for ${id} must be door, window, speaker or tv.` };
        choice.kind = v as EntityChoice["kind"];
      } else if (key === "role") {
        if (!has(MOTION_ROLES, v)) return { ok: false, error: `role for ${id} must be starts or holds.` };
        choice.role = v as EntityChoice["role"];
      } else if (key === "light") {
        if (!has(LIGHT_ROLES, v)) return { ok: false, error: `light for ${id} must be main, accent, task or night.` };
        choice.light = v as EntityChoice["light"];
      } else {
        return { ok: false, error: `${key.slice(0, 40)} isn't a choice for an entity (${id}).` };
      }
    }
    if (Object.keys(choice).length > 0) entityEntries.push([id, choice]);
  }

  const areaEntries: [string, AreaChoice][] = [];
  for (const [id, raw] of Object.entries(areas)) {
    if (!INVENTORY_AREA_ID.test(id)) return { ok: false, error: `${id.slice(0, 60)} isn't an area id.` };
    if (!isRecord(raw)) return { ok: false, error: `The choices for area ${id} weren't readable.` };
    const choice: AreaChoice = {};
    for (const [key, v] of Object.entries(raw)) {
      if (key === "type") {
        if (!has(AREA_TYPES, v)) return { ok: false, error: `type for area ${id} must be interior or exterior.` };
        choice.type = v as AreaChoice["type"];
      } else if (key === "bedroom") {
        if (typeof v !== "boolean") return { ok: false, error: `bedroom for area ${id} must be true or false.` };
        choice.bedroom = v;
      } else {
        return { ok: false, error: `${key.slice(0, 40)} isn't a choice for an area (${id}).` };
      }
    }
    if (Object.keys(choice).length > 0) areaEntries.push([id, choice]);
  }
  return { ok: true, value: { entities: Object.fromEntries(entityEntries), areas: Object.fromEntries(areaEntries) } };
}

// The recipe parameters: values per level (house, interior/exterior, floor,
// area). Only known parameters, each inside its range. Anything the editor
// couldn't have produced is refused with a message, never silently dropped.
export function validateParameters(input: unknown): { ok: true; value: ParameterSettings } | { ok: false; error: string } {
  if (!isRecord(input)) return { ok: false, error: "The parameter settings weren't readable." };
  for (const key of Object.keys(input)) {
    if (!["house", "types", "floors", "areas"].includes(key)) return { ok: false, error: `${key.slice(0, 40)} isn't part of the parameter settings.` };
  }
  const house = input.house ?? {};
  const types = input.types ?? {};
  const floors = input.floors ?? {};
  const areas = input.areas ?? {};
  if (!isRecord(house)) return { ok: false, error: "The house parameters weren't readable." };
  if (!isRecord(types)) return { ok: false, error: "The interior and exterior parameters weren't readable." };
  if (!isRecord(floors)) return { ok: false, error: "The floor parameters weren't readable." };
  if (!isRecord(areas)) return { ok: false, error: "The area parameters weren't readable." };
  if (Object.keys(floors).length > MAX_PARAMETER_FLOORS) return { ok: false, error: `There are parameters for more than ${MAX_PARAMETER_FLOORS} floors.` };
  if (Object.keys(areas).length > MAX_PARAMETER_AREAS) return { ok: false, error: `There are parameters for more than ${MAX_PARAMETER_AREAS} areas.` };

  const values = (raw: unknown, where: string): { ok: true; value: ParamValues } | { ok: false; error: string } => {
    if (!isRecord(raw)) return { ok: false, error: `The parameters for ${where} weren't readable.` };
    const out: [string, ParamValue][] = [];
    for (const [key, v] of Object.entries(raw)) {
      if (!isParamKey(key)) return { ok: false, error: `${key.slice(0, 40)} isn't a parameter (${where}).` };
      const problem = checkValue(PARAM_DEF[key], v);
      if (problem) return { ok: false, error: `${problem.replace(/\.$/, "")} (${where}).` };
      out.push([key, v as ParamValue]);
    }
    return { ok: true, value: Object.fromEntries(out) as ParamValues };
  };

  // Built from entries, not by assignment: an id is a key, and "__proto__" must stay one.
  const houseValues = values(house, "the house");
  if (!houseValues.ok) return houseValues;
  const typeEntries: [string, ParamValues][] = [];
  for (const [id, raw] of Object.entries(types)) {
    if (!(AREA_TYPES as readonly string[]).includes(id)) return { ok: false, error: `${id.slice(0, 40)} isn't interior or exterior.` };
    const v = values(raw, `${id} areas`);
    if (!v.ok) return v;
    if (Object.keys(v.value).length > 0) typeEntries.push([id, v.value]);
  }
  const floorEntries: [string, ParamValues][] = [];
  for (const [id, raw] of Object.entries(floors)) {
    if (!PARAMETER_FLOOR_ID.test(id)) return { ok: false, error: `${id.slice(0, 60)} isn't a floor id.` };
    const v = values(raw, `floor ${id}`);
    if (!v.ok) return v;
    if (Object.keys(v.value).length > 0) floorEntries.push([id, v.value]);
  }
  const areaEntries: [string, ParamValues][] = [];
  for (const [id, raw] of Object.entries(areas)) {
    if (!PARAMETER_AREA_ID.test(id)) return { ok: false, error: `${id.slice(0, 60)} isn't an area id.` };
    const v = values(raw, `area ${id}`);
    if (!v.ok) return v;
    if (Object.keys(v.value).length > 0) areaEntries.push([id, v.value]);
  }
  return {
    ok: true,
    value: { house: houseValues.value, types: Object.fromEntries(typeEntries), floors: Object.fromEntries(floorEntries), areas: Object.fromEntries(areaEntries) },
  };
}

// ---------------------------------------------------------------------------
// AI
// ---------------------------------------------------------------------------

// Visible ASCII, no spaces: a key goes into a request header.
const AI_KEY_RE = /^[\x21-\x7e]{1,400}$/;
// Model ids as the services spell them: "claude-haiku-5-5", "gpt-5", "qwen2.5:7b",
// "anthropic/claude-sonnet-5.5".
const MODEL_ID_RE = /^[A-Za-z0-9._:/@+-]*$/;

export function isAiKey(v: unknown): v is string {
  return typeof v === "string" && AI_KEY_RE.test(v);
}

// The AI settings, and what to do with the key: `key` is absent to keep the
// stored one, a string to replace it, null to remove it. The key is checked here
// and returned apart from the settings, which never carry it.
export function validateAi(input: unknown): { ok: true; value: AiSettings; key?: string | null } | { ok: false; error: string } {
  if (!isRecord(input)) return { ok: false, error: "The AI settings weren't readable." };
  const allowed = ["enabled", "provider", "baseUrl", "models", "effort", "monthlyCapUsd", "maxOutputTokens", "prices", "key"];
  for (const k of Object.keys(input)) if (!allowed.includes(k)) return { ok: false, error: `${k.slice(0, 40)} isn't an AI setting.` };

  if (typeof input.enabled !== "boolean") return { ok: false, error: "Choose whether AI is on or off." };
  if (!(AI_PROVIDERS as readonly unknown[]).includes(input.provider)) return { ok: false, error: "Choose a provider." };
  const provider = input.provider as AiProviderId;

  const url = checkBaseUrl(typeof input.baseUrl === "string" ? input.baseUrl : DEFAULT_AI.baseUrl);
  if (!url.ok) return { ok: false, error: url.error };

  if (!isRecord(input.models)) return { ok: false, error: "The models weren't readable." };
  const models = { quick: "", ask: "" };
  for (const job of AI_JOBS) {
    const v = input.models[job];
    if (v === undefined || v === "") continue;
    if (typeof v !== "string" || v.trim().length > MAX_MODEL_ID) return { ok: false, error: `The ${job} model name is too long.` };
    const id = v.trim();
    if (!MODEL_ID_RE.test(id)) return { ok: false, error: `The ${job} model name has characters a model id doesn't use.` };
    models[job] = id;
  }

  if (!(AI_EFFORTS as readonly unknown[]).includes(input.effort)) return { ok: false, error: "Choose Quick, Balanced or Thorough." };

  const cap = input.monthlyCapUsd;
  if (typeof cap !== "number" || !Number.isFinite(cap) || cap < CAP_MIN || cap > CAP_MAX) {
    return { ok: false, error: `The monthly cap must be between $${CAP_MIN} and $${CAP_MAX.toLocaleString("en-US")}.` };
  }
  const tokens = input.maxOutputTokens;
  if (typeof tokens !== "number" || !Number.isInteger(tokens) || tokens < TOKENS_MIN || tokens > TOKENS_MAX) {
    return { ok: false, error: `The most output tokens per request must be a whole number between ${TOKENS_MIN} and ${TOKENS_MAX.toLocaleString("en-US")}.` };
  }

  const rawPrices = input.prices ?? {};
  if (!isRecord(rawPrices)) return { ok: false, error: "The prices weren't readable." };
  if (Object.keys(rawPrices).length > MAX_PRICES) return { ok: false, error: `There are prices for more than ${MAX_PRICES} models.` };
  const priceEntries: [string, Price][] = [];
  const good = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= MAX_PRICE;
  for (const [id, p] of Object.entries(rawPrices)) {
    if (!id || id.length > MAX_MODEL_ID || !MODEL_ID_RE.test(id)) return { ok: false, error: `${id.slice(0, 40) || "(empty)"} isn't a model name.` };
    if (!isRecord(p)) return { ok: false, error: `The price for ${id} wasn't readable.` };
    if (!good(p.inputPerMTok) || !good(p.outputPerMTok)) {
      return { ok: false, error: `The prices for ${id} must be numbers from 0 to ${MAX_PRICE.toLocaleString("en-US")} dollars per million tokens.` };
    }
    priceEntries.push([id, { inputPerMTok: p.inputPerMTok, outputPerMTok: p.outputPerMTok }]);
  }

  let key: string | null | undefined;
  if (input.key !== undefined) {
    if (input.key !== null && !isAiKey(input.key)) return { ok: false, error: "The API key can't be empty, can't contain spaces and can't be longer than 400 characters." };
    key = input.key;
  }

  const value: AiSettings = {
    enabled: input.enabled,
    provider,
    baseUrl: url.url,
    models,
    effort: input.effort as AiSettings["effort"],
    monthlyCapUsd: Math.round(cap * 100) / 100,
    maxOutputTokens: tokens,
    // Built from entries, not by assignment: an id is a key, and "__proto__" must stay one.
    prices: Object.fromEntries(priceEntries),
  };
  return key === undefined ? { ok: true, value } : { ok: true, value, key };
}
