import { HOUSE_AREAS_OCCUPIED_ID, HOUSE_HELPER_IDS, HOUSE_OCCUPIED_ID } from "../climate.ts";
import { canonicalId, effectiveSuffixes, HELPERS, helperExclusions } from "../helpers.ts";
import { ENTITY_DOMAINS, entityIdsIn, serviceCalls, type ServiceCall } from "../health-scan.ts";
import { areaInventory, type AreaInventory, type InventorySettings } from "../inventory.ts";
import { areaCodes, floorCodes, houseGroupId, type NamingSettings } from "../naming.ts";
import { SCRIPT_IDS } from "../blueprints.ts";
import { type ParameterSettings } from "../parameters.ts";
import { automationIdFor, runtimeIds } from "../recipes.ts";
import { type Change, type Hierarchy, type RefKind } from "../types.ts";
import {
  type Severity,
  type HealthOptions,
  DEFAULT_HEALTH_OPTIONS,
  HEALTH_LIMITS,
  type HealthItem,
  type HealthState,
  type HealthInput,
  type HealthFinding,
} from "./types.ts";

// What the checks share: small helpers, the context built once per run, and the
// lookups several checks use.

// ---------------------------------------------------------------------------
// Small helpers.
// ---------------------------------------------------------------------------

export const HOUR = 3_600_000;
export const DAY = 24 * HOUR;
export const RANK: Record<Severity, number> = { error: 0, warning: 1, info: 2 };
export const KIND_LABEL: Record<RefKind, string> = { automation: "Automation", script: "Script", scene: "Scene", dashboard: "Dashboard" };

export const isObject = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === "object" && !Array.isArray(v);
export const itemKey = (i: Pick<HealthItem, "kind" | "id">) => `${i.kind}:${i.id}`;
export const itemName = (i: HealthItem) => `${KIND_LABEL[i.kind]} “${i.name}”`;
export const asItem = (i: HealthItem): NonNullable<HealthFinding["item"]> => ({ kind: i.kind, id: i.id, name: i.name, entityId: i.entityId });
export const bump = (s: Severity): Severity => (s === "info" ? "warning" : "error");
export const timeOf = (iso: string | null | undefined): number | null => {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
};
export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// "2 hours", "3 days".
export function ageText(ms: number): string {
  if (ms < HOUR) return plural(Math.max(1, Math.round(ms / 60_000)), "minute");
  if (ms < DAY) return plural(Math.round(ms / HOUR), "hour");
  return plural(Math.round(ms / DAY), "day");
}

// "a, b and 2 more".
export function names(list: readonly string[], max = 6): string {
  if (list.length <= max) return list.length > 1 ? `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}` : list.join("");
  return `${list.slice(0, max).join(", ")} and ${list.length - max} more`;
}

export const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

export function healthOptions(o?: Partial<HealthOptions>): HealthOptions {
  const pick = (v: number | undefined, fallback: number, min: number, max: number) =>
    typeof v === "number" && Number.isFinite(v) ? clamp(Math.round(v), min, max) : fallback;
  return {
    unavailableHours: pick(
      o?.unavailableHours,
      DEFAULT_HEALTH_OPTIONS.unavailableHours,
      HEALTH_LIMITS.unavailableHours.min,
      HEALTH_LIMITS.unavailableHours.max,
    ),
    staleDays: pick(o?.staleDays, DEFAULT_HEALTH_OPTIONS.staleDays, HEALTH_LIMITS.staleDays.min, HEALTH_LIMITS.staleDays.max),
  };
}

// ---------------------------------------------------------------------------
// What the checks share.
// ---------------------------------------------------------------------------

export type Ctx = {
  h: Hierarchy;
  states: Record<string, HealthState>;
  now: number;
  opts: HealthOptions;
  domains: ReadonlySet<string>;
  items: HealthItem[];
  readable: HealthItem[];
  // Items whose config could not be read, so nothing in them was checked.
  unreadable: HealthItem[];
  byEntity: Map<string, HealthItem>;
  // The entity ids each readable item uses, found or not.
  refs: Map<string, Set<string>>;
  // Items that use an entity.
  usedBy: Map<string, HealthItem[]>;
  inventory: InventorySettings;
  naming: NamingSettings;
  parameters: ParameterSettings;
  changes: readonly Change[];
  codes: Record<string, { code: string }>;
  suffix: ReturnType<typeof effectiveSuffixes>;
  inv: Map<string, AreaInventory>;
  exclusions: (areaId: string) => ReadonlySet<string>;
  // Ids Taxis makes itself (an area's canonical and runtime helpers).
  taxisIds: Set<string>;
  // The areas that have Area climate installed, with the inputs of its automation.
  climateAreas: Map<string, Record<string, unknown>>;
  exists: (id: string) => boolean;
  stateOf: (id: string) => string | undefined;
};

export const isTaxisItem = (i: HealthItem): boolean => {
  // The automations of the recipes, and the announce script.
  if ((i.kind !== "automation" && !(i.kind === "script" && SCRIPT_IDS.includes(i.id))) || !i.id.startsWith("taxis_") || !isObject(i.config)) return false;
  const ub = i.config.use_blueprint;
  return isObject(ub) && typeof ub.path === "string" && ub.path.startsWith("taxis/");
};

export const enabled = (c: Ctx, i: HealthItem) => i.kind !== "automation" || c.stateOf(i.entityId ?? "") !== "off";
export const areaOf = (c: Ctx, entityId: string | null | undefined): string | undefined =>
  entityId ? (c.h.entities[entityId]?.areaId ?? undefined) : undefined;
export const nameOf = (c: Ctx, id: string) => c.h.entities[id]?.name ?? id;
export const unreadableNote = (c: Ctx) =>
  c.unreadable.length === 0
    ? ""
    : ` Taxis could not read ${plural(c.unreadable.length, "automation, script or scene")} (written in YAML, or unreadable), and any of them may do this.`;

export function context(input: HealthInput): Ctx {
  const { snapshot, now } = input;
  const h = snapshot.hierarchy;
  const domains = new Set([...ENTITY_DOMAINS, ...Object.values(h.entities).map((e) => e.domain)]);
  const readable = snapshot.items.filter((i) => i.config !== null);
  const refs = new Map<string, Set<string>>();
  const usedBy = new Map<string, HealthItem[]>();
  for (const item of readable) {
    const ids = entityIdsIn(item.config, domains);
    refs.set(itemKey(item), ids);
    for (const id of ids) usedBy.set(id, [...(usedBy.get(id) ?? []), item]);
  }
  const codes = areaCodes(h, input.naming);
  const suffix = effectiveSuffixes(input.naming.helperNames);
  const taxisIds = new Set<string>();
  const inv = new Map<string, AreaInventory>();
  for (const area of Object.values(h.areas)) {
    const code = codes[area.id].code;
    for (const spec of HELPERS) taxisIds.add(canonicalId(spec.domain, code, suffix[spec.key]));
    for (const id of Object.values(runtimeIds(code))) taxisIds.add(id);
  }
  for (const id of HOUSE_HELPER_IDS) taxisIds.add(id);
  taxisIds.add(HOUSE_AREAS_OCCUPIED_ID);
  taxisIds.add(HOUSE_OCCUPIED_ID);
  // The light groups of the floors and of the house.
  for (const code of Object.values(floorCodes(h, input.naming))) taxisIds.add(canonicalId("light", code.code, suffix.lights));
  taxisIds.add(houseGroupId(input.naming));
  const climateAreas = new Map<string, Record<string, unknown>>();
  for (const area of Object.values(h.areas)) {
    const item = readable.find((i) => i.kind === "automation" && i.id === automationIdFor("area_climate", codes[area.id].code) && isTaxisItem(i));
    const ub = item && isObject(item.config) ? item.config.use_blueprint : undefined;
    if (item && isObject(ub)) climateAreas.set(area.id, isObject(ub.input) ? ub.input : {});
  }
  return {
    h,
    states: snapshot.states,
    now,
    opts: healthOptions(input.options),
    domains,
    items: snapshot.items,
    readable,
    unreadable: snapshot.items.filter((i) => i.config === null && i.kind !== "dashboard"),
    byEntity: new Map(snapshot.items.filter((i) => i.entityId).map((i) => [i.entityId!, i])),
    refs,
    usedBy,
    inventory: input.inventory,
    naming: input.naming,
    parameters: input.parameters,
    changes: input.changes,
    codes,
    suffix,
    inv,
    exclusions: helperExclusions(h, input.naming),
    taxisIds,
    climateAreas,
    exists: (id) => Object.hasOwn(h.entities, id) || Object.hasOwn(snapshot.states, id),
    stateOf: (id) => (Object.hasOwn(snapshot.states, id) ? snapshot.states[id].state : (h.entities[id]?.state ?? undefined)),
  };
}

// An area's inventory, with its own canonical helpers left out as everywhere else.
export function inventoryOf(c: Ctx, areaId: string): AreaInventory {
  let inv = c.inv.get(areaId);
  if (!inv) {
    inv = areaInventory(c.h, c.inventory, areaId, c.exclusions(areaId));
    c.inv.set(areaId, inv);
  }
  return inv;
}

// ---------------------------------------------------------------------------
// Who changes a switch: the service calls and scenes that turn input booleans
// on and off. Used by two checks.
// ---------------------------------------------------------------------------

export const TURN_ON = new Set(["input_boolean.turn_on", "homeassistant.turn_on"]);
export const TURN_OFF = new Set(["input_boolean.turn_off", "homeassistant.turn_off"]);
export const TOGGLE = new Set(["input_boolean.toggle", "homeassistant.toggle"]);

// The entities of one domain a service call reaches: the ones it names, and the
// ones in the areas, floors, labels and devices it names.
export function reached(c: Ctx, call: ServiceCall, domain: string): string[] {
  const out = new Set<string>(call.entityIds);
  for (const a of call.areaIds) for (const id of c.h.areas[a]?.entityIds ?? []) out.add(id);
  for (const f of call.floorIds) for (const a of c.h.floors.find((x) => x.id === f)?.areaIds ?? []) for (const id of c.h.areas[a]?.entityIds ?? []) out.add(id);
  for (const l of call.labelIds) for (const e of Object.values(c.h.entities)) if (e.labels.includes(l)) out.add(e.entityId);
  for (const d of call.deviceIds) for (const id of c.h.devices[d]?.entityIds ?? []) out.add(id);
  return [...out].filter((id) => id.startsWith(`${domain}.`));
}

export type Writers = { on: Map<string, Set<string>>; off: Map<string, Set<string>>; dynamicOn: boolean; dynamicOff: boolean };

export function writers(c: Ctx): Writers {
  const w: Writers = { on: new Map(), off: new Map(), dynamicOn: false, dynamicOff: false };
  const add = (map: Map<string, Set<string>>, id: string, who: HealthItem) => map.set(id, (map.get(id) ?? new Set<string>()).add(itemKey(who)));
  for (const item of c.readable) {
    if (item.kind === "dashboard" || isTaxisItem(item)) continue;
    if (item.kind === "scene") {
      // A scene sets the states it lists.
      const entities = isObject(item.config) && isObject(item.config.entities) ? item.config.entities : {};
      for (const [id, v] of Object.entries(entities)) {
        if (!id.startsWith("input_boolean.")) continue;
        const state = typeof v === "string" ? v : isObject(v) && typeof v.state === "string" ? v.state : null;
        if (state !== "off") add(w.on, id, item);
        if (state !== "on") add(w.off, id, item);
      }
      continue;
    }
    // A blueprint's inputs: Taxis can't see what the blueprint does with them.
    const ub = isObject(item.config) ? item.config.use_blueprint : undefined;
    if (isObject(ub)) {
      for (const id of entityIdsIn(ub.input, c.domains)) {
        if (!id.startsWith("input_boolean.")) continue;
        add(w.on, id, item);
        add(w.off, id, item);
      }
    }
    for (const call of serviceCalls(item.config)) {
      const on = TURN_ON.has(call.service) || TOGGLE.has(call.service);
      const off = TURN_OFF.has(call.service) || TOGGLE.has(call.service);
      if (!on && !off) continue;
      if (call.dynamic) {
        if (on) w.dynamicOn = true;
        if (off) w.dynamicOff = true;
      }
      for (const id of reached(c, call, "input_boolean")) {
        if (on) add(w.on, id, item);
        if (off) add(w.off, id, item);
      }
    }
  }
  return w;
}

export const itemNames = (c: Ctx, keys: Iterable<string>): string[] =>
  [...keys]
    .map((k) => c.readable.find((i) => itemKey(i) === k))
    .filter((i): i is HealthItem => Boolean(i))
    .map(itemName)
    .sort();

// The service calls an item makes, and those of the scripts it calls (to depth 4).
export function callCollector(c: Ctx): (item: HealthItem, seen?: Set<string>, depth?: number) => ServiceCall[] {
  const scripts = new Map(c.readable.filter((i) => i.kind === "script" && i.entityId).map((i) => [i.entityId!, i]));
  const callsOf = (item: HealthItem, seen = new Set<string>(), depth = 0): ServiceCall[] => {
    if (seen.has(itemKey(item)) || depth > 4) return [];
    seen.add(itemKey(item));
    const own = serviceCalls(item.config);
    const called = own.flatMap((call) => {
      const ids = call.service === "script.turn_on" ? call.entityIds : call.service.startsWith("script.") ? [call.service] : [];
      return ids
        .map((id) => scripts.get(id))
        .filter((s): s is HealthItem => Boolean(s))
        .flatMap((s) => callsOf(s, seen, depth + 1));
    });
    return [...own, ...called];
  };
  return callsOf;
}

export const stringList = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
