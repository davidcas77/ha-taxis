import { areaChoice, AREA_TYPES, INVENTORY_AREA_ID, type AreaType, type InventorySettings } from "./inventory.ts";
import type { Hierarchy } from "./types.ts";

// Parameters: the numbers and times recipes are filled in with. Each has a
// built-in default and can be set for the whole house, for interior or exterior
// areas, for a floor and for one area. The most specific value wins, and a value
// that isn't set is inherited from the next level up. Choices live in Taxis
// only; nothing is written to Home Assistant until a recipe is installed. Pure
// functions, no side effects.

export const PARAM_TABS = ["house", "occupancy", "lighting"] as const;
export type ParamTab = (typeof PARAM_TABS)[number];

export const PARAM_TAB_LABEL: Record<ParamTab, string> = { house: "House", occupancy: "Occupancy", lighting: "Lighting" };

export type ParamKind = "number" | "time" | "enum";
export type ParamValue = number | string;

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
  default: ParamValue;
};

export const PARAM_KEYS = [
  "night_start",
  "night_end",
  "hold_timeout",
  "lux_threshold",
  "day_brightness",
  "day_kelvin",
  "night_brightness",
  "night_kelvin",
  "transition",
  "dim_before_off",
  "dim_level",
] as const;
export type ParamKey = (typeof PARAM_KEYS)[number];

export const PARAMS: readonly ParamDef[] = [
  { key: "night_start", tab: "house", label: "Night starts", unit: null, kind: "time", default: "23:00" },
  { key: "night_end", tab: "house", label: "Night ends", unit: null, kind: "time", default: "07:00" },
  { key: "hold_timeout", tab: "occupancy", label: "Hold timeout", unit: "min", kind: "number", min: 1, max: 240, step: 1, default: 5 },
  { key: "lux_threshold", tab: "lighting", label: "Dark below", unit: "lx", kind: "number", min: 0, max: 5000, step: 1, default: 50 },
  { key: "day_brightness", tab: "lighting", label: "Day brightness", unit: "%", kind: "number", min: 1, max: 100, step: 1, default: 100 },
  { key: "day_kelvin", tab: "lighting", label: "Day colour", unit: "K", kind: "number", min: 1500, max: 6500, step: 50, default: 3000 },
  { key: "night_brightness", tab: "lighting", label: "Night brightness", unit: "%", kind: "number", min: 1, max: 100, step: 1, default: 10 },
  { key: "night_kelvin", tab: "lighting", label: "Night colour", unit: "K", kind: "number", min: 1500, max: 6500, step: 50, default: 2200 },
  { key: "transition", tab: "lighting", label: "Transition", unit: "s", kind: "number", min: 0, max: 60, step: 1, default: 1 },
  { key: "dim_before_off", tab: "lighting", label: "Dim before off", unit: "s", kind: "number", min: 0, max: 300, step: 1, default: 15 },
  { key: "dim_level", tab: "lighting", label: "Dim level", unit: "%", kind: "number", min: 1, max: 100, step: 1, default: 30 },
];

export const PARAM_DEF = Object.fromEntries(PARAMS.map((p) => [p.key, p])) as Record<ParamKey, ParamDef>;

export const isParamKey = (k: string): k is ParamKey => Object.hasOwn(PARAM_DEF, k);

export const paramsOf = (tab: ParamTab): ParamDef[] => PARAMS.filter((p) => p.tab === tab);

export const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

// Null when `value` is allowed for `def`; otherwise what's wrong, in words.
export function checkValue(def: ParamDef, value: unknown): string | null {
  switch (def.kind) {
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
  for (const s of scopes) {
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

export function setParameter(p: ParameterSettings, scope: ParamScope, key: ParamKey, value: ParamValue | null): ParameterSettings {
  const cur = valuesOf(p, scope);
  if ((cur?.[key] ?? null) === value) return p;
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
