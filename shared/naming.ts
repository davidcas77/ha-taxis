import type { HelperNames } from "./helpers.ts";
import type { AreaNode, EntityItem, EntityRole, Hierarchy } from "./types.ts";

// Naming: a code per area, a pattern for entity ids and display names, and an
// analysis of every area against them. Pure functions; nothing here changes
// anything. Display-name suggestions become ordinary changes in the list;
// entity_id suggestions are shown only (renaming ids, with every reference to
// them, comes later).

export type NamingSettings = {
  // Tokens: {area} {type} {name}.
  idPattern: string;
  // Tokens: {Area} {Name}.
  namePattern: string;
  // Area id -> the code its entity ids start with. Missing: the detected one.
  areaCodes: Record<string, string>;
  // Role -> the word for it in entity ids. Missing: the default.
  typeWords: Partial<Record<EntityRole, string>>;
  // Helper key -> the end of its canonical entity id (shared/helpers.ts).
  // Missing: the default.
  helperNames: HelperNames;
};

export const DEFAULT_TYPE_WORDS: Record<EntityRole, string> = {
  light: "light",
  switch: "switch",
  motion: "motion",
  presence: "presence",
  opening: "door",
  climate: "climate",
  temperature: "temp",
  humidity: "hum",
  illuminance: "lux",
  media: "media",
  cover: "cover",
  lock: "lock",
  power: "power",
  battery: "battery",
  button: "button",
  sensor: "sensor",
  automation: "automation",
  helper: "helper",
  camera: "cam",
  other: "",
};

export const DEFAULT_NAMING: NamingSettings = {
  idPattern: "{area}_{type}_{name}",
  namePattern: "{Area} {Name}",
  areaCodes: {},
  typeWords: {},
  helperNames: {},
};

export const slug = (s: string): string =>
  s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

const objectId = (entityId: string) => entityId.slice(entityId.indexOf(".") + 1);
const startsWithCode = (id: string, code: string) => code.length > 0 && (id === code || id.startsWith(`${code}_`));

// Doors and windows use their own word when Home Assistant says which they are.
export function typeWord(e: EntityItem, s: NamingSettings): string {
  if (e.role === "opening" && !Object.hasOwn(s.typeWords, "opening")) {
    if (e.deviceClass === "window") return "window";
    if (e.deviceClass === "garage_door") return "garage";
  }
  return (Object.hasOwn(s.typeWords, e.role) ? s.typeWords[e.role] : undefined) ?? DEFAULT_TYPE_WORDS[e.role] ?? e.domain;
}

// ---------------------------------------------------------------------------
// Area codes: what each area's entity ids start with today.
// ---------------------------------------------------------------------------

export type AreaCode = {
  code: string;
  // The prefix found in the area's entity ids, and how many of them use it.
  detected: string;
  detectedCount: number;
  total: number;
  // Other prefixes that also stand for this area (old ids, the area id).
  aliases: string[];
  custom: boolean;
  // The detected code is the area's id (or name) because nothing in its
  // entities settled it: "id" for the area id, "name" for its name.
  fallback: "id" | "name" | null;
};

const counted = (e: EntityItem) => !e.disabled && !e.maintenance;

export function detectAreaCode(
  area: AreaNode,
  h: Hierarchy,
): { code: string; count: number; total: number; candidates: string[]; fallback: "id" | "name" | null } {
  const ids = area.entityIds.map((id) => h.entities[id]).filter((e): e is EntityItem => Boolean(e) && counted(e)).map((e) => objectId(e.entityId));
  const firstTokens = new Map<string, number>();
  for (const id of ids) {
    const t = id.split("_")[0];
    if (t) firstTokens.set(t, (firstTokens.get(t) ?? 0) + 1);
  }
  // A first token counts only when it looks like the area ("livingroom" for
  // living_room, "living" for Living room): the most common token is often a
  // brand or device ("dryer", "sonoff", "k90") instead.
  const compact = [area.id.replace(/_/g, ""), slug(area.name).replace(/_/g, "")];
  const related = (t: string) => t.length >= 3 && compact.some((c) => c.startsWith(t) || t.startsWith(c));
  const topFirst = [...firstTokens.entries()].filter(([t]) => related(t)).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([t]) => t);
  // Another area's own names never count as this area's prefix (a hallway
  // switch named "bathroom_…" says Bathroom, not Hallway).
  const foreign = new Set(Object.values(h.areas).filter((a) => a.id !== area.id).flatMap((a) => [a.id, a.id.replace(/_/g, ""), slug(a.name), slug(a.name).replace(/_/g, "")]));
  const candidates = [...new Set([area.id, area.id.replace(/_/g, ""), slug(area.name), slug(area.name).replace(/_/g, ""), ...topFirst].filter((x): x is string => Boolean(x) && !foreign.has(x)))];
  const score = (c: string) => ids.filter((id) => startsWithCode(id, c)).length;
  // The best-used prefix wins; on a tie, the area's own id.
  const ranked = candidates.map((c) => ({ c, n: score(c) })).sort((a, b) => b.n - a.n || (a.c === area.id ? -1 : b.c === area.id ? 1 : 0));
  const best = ranked[0];
  // No entities, or no clear winner: the area id, which never changes. Its
  // name is the second choice, for an id that says nothing usable.
  const found = best && best.n > 0;
  const fromId = slug(area.id);
  const fallback = found ? null : fromId ? "id" : "name";
  const code = found ? best.c : fromId || slug(area.name) || area.id;
  return { code, count: found ? best.n : 0, total: ids.length, candidates: ranked.filter((r) => r.n > 0).map((r) => r.c), fallback };
}

export function areaCodes(h: Hierarchy, s: NamingSettings): Record<string, AreaCode> {
  const out: Record<string, AreaCode> = {};
  for (const area of Object.values(h.areas)) {
    const d = detectAreaCode(area, h);
    // Own keys only: an area called "constructor" mustn't find Object's.
    const custom = Object.hasOwn(s.areaCodes, area.id) ? s.areaCodes[area.id] : undefined;
    const code = custom ? slug(custom) : d.code;
    out[area.id] = {
      code,
      detected: d.code,
      detectedCount: d.count,
      total: d.total,
      aliases: [...new Set([d.code, area.id, area.id.replace(/_/g, ""), ...d.candidates])].filter((x) => x && x !== code),
      custom: Boolean(custom),
      fallback: d.fallback,
    };
  }
  return out;
}

// Codes that more than one area ends up with: code -> the areas sharing it.
// Takes anything with a code (the effective ones from areaCodes), so detected
// and custom codes are held to the same rule. Empty codes are ignored.
export function duplicateCodes(codes: Record<string, { code: string }>): Map<string, string[]> {
  const byCode = new Map<string, string[]>();
  for (const [areaId, { code }] of Object.entries(codes)) {
    if (!code) continue;
    byCode.set(code, [...(byCode.get(code) ?? []), areaId]);
  }
  for (const [code, ids] of byCode) if (ids.length < 2) byCode.delete(code);
  return byCode;
}

// Ids that appear more than once. Home Assistant keeps area ids unique; this
// is a defensive check on what it sent.
export function duplicateIds(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const id of ids) (seen.has(id) ? dupes : seen).add(id);
  return [...dupes];
}

// One sentence per shared code, naming the areas ("kitchen" is the code of
// Kitchen and Kitchenette), or null when every code is its own.
export function duplicateCodesMessage(dupes: Map<string, string[]>, nameOf: (areaId: string) => string): string | null {
  if (dupes.size === 0) return null;
  return [...dupes].map(([code, ids]) => `The code “${code}” is used by ${ids.map(nameOf).join(" and ")}.`).join(" ");
}

// ---------------------------------------------------------------------------
// Analysing an area.
// ---------------------------------------------------------------------------

export type NamingStatus =
  | "ok" // starts with the area's code
  | "old-prefix" // starts with another prefix of this area
  | "other-area" // starts with another area's code
  | "no-area"; // doesn't say its area

export type NamingRow = {
  entityId: string;
  name: string;
  customName: string | null;
  status: NamingStatus;
  // For "old-prefix" and "other-area": the prefix found, and the area it means.
  foundPrefix: string | null;
  otherAreaId: string | null;
  suggestedId: string | null; // full entity id, null when it already fits
  suggestedName: string | null; // null when the name already fits
  editable: boolean;
};

export type AreaNaming = {
  code: string;
  rows: NamingRow[];
  counts: Record<NamingStatus, number>;
};

// What an entity is called when its name is only its area's name.
const ROLE_NAMES: Partial<Record<EntityRole, string>> = {
  light: "Light",
  switch: "Switch",
  motion: "Motion",
  presence: "Presence",
  opening: "Door",
  climate: "Climate",
  temperature: "Temperature",
  humidity: "Humidity",
  illuminance: "Light level",
  media: "Media",
  cover: "Cover",
  lock: "Lock",
  power: "Power",
  battery: "Battery",
  camera: "Camera",
};

// Ids that say nothing beyond the kind of thing: "switch2_8", "motion_sensor_5",
// "sonoff_100226ee6d", "153931629685202_climate".
const GENERIC = new Set(["switch", "sensor", "light", "motion", "button", "entity", "device", "relay", "plug", "temperature", "humidity", "contact"]);
const isSerialToken = (t: string) => /^(?=.*\d)[0-9a-f]{8,}$/.test(t) || /^\d{6,}/.test(t);
const isGenericToken = (t: string) => GENERIC.has(t.replace(/\d+$/, "")) || /^\d+$/.test(t) || isSerialToken(t);

// Domains that carry many kinds of thing, where the id needs a type word.
// Everywhere else the domain is the type (light, cover, climate, automation…).
const CARRIER_DOMAINS = new Set(["sensor", "binary_sensor", "switch", "event", "button", "select", "number", "text", "image", "update"]);

// Drops the area's own code from the front of a token list, in any spelling
// ("living_room_lamp" and "livingroom_lamp" both lose it).
function dropLeadingPrefix(tokens: string[], prefixes: string[]): string[] {
  for (const p of prefixes) {
    const parts = p.split("_");
    for (let k = 1; k <= Math.min(tokens.length, parts.length + 1); k++) {
      const head = tokens.slice(0, k);
      if (head.join("_") === p || head.join("") === p.replace(/_/g, "")) return tokens.slice(k);
    }
  }
  return tokens;
}

// "LR" for Living Room: names often start with the area's initials.
const initials = (name: string) => {
  const words = name.split(/\s+/).filter(Boolean);
  return words.length >= 2 ? words.map((w) => w[0]).join("").toLowerCase() : "";
};

function fill(pattern: string, parts: Record<string, string>): string {
  let out = pattern;
  for (const [k, v] of Object.entries(parts)) out = out.split(`{${k}}`).join(v);
  return out;
}

export function analyzeArea(area: AreaNode, h: Hierarchy, s: NamingSettings, codes: Record<string, AreaCode> = areaCodes(h, s)): AreaNaming {
  const mine = codes[area.id];
  const code = mine.code;
  const ownPrefixes = [code, ...mine.aliases].sort((a, b) => b.length - a.length);
  // Other areas, by every prefix that stands for them (longest first, so
  // "guest_bathroom" wins over "guest").
  const others = Object.entries(codes)
    .filter(([id]) => id !== area.id)
    .flatMap(([id, c]) => [c.code, ...c.aliases].filter((p) => p.length >= 3).map((p) => ({ id, p })))
    .sort((a, b) => b.p.length - a.p.length);
  const otherNames = Object.values(h.areas).filter((a) => a.id !== area.id).map((a) => a.name);
  const taken = new Set(Object.keys(h.entities));
  const proposed = new Set<string>();
  const counts: Record<NamingStatus, number> = { ok: 0, "old-prefix": 0, "other-area": 0, "no-area": 0 };
  const rows: NamingRow[] = [];

  for (const id of area.entityIds) {
    const e = h.entities[id];
    if (!e || !counted(e)) continue;
    const obj = objectId(e.entityId);

    let status: NamingStatus = "no-area";
    let foundPrefix: string | null = null;
    let otherAreaId: string | null = null;
    if (startsWithCode(obj, code)) status = "ok";
    else {
      const own = ownPrefixes.find((p) => p !== code && startsWithCode(obj, p));
      const other = others.find((o) => startsWithCode(obj, o.p));
      if (own && (!other || own.length >= other.p.length)) {
        status = "old-prefix";
        foundPrefix = own;
      } else if (other) {
        status = "other-area";
        foundPrefix = other.p;
        otherAreaId = other.id;
      }
    }
    counts[status] += 1;

    // The id suggestion: the pattern, with whatever the id says beyond its area
    // and type as the name part.
    let rest = obj;
    if (foundPrefix || status === "ok") rest = rest.slice((foundPrefix ?? code).length).replace(/^_+/, "");
    const tw = typeWord(e, s);
    // The type word goes in only where the domain doesn't already say it
    // ("light.study_main", not "light.study_light_main"), and never twice.
    const type = CARRIER_DOMAINS.has(e.domain) && tw !== e.domain ? tw : "";
    // What the domain and the type word already say comes off the front, and
    // the type word off the end ("main_door" is "door_main"); "cam_siren" in
    // a siren id stays, since nothing puts it back.
    const typeTokens = new Set([type, e.domain, e.role].filter(Boolean));
    const clean = (ts: string[]) => {
      let out = [...new Set(ts.filter(Boolean))];
      while (out.length && typeTokens.has(out[0])) out = out.slice(1);
      if (type && out.length > 1 && typeTokens.has(out[out.length - 1])) out = out.slice(0, -1);
      return out;
    };
    let tokens = clean(rest.split("_"));
    // "lr_ledstrip" in Living Room: the initials stand for the area.
    if (status === "no-area" && tokens.length > 1 && tokens[0] === initials(area.name)) tokens = tokens.slice(1);
    // An id that already says its area keeps what follows ("hallway_light_1");
    // one that doesn't, or carries a serial number, is named after what Home
    // Assistant calls it instead.
    if ((status === "no-area" && (tokens.length === 0 || tokens.every(isGenericToken))) || tokens.some(isSerialToken)) {
      let fromName = e.name;
      for (const n of [area.name, ...otherNames]) fromName = fromName.replace(new RegExp(n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "ig"), " ");
      tokens = dropLeadingPrefix(clean(slug(fromName).split("_")), ownPrefixes);
    }
    const namePart = tokens.join("_");
    let wanted = slug(fill(s.idPattern, { area: code, type, name: namePart })).replace(/_+/g, "_");
    let full = `${e.domain}.${wanted}`;
    for (let n = 2; full !== e.entityId && (taken.has(full) || proposed.has(full)); n++) full = `${e.domain}.${wanted}_${n}`;
    // An id that already fits isn't worth trading for a numbered one.
    if (status === "ok" && full !== `${e.domain}.${wanted}`) full = e.entityId;
    proposed.add(full);
    const suggestedId = full === e.entityId ? null : full;

    // The display-name suggestion: the pattern, with the name minus any area
    // name it carries.
    let bare = e.customName ?? e.name;
    for (const n of [area.name, ...otherNames]) bare = bare.replace(new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "ig"), " ");
    // Names often start with the area's code instead of its name ("Living
    // lamp", "LR ledstrip", "Livingroom spots"): drop that too.
    for (const p of [code, ...mine.aliases, initials(area.name), ...others.map((o) => o.p)].filter(Boolean)) {
      const words = p.split("_").map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("[ _-]?");
      bare = bare.replace(new RegExp(`^\\s*${words}\\b`, "i"), " ");
    }
    bare = bare.replace(/\s+/g, " ").trim();
    // Nothing left once the area is gone ("Kitchen" in the kitchen): the
    // entity's kind stands in for it, so the area isn't named twice.
    if (!bare) bare = ROLE_NAMES[e.role] ?? e.domain.replace(/_/g, " ");
    bare = bare.charAt(0).toUpperCase() + bare.slice(1);
    const nameWanted = fill(s.namePattern, { Area: area.name, Name: bare }).replace(/\s+/g, " ").trim();
    // A difference in letter case alone isn't worth renaming for.
    const suggestedName = nameWanted.toLowerCase() === e.name.toLowerCase() ? null : nameWanted;

    rows.push({
      entityId: e.entityId,
      name: e.name,
      customName: e.customName,
      status,
      foundPrefix,
      otherAreaId,
      suggestedId,
      suggestedName,
      editable: e.inRegistry,
    });
  }
  return { code, rows, counts };
}
