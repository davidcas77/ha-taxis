import { areaChoice, AREA_TYPES, INVENTORY_AREA_ID, INVENTORY_ENTITY_ID, type AreaType, type InventoryRow, type InventorySettings } from "./inventory.ts";
import { checkPeriods, DEFAULT_COMFORT_PERIODS } from "./periods.ts";
import type { Hierarchy } from "./types.ts";

// Parameters: the numbers and times recipes are filled in with. Each has a
// built-in default and can be set for the whole house, for interior or exterior
// areas, for a floor and for one area. The most specific value wins, and a value
// that isn't set is inherited from the next level up. Choices live in Taxis
// only; nothing is written to Home Assistant until a recipe is installed. Pure
// functions, no side effects.

export const PARAM_TABS = ["house", "occupancy", "lighting", "media", "climate"] as const;
export type ParamTab = (typeof PARAM_TABS)[number];

export const PARAM_TAB_LABEL: Record<ParamTab, string> = { house: "House", occupancy: "Occupancy", lighting: "Lighting", media: "Media", climate: "Climate" };

// number: a number in a range. time: HH:MM. enum: one of a few words. bool: yes or
// no. text: a short name (a thermostat preset); empty means not set. entity: the
// id of an entity of one domain; empty means not set. entities: a list of entity
// ids of one domain (at least one; clear it to not set it). periods: comfort
// periods (shared/periods.ts).
export type ParamKind = "number" | "time" | "enum" | "bool" | "text" | "entity" | "entities" | "periods";
export type ParamValue = number | string | boolean | string[];

export type ParamDef = {
  key: ParamKey;
  tab: ParamTab;
  label: string;
  unit: string | null;
  kind: ParamKind;
  // number: the range, and the steps inside it (counted from min).
  min?: number;
  max?: number;
  step?: number;
  // enum: the values it can take.
  options?: readonly string[];
  // entity and entities: the domain its entity ids have to be in.
  domain?: string;
  // Set for one area only: it is not inherited from a floor, the interior or
  // exterior areas or the house, and the other levels can't set it.
  areaOnly?: boolean;
  default: ParamValue;
};

export const PARAM_KEYS = [
  "night_start",
  "night_end",
  "away_mode_entity",
  "sleep_mode_entity",
  "hold_timeout",
  "extended_after",
  "extended_hold",
  "sleep_hold",
  "lux_threshold",
  "day_brightness",
  "day_kelvin",
  "night_brightness",
  "night_kelvin",
  "transition",
  "dim_before_off",
  "dim_level",
  "override_duration",
  "entry_lights",
  "media_off_after",
  "tv_off_after",
  "comfort_temp",
  "eco_temp",
  "night_temp",
  "sleep_temp",
  "away_temp",
  "frost_temp",
  "min_temp",
  "max_temp",
  "window_delay",
  "restore_delay",
  "eco_after_clear",
  "comfort_needs_occupancy",
  "season",
  "auto_hvac_on",
  "doors_open_count",
  "comfort_periods",
  "preset_comfort",
  "preset_eco",
  "preset_away",
  "preset_sleep",
] as const;
export type ParamKey = (typeof PARAM_KEYS)[number];

export const PARAMS: readonly ParamDef[] = [
  { key: "night_start", tab: "house", label: "Night starts", unit: null, kind: "time", default: "23:00" },
  { key: "night_end", tab: "house", label: "Night ends", unit: null, kind: "time", default: "07:00" },
  // "": Taxis makes input_boolean.taxis_away / taxis_sleep when Area climate is installed.
  { key: "away_mode_entity", tab: "house", label: "Away mode switch", unit: null, kind: "entity", domain: "input_boolean", default: "" },
  { key: "sleep_mode_entity", tab: "house", label: "Sleep mode switch", unit: null, kind: "entity", domain: "input_boolean", default: "" },
  { key: "hold_timeout", tab: "occupancy", label: "Hold timeout", unit: "min", kind: "number", min: 1, max: 240, step: 1, default: 5 },
  { key: "extended_after", tab: "occupancy", label: "Extended after", unit: "min", kind: "number", min: 1, max: 720, step: 1, default: 30 },
  { key: "extended_hold", tab: "occupancy", label: "Extended hold timeout", unit: "min", kind: "number", min: 1, max: 240, step: 1, default: 15 },
  { key: "sleep_hold", tab: "occupancy", label: "Sleep hold timeout", unit: "min", kind: "number", min: 1, max: 480, step: 1, default: 60 },
  { key: "lux_threshold", tab: "lighting", label: "Dark below", unit: "lx", kind: "number", min: 0, max: 5000, step: 1, default: 50 },
  { key: "day_brightness", tab: "lighting", label: "Day brightness", unit: "%", kind: "number", min: 1, max: 100, step: 1, default: 100 },
  { key: "day_kelvin", tab: "lighting", label: "Day colour", unit: "K", kind: "number", min: 1500, max: 6500, step: 50, default: 3000 },
  { key: "night_brightness", tab: "lighting", label: "Night brightness", unit: "%", kind: "number", min: 1, max: 100, step: 1, default: 10 },
  { key: "night_kelvin", tab: "lighting", label: "Night colour", unit: "K", kind: "number", min: 1500, max: 6500, step: 50, default: 2200 },
  { key: "transition", tab: "lighting", label: "Transition", unit: "s", kind: "number", min: 0, max: 60, step: 1, default: 1 },
  { key: "dim_before_off", tab: "lighting", label: "Dim before off", unit: "s", kind: "number", min: 0, max: 300, step: 1, default: 15 },
  { key: "dim_level", tab: "lighting", label: "Dim level", unit: "%", kind: "number", min: 1, max: 100, step: 1, default: 30 },
  // 0: until the area next clears (or, for a change made while it is clear, is occupied again).
  { key: "override_duration", tab: "lighting", label: "Manual override lasts", unit: "min", kind: "number", min: 0, max: 240, step: 1, default: 0 },
  // The lights that come on by day when the area becomes occupied. Unset: the only
  // light of the area, else its main lights (entryLights below). Area level only.
  { key: "entry_lights", tab: "lighting", label: "Entry lights", unit: null, kind: "entities", domain: "light", areaOnly: true, default: [] },
  { key: "media_off_after", tab: "media", label: "Speakers off when clear for", unit: "min", kind: "number", min: 1, max: 720, step: 1, default: 15 },
  { key: "tv_off_after", tab: "media", label: "TVs off when clear for", unit: "min", kind: "number", min: 1, max: 720, step: 1, default: 30 },
  // Climate. Temperatures are in the unit Home Assistant is set to; the defaults are °C.
  { key: "comfort_temp", tab: "climate", label: "Comfort", unit: "°", kind: "number", min: 5, max: 35, step: 0.5, default: 21 },
  { key: "eco_temp", tab: "climate", label: "Eco", unit: "°", kind: "number", min: 5, max: 35, step: 0.5, default: 19 },
  { key: "night_temp", tab: "climate", label: "Night", unit: "°", kind: "number", min: 5, max: 35, step: 0.5, default: 18 },
  { key: "sleep_temp", tab: "climate", label: "Sleep", unit: "°", kind: "number", min: 5, max: 35, step: 0.5, default: 17.5 },
  { key: "away_temp", tab: "climate", label: "Away", unit: "°", kind: "number", min: 5, max: 35, step: 0.5, default: 16 },
  { key: "frost_temp", tab: "climate", label: "Frost protection", unit: "°", kind: "number", min: 0, max: 15, step: 0.5, default: 7 },
  { key: "min_temp", tab: "climate", label: "Lowest", unit: "°", kind: "number", min: 5, max: 35, step: 0.5, default: 16 },
  { key: "max_temp", tab: "climate", label: "Highest", unit: "°", kind: "number", min: 5, max: 35, step: 0.5, default: 24 },
  { key: "window_delay", tab: "climate", label: "Window open for", unit: "min", kind: "number", min: 0, max: 60, step: 1, default: 2 },
  { key: "restore_delay", tab: "climate", label: "Restore after close", unit: "min", kind: "number", min: 0, max: 60, step: 1, default: 1 },
  { key: "eco_after_clear", tab: "climate", label: "Eco when clear for", unit: "min", kind: "number", min: 1, max: 720, step: 1, default: 30 },
  // Bedrooms that haven't been given a choice don't need anyone in them (shared/recipes.ts).
  { key: "comfort_needs_occupancy", tab: "climate", label: "Comfort needs occupancy", unit: null, kind: "bool", default: true },
  { key: "season", tab: "climate", label: "Season", unit: null, kind: "enum", options: ["heating", "cooling", "off"], default: "heating" },
  { key: "auto_hvac_on", tab: "climate", label: "Switch on and off itself", unit: null, kind: "bool", default: false },
  { key: "doors_open_count", tab: "climate", label: "Open doors count", unit: null, kind: "bool", default: false },
  { key: "comfort_periods", tab: "climate", label: "Comfort periods", unit: null, kind: "periods", default: DEFAULT_COMFORT_PERIODS },
  { key: "preset_comfort", tab: "climate", label: "Preset: comfort", unit: null, kind: "text", default: "" },
  { key: "preset_eco", tab: "climate", label: "Preset: eco", unit: null, kind: "text", default: "" },
  { key: "preset_away", tab: "climate", label: "Preset: away", unit: null, kind: "text", default: "" },
  { key: "preset_sleep", tab: "climate", label: "Preset: sleep and night", unit: null, kind: "text", default: "" },
];

export const PARAM_DEF = Object.fromEntries(PARAMS.map((p) => [p.key, p])) as Record<ParamKey, ParamDef>;

export const isParamKey = (k: string): k is ParamKey => Object.hasOwn(PARAM_DEF, k);

export const paramsOf = (tab: ParamTab): ParamDef[] => PARAMS.filter((p) => p.tab === tab);

export const MAX_ENTITY_LIST = 20;

export const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

// A thermostat's preset name: letters, digits and a few marks, up to 40. No dot: a lower-case word.word would read as an entity id.
export const PRESET_NAME_RE = /^[\p{L}\p{N} _+/-]{1,40}$/u;

// Null when `value` is allowed for `def`; otherwise what's wrong, in words.
export function checkValue(def: ParamDef, value: unknown): string | null {
  switch (def.kind) {
    case "bool":
      return typeof value === "boolean" ? null : `${def.label} must be yes or no.`;
    case "text":
      return typeof value === "string" && (value === "" || PRESET_NAME_RE.test(value)) ? null : `${def.label} must be a name of up to 40 letters, digits and spaces.`;
    case "entity":
      return typeof value === "string" && (value === "" || (value.length <= 255 && INVENTORY_ENTITY_ID.test(value) && value.startsWith(`${def.domain}.`))) ? null : `${def.label} must be an ${def.domain} entity id.`;
    case "entities":
      return Array.isArray(value) &&
        value.length >= 1 &&
        value.length <= MAX_ENTITY_LIST &&
        new Set(value).size === value.length &&
        value.every((v) => typeof v === "string" && v.length <= 255 && INVENTORY_ENTITY_ID.test(v) && v.startsWith(`${def.domain}.`))
        ? null
        : `${def.label} must be a list of 1 to ${MAX_ENTITY_LIST} ${def.domain} entity ids.`;
    case "periods": {
      const problem = checkPeriods(value);
      return problem ? `${def.label}: ${problem}` : null;
    }
    case "time":
      return typeof value === "string" && TIME_RE.test(value) ? null : `${def.label} must be a time like 23:00.`;
    case "enum":
      return typeof value === "string" && (def.options ?? []).includes(value) ? null : `${def.label} must be one of ${(def.options ?? []).join(", ")}.`;
    case "number": {
      const { min = -Infinity, max = Infinity, step } = def;
      const range = `${def.label} must be between ${min} and ${max}${def.unit ? ` ${def.unit}` : ""}.`;
      if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) return range;
      if (step) {
        const n = (value - (Number.isFinite(min) ? min : 0)) / step;
        if (Math.abs(n - Math.round(n)) > 1e-9) return `${def.label} goes in steps of ${step}.`;
      }
      return null;
    }
  }
}

// ---------------------------------------------------------------------------
// The settings: only the values that were set.
// ---------------------------------------------------------------------------

export type ParamValues = Partial<Record<ParamKey, ParamValue>>;

export type ParameterSettings = {
  house: ParamValues;
  types: Partial<Record<AreaType, ParamValues>>;
  floors: Record<string, ParamValues>;
  areas: Record<string, ParamValues>;
};

export const EMPTY_PARAMETERS: ParameterSettings = { house: {}, types: {}, floors: {}, areas: {} };

export const MAX_PARAMETER_FLOORS = 200;
export const MAX_PARAMETER_AREAS = 500;
export const PARAMETER_FLOOR_ID = INVENTORY_AREA_ID;
export const PARAMETER_AREA_ID = INVENTORY_AREA_ID;

export type ParamScope = { level: "house" } | { level: "type"; id: AreaType } | { level: "floor"; id: string } | { level: "area"; id: string };

// Own keys only: an area called "constructor" mustn't find Object's.
function valuesOf(p: ParameterSettings, scope: ParamScope): ParamValues | undefined {
  switch (scope.level) {
    case "house":
      return p.house;
    case "type":
      return Object.hasOwn(p.types, scope.id) ? p.types[scope.id] : undefined;
    case "floor":
      return Object.hasOwn(p.floors, scope.id) ? p.floors[scope.id] : undefined;
    case "area":
      return Object.hasOwn(p.areas, scope.id) ? p.areas[scope.id] : undefined;
  }
}

// The value set at exactly this level, if any.
export const ownValue = (p: ParameterSettings, scope: ParamScope, key: ParamKey): ParamValue | undefined => valuesOf(p, scope)?.[key];

// ---------------------------------------------------------------------------
// Inheritance: house default → interior / exterior → floor → area.
// ---------------------------------------------------------------------------

export type ParamSource = { level: "area" | "floor" | "type" | "house"; id: string | null } | { level: "default"; id: null };

export type Resolved = { value: ParamValue; source: ParamSource };

const sourceOf = (s: ParamScope): ParamSource => ({ level: s.level, id: s.level === "house" ? null : s.id }) as ParamSource;

// The first scope that sets `key`, else the built-in default.
export function resolveIn(p: ParameterSettings, scopes: readonly ParamScope[], key: ParamKey): Resolved {
  const areaOnly = PARAM_DEF[key].areaOnly === true;
  for (const s of scopes) {
    // A parameter of one area is not inherited.
    if (areaOnly && s.level !== "area") continue;
    const v = valuesOf(p, s)?.[key];
    if (v !== undefined) return { value: v, source: sourceOf(s) };
  }
  return { value: PARAM_DEF[key].default, source: { level: "default", id: null } };
}

// Most specific first: the area, its floor, its type, the house.
export function scopesForArea(h: Hierarchy, inventory: InventorySettings, areaId: string): ParamScope[] {
  const floorId = h.areas[areaId]?.floorId;
  return [
    { level: "area", id: areaId },
    ...(floorId ? [{ level: "floor", id: floorId } as const] : []),
    { level: "type", id: areaChoice(inventory, areaId).type },
    { level: "house" },
  ];
}

export const resolve = (p: ParameterSettings, h: Hierarchy, inventory: InventorySettings, areaId: string, key: ParamKey): Resolved =>
  resolveIn(p, scopesForArea(h, inventory, areaId), key);

export function resolveAll(p: ParameterSettings, h: Hierarchy, inventory: InventorySettings, areaId: string): Record<ParamKey, ParamValue> {
  const scopes = scopesForArea(h, inventory, areaId);
  return Object.fromEntries(PARAM_KEYS.map((k) => [k, resolveIn(p, scopes, k).value])) as Record<ParamKey, ParamValue>;
}

// Where a value comes from, for a tooltip: "Interior areas", "First floor"…
export function sourceName(h: Hierarchy, s: ParamSource): string {
  switch (s.level) {
    case "default":
      return "the built-in default";
    case "house":
      return "the house default";
    case "type":
      return s.id === "exterior" ? "exterior areas" : "interior areas";
    case "floor":
      return h.floors.find((f) => f.id === s.id)?.name ?? s.id!;
    case "area":
      return h.areas[s.id!]?.name ?? s.id!;
  }
}

// "23:00" → "23:00:00", the form a blueprint's time input takes.
export const withSeconds = (t: string) => `${t}:00`;

// ---------------------------------------------------------------------------
// Edits. Each returns new settings, or the same object when nothing changes.
// A value of null clears it (the level inherits again) and an emptied level goes.
// ---------------------------------------------------------------------------

const sameParam = (a: ParamValue | null, b: ParamValue | null): boolean =>
  Array.isArray(a) && Array.isArray(b) ? a.length === b.length && a.every((x, i) => x === b[i]) : a === b;

export function setParameter(p: ParameterSettings, scope: ParamScope, key: ParamKey, value: ParamValue | null): ParameterSettings {
  // Only an area has a parameter of one area.
  if (PARAM_DEF[key].areaOnly && scope.level !== "area") return p;
  // An empty list is no value.
  if (Array.isArray(value) && value.length === 0) value = null;
  const cur = valuesOf(p, scope);
  if (sameParam(cur?.[key] ?? null, value)) return p;
  const next: ParamValues = { ...cur };
  if (value === null) delete next[key];
  else next[key] = value;
  const empty = Object.keys(next).length === 0;
  switch (scope.level) {
    case "house":
      return { ...p, house: next };
    case "type": {
      const types = { ...p.types };
      if (empty) delete types[scope.id];
      else types[scope.id] = next;
      return { ...p, types };
    }
    case "floor":
    case "area": {
      const field = scope.level === "floor" ? "floors" : "areas";
      const map = { ...p[field] };
      if (empty) delete map[scope.id];
      else map[scope.id] = next;
      return { ...p, [field]: map };
    }
  }
}

// ---------------------------------------------------------------------------
// The rows of a parameters table: the house, interior and exterior, then each
// floor with its areas.
// ---------------------------------------------------------------------------

export type ParamRow = {
  scope: ParamScope;
  label: string;
  // The scopes it inherits from, most specific first, starting with its own.
  chain: ParamScope[];
  // Floors and areas: the floor an area is on (null: none), for grouping.
  floorId: string | null;
  floorName: string | null;
  // Position in the default order: floors by level, their areas by name.
  order: number;
};

export function paramRows(h: Hierarchy, inventory: InventorySettings): { fixed: ParamRow[]; rest: ParamRow[] } {
  const house: ParamScope = { level: "house" };
  const fixed: ParamRow[] = [
    { scope: house, label: "House default", chain: [house], floorId: null, floorName: null, order: 0 },
    ...AREA_TYPES.map((t, i): ParamRow => {
      const scope: ParamScope = { level: "type", id: t };
      return { scope, label: t === "interior" ? "Interior" : "Exterior", chain: [scope, house], floorId: null, floorName: null, order: i + 1 };
    }),
  ];
  const rest: ParamRow[] = [];
  let order = 0;
  const addAreas = (ids: readonly string[], floorId: string | null, floorName: string | null) => {
    for (const id of ids) {
      if (!h.areas[id]) continue;
      rest.push({ scope: { level: "area", id }, label: h.areas[id].name, chain: scopesForArea(h, inventory, id), floorId, floorName, order: order++ });
    }
  };
  for (const f of h.floors) {
    const scope: ParamScope = { level: "floor", id: f.id };
    rest.push({ scope, label: f.name, chain: [scope, house], floorId: f.id, floorName: f.name, order: order++ });
    addAreas(f.areaIds, f.id, f.name);
  }
  addAreas(h.looseAreaIds, null, null);
  return { fixed, rest };
}

// ---------------------------------------------------------------------------
// Entry lights: the lights that come on by day when an area becomes occupied.
// ---------------------------------------------------------------------------

export type EntryLightsSource =
  // The user's choice.
  | "set"
  // Nothing chosen, and the area has one counted light.
  | "only"
  // Nothing chosen: the main lights of the area.
  | "main"
  // Nothing chosen and nothing to suggest.
  | "none";

export type EntryLights = {
  // The lights that go on: the choice when it names a counted light of the area,
  // else the default.
  lights: string[];
  source: EntryLightsSource;
  // What the user chose, whether or not it still applies (null: nothing).
  set: string[] | null;
  // The default, which `lights` is when nothing applies. It is what the Lighting
  // tab shows muted as "suggested".
  suggested: string[];
};

// `rows`: the lights of the area's inventory (areaInventory(...).lights). The
// choice is kept only for lights that still count in the area, so a light that
// was removed or excluded can't leave the automation switching something that
// isn't there.
export function entryLights(p: ParameterSettings, areaId: string, rows: readonly Pick<InventoryRow, "entityId" | "counts" | "light">[]): EntryLights {
  const counted = rows.filter((r) => r.counts);
  const only = counted.length === 1;
  const suggested = only ? [counted[0].entityId] : counted.filter((r) => r.light === "main").map((r) => r.entityId).sort();
  const stored = ownValue(p, { level: "area", id: areaId }, "entry_lights");
  const set = Array.isArray(stored) ? stored : null;
  const valid = set ? set.filter((id) => counted.some((r) => r.entityId === id)).sort() : [];
  if (valid.length > 0) return { lights: valid, source: "set", set, suggested };
  return { lights: suggested, source: suggested.length === 0 ? "none" : only ? "only" : "main", set, suggested };
}
