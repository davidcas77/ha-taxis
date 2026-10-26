import { HOUSE_HELPER_IDS } from "./climate.ts";
import { canonicalId, effectiveSuffixes, HELPERS, helperExclusions, planHelpers } from "./helpers.ts";
import { deviceUses, emptyRange, ENTITY_DOMAINS, entityIdsIn, gatingConditions, serviceCalls, stateConditions, type ServiceCall } from "./health-scan.ts";
import { areaInventory, CAPABILITY_LABEL, type AreaInventory, type InventoryRow, type InventorySettings } from "./inventory.ts";
import { areaCodes, type NamingSettings } from "./naming.ts";
import type { ParameterSettings } from "./parameters.ts";
import { automationIdFor, planRecipes, RECIPE_LABEL, runtimeIds, type RecipeInstalled } from "./recipes.ts";
import type { Change, ChangeInput, EntityItem, Hierarchy, RefKind } from "./types.ts";

// Health: rule-based checks over what Taxis already reads, to find what is broken
// or has been forgotten. No AI. Pure functions: the server gathers a snapshot
// (the hierarchy, the stored configs of automations, scripts, scenes and
// dashboards, the live states) and this turns it into findings. Nothing here
// reads or writes Home Assistant, and a finding never changes anything: a fix is
// either a link to the place in Taxis that deals with it or a change (of a kind
// that already exists) for the user to add to the change list.

export const HEALTH_CHECKS = [
  { key: "references", label: "Missing references" },
  { key: "unavailable", label: "Not reporting" },
  { key: "activity", label: "Automation activity" },
  { key: "conditions", label: "Conditions" },
  { key: "switches", label: "One-way switches" },
  { key: "lights", label: "Competing automations" },
  { key: "climate", label: "Climate" },
  { key: "setup", label: "Taxis setup" },
  { key: "helpers", label: "Unused helpers" },
  { key: "devices", label: "Device-based" },
] as const;

export type HealthCheck = (typeof HEALTH_CHECKS)[number]["key"];
export const HEALTH_CHECK_LABEL = Object.fromEntries(HEALTH_CHECKS.map((c) => [c.key, c.label])) as Record<HealthCheck, string>;

export type Severity = "error" | "warning" | "info";
export const SEVERITIES: readonly Severity[] = ["error", "warning", "info"];
export const SEVERITY_LABEL: Record<Severity, string> = { error: "Error", warning: "Warning", info: "Info" };

export type HealthOptions = {
  // An entity has to have been unavailable or unknown this many hours to be reported.
  unavailableHours: number;
  // An enabled automation that has not fired for this many days is reported.
  staleDays: number;
};

export const DEFAULT_HEALTH_OPTIONS: HealthOptions = { unavailableHours: 24, staleDays: 30 };
export const HEALTH_LIMITS = { unavailableHours: { min: 1, max: 720 }, staleDays: { min: 1, max: 365 } } as const;

// A thermostat that Area climate controls is reported after this long (check "Climate").
export const THERMOSTAT_UNAVAILABLE_MINUTES = 10;

// A sensor an area counts on is reported after this long (check "Taxis setup"),
// which is sooner than the general check so a dead sensor shows up the same day.
export const SOURCE_UNAVAILABLE_HOURS = 1;

// ---------------------------------------------------------------------------
// The snapshot, and what comes out.
// ---------------------------------------------------------------------------

// An automation, script or scene made in the UI, or a dashboard, with its stored
// config. Null when there is none to read (written in YAML, or unreadable).
export type HealthItem = { kind: RefKind; id: string; entityId: string | null; name: string; config: unknown | null; yaml: boolean };

// What the live states say, by entity id.
export type HealthState = { state: string; lastChanged: string | null; lastTriggered: string | null; restored: boolean };

export type HealthSnapshot = {
  hierarchy: Hierarchy;
  states: Record<string, HealthState>;
  items: HealthItem[];
  // What Home Assistant holds of the recipes (their blueprints and automations).
  // Null when it could not be read: the checks that need it are skipped.
  installed: RecipeInstalled | null;
  // Things the server could not read, in words.
  notes: string[];
};

export type HealthInput = {
  snapshot: HealthSnapshot;
  inventory: InventorySettings;
  naming: NamingSettings;
  parameters: ParameterSettings;
  // The change list: a fix already in it is not offered again.
  changes: readonly Change[];
  // Milliseconds since the epoch. Passed in so a test can fix the clock.
  now: number;
  options?: Partial<HealthOptions>;
};

// Where Taxis can take the user to deal with a finding.
export type HealthTarget =
  | { page: "area"; areaId: string; tab: "overview" | "capabilities" | "entities" | "health" }
  | { page: "parameters"; tab: "capabilities" | "helpers" | "recipes" }
  | { page: "settings" };

export type HealthFix = { kind: "changes"; label: string; inputs: ChangeInput[] } | { kind: "link"; label: string; to: HealthTarget };

export type HealthFinding = {
  // The same problem has the same id on the next run.
  id: string;
  check: HealthCheck;
  severity: Severity;
  // The area it is about, when it is about something in one.
  area?: string;
  entity?: string;
  // Every entity it is about, when there are several (entity is the first).
  entities?: string[];
  // The automation, script, scene or dashboard it is about.
  item?: { kind: RefKind; id: string; name: string; entityId: string | null };
  title: string;
  detail: string;
  fix?: HealthFix;
};

export type HealthReport = {
  generatedAt: string;
  readAt: string;
  options: HealthOptions;
  findings: HealthFinding[];
  counts: Record<Severity, number>;
  byCheck: Record<HealthCheck, number>;
  checked: { entities: number; automations: number; scripts: number; scenes: number; dashboards: number; unreadable: number };
  notes: string[];
};

export type HealthReportResponse = { ok: true; report: HealthReport; cached: boolean } | { ok: false; error: string };

// ---------------------------------------------------------------------------
// Small helpers.
// ---------------------------------------------------------------------------

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const RANK: Record<Severity, number> = { error: 0, warning: 1, info: 2 };
const KIND_LABEL: Record<RefKind, string> = { automation: "Automation", script: "Script", scene: "Scene", dashboard: "Dashboard" };

const isObject = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === "object" && !Array.isArray(v);
const itemKey = (i: Pick<HealthItem, "kind" | "id">) => `${i.kind}:${i.id}`;
const itemName = (i: HealthItem) => `${KIND_LABEL[i.kind]} “${i.name}”`;
const asItem = (i: HealthItem): NonNullable<HealthFinding["item"]> => ({ kind: i.kind, id: i.id, name: i.name, entityId: i.entityId });
const bump = (s: Severity): Severity => (s === "info" ? "warning" : "error");
const timeOf = (iso: string | null | undefined): number | null => {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
};
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// "2 hours", "3 days".
export function ageText(ms: number): string {
  if (ms < HOUR) return plural(Math.max(1, Math.round(ms / 60_000)), "minute");
  if (ms < DAY) return plural(Math.round(ms / HOUR), "hour");
  return plural(Math.round(ms / DAY), "day");
}

// "a, b and 2 more".
function names(list: readonly string[], max = 6): string {
  if (list.length <= max) return list.length > 1 ? `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}` : list.join("");
  return `${list.slice(0, max).join(", ")} and ${list.length - max} more`;
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

export function healthOptions(o?: Partial<HealthOptions>): HealthOptions {
  const pick = (v: number | undefined, fallback: number, min: number, max: number) => (typeof v === "number" && Number.isFinite(v) ? clamp(Math.round(v), min, max) : fallback);
  return {
    unavailableHours: pick(o?.unavailableHours, DEFAULT_HEALTH_OPTIONS.unavailableHours, HEALTH_LIMITS.unavailableHours.min, HEALTH_LIMITS.unavailableHours.max),
    staleDays: pick(o?.staleDays, DEFAULT_HEALTH_OPTIONS.staleDays, HEALTH_LIMITS.staleDays.min, HEALTH_LIMITS.staleDays.max),
  };
}

// ---------------------------------------------------------------------------
// What the checks share.
// ---------------------------------------------------------------------------

type Ctx = {
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

const isTaxisItem = (i: HealthItem): boolean => {
  if (i.kind !== "automation" || !i.id.startsWith("taxis_") || !isObject(i.config)) return false;
  const ub = i.config.use_blueprint;
  return isObject(ub) && typeof ub.path === "string" && ub.path.startsWith("taxis/");
};

const enabled = (c: Ctx, i: HealthItem) => i.kind !== "automation" || c.stateOf(i.entityId ?? "") !== "off";
const areaOf = (c: Ctx, entityId: string | null | undefined): string | undefined => (entityId ? c.h.entities[entityId]?.areaId ?? undefined : undefined);
const nameOf = (c: Ctx, id: string) => c.h.entities[id]?.name ?? id;
const unreadableNote = (c: Ctx) => (c.unreadable.length === 0 ? "" : ` Taxis could not read ${plural(c.unreadable.length, "automation, script or scene")} (written in YAML, or unreadable), and any of them may do this.`);

function context(input: HealthInput): Ctx {
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
    stateOf: (id) => (Object.hasOwn(snapshot.states, id) ? snapshot.states[id].state : h.entities[id]?.state ?? undefined),
  };
}

// An area's inventory, with its own canonical helpers left out as everywhere else.
function inventoryOf(c: Ctx, areaId: string): AreaInventory {
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

const TURN_ON = new Set(["input_boolean.turn_on", "homeassistant.turn_on"]);
const TURN_OFF = new Set(["input_boolean.turn_off", "homeassistant.turn_off"]);
const TOGGLE = new Set(["input_boolean.toggle", "homeassistant.toggle"]);

// The entities of one domain a service call reaches: the ones it names, and the
// ones in the areas, floors, labels and devices it names.
function reached(c: Ctx, call: ServiceCall, domain: string): string[] {
  const out = new Set<string>(call.entityIds);
  for (const a of call.areaIds) for (const id of c.h.areas[a]?.entityIds ?? []) out.add(id);
  for (const f of call.floorIds) for (const a of c.h.floors.find((x) => x.id === f)?.areaIds ?? []) for (const id of c.h.areas[a]?.entityIds ?? []) out.add(id);
  for (const l of call.labelIds) for (const e of Object.values(c.h.entities)) if (e.labels.includes(l)) out.add(e.entityId);
  for (const d of call.deviceIds) for (const id of c.h.devices[d]?.entityIds ?? []) out.add(id);
  return [...out].filter((id) => id.startsWith(`${domain}.`));
}

type Writers = { on: Map<string, Set<string>>; off: Map<string, Set<string>>; dynamicOn: boolean; dynamicOff: boolean };

function writers(c: Ctx): Writers {
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

const itemNames = (c: Ctx, keys: Iterable<string>): string[] =>
  [...keys].map((k) => c.readable.find((i) => itemKey(i) === k)).filter((i): i is HealthItem => Boolean(i)).map(itemName).sort();

// ---------------------------------------------------------------------------
// 1 and 4: references to entities that do not exist, and conditions that can
// never pass.
// ---------------------------------------------------------------------------

function referenceChecks(c: Ctx, w: Writers): HealthFinding[] {
  const out: HealthFinding[] = [];
  for (const item of c.readable) {
    // The recipes' own automations are checked with the recipes (Taxis setup).
    if (isTaxisItem(item)) continue;
    const key = itemKey(item);
    const area = areaOf(c, item.entityId);
    const live = enabled(c, item);

    // 4: conditions that gate the whole run and can never be true.
    const dead = new Set<string>();
    const why: string[] = [];
    if (item.kind === "automation" || item.kind === "script") {
      for (const cond of gatingConditions(item.config, c.domains)) {
        const gone = [...cond.entityIds, ...cond.limitIds].filter((id) => !c.exists(id));
        for (const id of gone) {
          dead.add(id);
          why.push(`The ${cond.condition === "state" ? "state" : "numeric"} condition uses ${id}, which does not exist, so it is always false.`);
        }
        const range = emptyRange(cond);
        if (range) why.push(`A numeric condition needs a value above ${range.above} and below ${range.below}, which no value is.`);
      }
      if (why.length > 0) {
        out.push({
          id: `conditions:${key}:never`,
          check: "conditions",
          severity: live ? "error" : "warning",
          area,
          entity: [...dead][0],
          entities: dead.size > 0 ? [...dead].sort() : undefined,
          item: asItem(item),
          title: `${itemName(item)} has a condition that can never pass`,
          detail: `${why.join(" ")} ${item.kind === "automation" ? "It never gets as far as its actions." : "The script stops at that step."}`,
        });
      }
    }

    // 1: everything else it uses that is not there.
    const missing = [...(c.refs.get(key) ?? [])].filter((id) => !c.exists(id) && !dead.has(id)).sort();
    if (missing.length > 0) {
      out.push({
        id: `references:${key}`,
        check: "references",
        severity: (item.kind === "automation" || item.kind === "script") && live ? "error" : "warning",
        area,
        entity: missing[0],
        entities: missing,
        item: asItem(item),
        title: `${itemName(item)} uses ${plural(missing.length, "entity", "entities")} that ${missing.length === 1 ? "does" : "do"} not exist`,
        detail: `Not in Home Assistant: ${missing.join(", ")}. ${
          item.kind === "dashboard" ? "The card shows an error." : item.kind === "scene" ? "The scene skips them." : "Whatever depends on them cannot work."
        } Pick the entity it should use now, or take it out.`,
      });
    }

    // 4: a state condition on a switch nothing changes.
    if (item.kind === "automation" || item.kind === "script") {
      const byHand = new Set<string>();
      for (const cond of stateConditions(item.config, c.domains)) {
        for (const id of cond.entityIds) {
          if (!id.startsWith("input_boolean.") || !c.exists(id) || c.taxisIds.has(id) || w.on.has(id) || w.off.has(id) || w.dynamicOn || w.dynamicOff) continue;
          byHand.add(id);
        }
      }
      if (byHand.size > 0) {
        const ids = [...byHand].sort();
        out.push({
          id: `conditions:${key}:by-hand`,
          check: "conditions",
          severity: "info",
          area,
          entity: ids[0],
          entities: ids,
          item: asItem(item),
          title: `${itemName(item)} tests a switch only a person changes`,
          detail: `${names(ids.map((id) => nameOf(c, id)))} ${ids.length === 1 ? "is" : "are"} never turned on or off by any automation, script or scene Taxis can read, so ${ids.length === 1 ? "it" : "they"} can only be changed by hand (a dashboard, a voice command, Home Assistant).${unreadableNote(c)}`,
        });
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// 2: entities that have not reported for a long time.
// ---------------------------------------------------------------------------

// Entities whose state is often unknown without anything being wrong.
const QUIET_DOMAINS = new Set(["button", "input_button", "event", "scene", "tts", "stt", "notify", "wake_word", "conversation", "ai_task"]);

type Out = { entity: EntityItem; since: number; ms: number };

function unavailableChecks(c: Ctx): HealthFinding[] {
  const threshold = c.opts.unavailableHours * HOUR;
  const groups = new Map<string, { label: string; areaId: string | null; out: Out[] }>();
  for (const e of Object.values(c.h.entities)) {
    if (e.disabled || QUIET_DOMAINS.has(e.domain)) continue;
    const state = c.stateOf(e.entityId);
    if (state !== "unavailable" && state !== "unknown") continue;
    const since = timeOf(c.states[e.entityId]?.lastChanged);
    if (since === null || c.now - since < threshold) continue;
    const device = e.deviceId ? c.h.devices[e.deviceId] : undefined;
    if (device?.disabled) continue;
    const key = device ? `device:${device.id}` : `entity:${e.entityId}`;
    const g = groups.get(key) ?? { label: device ? device.name : e.name, areaId: device?.areaId ?? e.areaId, out: [] };
    g.out.push({ entity: e, since, ms: c.now - since });
    groups.set(key, g);
  }

  const out: HealthFinding[] = [];
  for (const [key, g] of groups) {
    g.out.sort((a, b) => a.entity.name.localeCompare(b.entity.name) || a.entity.entityId.localeCompare(b.entity.entityId));
    const ids = g.out.map((o) => o.entity.entityId);
    const gone = g.out.some((o) => c.stateOf(o.entity.entityId) === "unavailable");
    // Used by something that runs: one level up.
    const users = new Map<string, HealthItem>();
    for (const id of ids) for (const i of c.usedBy.get(id) ?? []) if (i.kind !== "dashboard") users.set(itemKey(i), i);
    const dashboards = new Set<string>();
    for (const id of ids) for (const i of c.usedBy.get(id) ?? []) if (i.kind === "dashboard") dashboards.add(itemName(i));
    const base: Severity = gone ? "warning" : "info";
    const severity = users.size > 0 ? bump(base) : base;
    const shortest = Math.min(...g.out.map((o) => o.ms));

    const lines = g.out.map((o) => {
      const counted = countedAs(c, o.entity);
      return `${o.entity.name} (${o.entity.entityId}) has been ${c.stateOf(o.entity.entityId)} for ${ageText(o.ms)}${c.states[o.entity.entityId]?.restored ? ", and its integration no longer provides it" : ""}${counted ? `; counts as ${counted}` : ""}`;
    });
    const usedLine = users.size > 0 ? ` Used by ${names([...users.values()].map(itemName).sort())}.` : "";
    const dashLine = dashboards.size > 0 ? ` On ${names([...dashboards].sort())}.` : "";
    out.push({
      id: `unavailable:${key}`,
      check: "unavailable",
      severity,
      area: g.areaId ?? undefined,
      entity: ids[0],
      entities: ids,
      title: `${g.label} has not reported for ${ageText(shortest)}`,
      detail: `${lines.join(". ")}.${usedLine}${dashLine}`,
    });
  }
  return out;
}

// "a Motion sensor in the Hallway", for an entity an area counts.
function countedAs(c: Ctx, e: EntityItem): string | null {
  if (!e.areaId) return null;
  const inv = inventoryOf(c, e.areaId);
  for (const cap of Object.keys(inv) as (keyof AreaInventory)[]) {
    if (inv[cap].some((r) => r.entityId === e.entityId && r.counts)) return `${CAPABILITY_LABEL[cap].toLowerCase()} in ${c.h.areas[e.areaId]?.name ?? e.areaId}`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// 3: automations that are off, never fired, or have not fired for a while.
// ---------------------------------------------------------------------------

function activityChecks(c: Ctx): HealthFinding[] {
  const out: HealthFinding[] = [];
  const limit = c.opts.staleDays * DAY;
  for (const e of Object.values(c.h.entities)) {
    if (e.domain !== "automation" || e.disabled) continue;
    const st = c.states[e.entityId];
    if (!st) continue;
    const item = c.byEntity.get(e.entityId);
    const ref = item ? asItem(item) : { kind: "automation" as const, id: e.entityId, name: e.name, entityId: e.entityId };
    const base = { check: "activity" as const, area: e.areaId ?? undefined, entity: e.entityId, item: ref };
    if (st.state === "off") {
      out.push({ ...base, id: `activity:${e.entityId}:off`, severity: "info", title: `Automation “${e.name}” is turned off`, detail: "It does nothing while it is off. Turn it on in Home Assistant, or delete it if it is no longer needed." });
    } else if (st.state === "on") {
      const last = timeOf(st.lastTriggered);
      if (last === null) {
        out.push({
          ...base,
          id: `activity:${e.entityId}:never`,
          severity: "info",
          title: `Automation “${e.name}” has never fired`,
          detail: "Home Assistant has no record of it running. It may be new, or what triggers it may never happen (a sensor that is gone, a condition that is never met).",
        });
      } else if (c.now - last > limit) {
        out.push({
          ...base,
          id: `activity:${e.entityId}:stale`,
          severity: "warning",
          title: `Automation “${e.name}” has not fired for ${ageText(c.now - last)}`,
          detail: `It last ran on ${new Date(last).toISOString().slice(0, 10)}. Anything not seen for ${plural(c.opts.staleDays, "day")} is listed.`,
        });
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// 5: switches only ever turned one way.
// ---------------------------------------------------------------------------

function switchChecks(c: Ctx, w: Writers): HealthFinding[] {
  const out: HealthFinding[] = [];
  for (const e of Object.values(c.h.entities)) {
    if (e.domain !== "input_boolean" || e.disabled || c.taxisIds.has(e.entityId)) continue;
    const on = w.on.get(e.entityId);
    const off = w.off.get(e.entityId);
    const [turned, other, dynamic] = on && !off ? ["on", "off", w.dynamicOff] as const : off && !on ? ["off", "on", w.dynamicOn] as const : [null, null, false] as const;
    if (!turned || dynamic) continue;
    const by = itemNames(c, (turned === "on" ? on : off)!);
    out.push({
      id: `switches:${e.entityId}:${turned}-only`,
      check: "switches",
      severity: "warning",
      area: e.areaId ?? undefined,
      entity: e.entityId,
      title: `${e.name} is turned ${turned} but never ${other}`,
      detail: `Turned ${turned} by ${names(by)}. Nothing Taxis can read turns it ${other}, so once it is ${turned} it stays ${turned} until someone changes it by hand.${unreadableNote(c)}`,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// 6: several automations switching the same lights.
// ---------------------------------------------------------------------------

const LIGHT_SERVICES = new Set(["light.turn_on", "light.turn_off", "light.toggle", "homeassistant.turn_on", "homeassistant.turn_off", "homeassistant.toggle"]);

// The lights a light entity stands for: itself, and the members if it is a group.
function lightsBehind(c: Ctx, id: string, seen = new Set<string>()): string[] {
  if (seen.has(id)) return [];
  seen.add(id);
  const e = c.h.entities[id];
  return [id, ...(e?.members ?? []).filter((m) => m.startsWith("light.")).flatMap((m) => lightsBehind(c, m, seen))];
}

// The service calls an item makes, and those of the scripts it calls (to depth 4).
function callCollector(c: Ctx): (item: HealthItem, seen?: Set<string>, depth?: number) => ServiceCall[] {
  const scripts = new Map(c.readable.filter((i) => i.kind === "script" && i.entityId).map((i) => [i.entityId!, i]));
  const callsOf = (item: HealthItem, seen = new Set<string>(), depth = 0): ServiceCall[] => {
    if (seen.has(itemKey(item)) || depth > 4) return [];
    seen.add(itemKey(item));
    const own = serviceCalls(item.config);
    const called = own.flatMap((call) => {
      const ids = call.service === "script.turn_on" ? call.entityIds : call.service.startsWith("script.") ? [call.service] : [];
      return ids.map((id) => scripts.get(id)).filter((s): s is HealthItem => Boolean(s)).flatMap((s) => callsOf(s, seen, depth + 1));
    });
    return [...own, ...called];
  };
  return callsOf;
}

function lightChecks(c: Ctx): HealthFinding[] {
  const callsOf = callCollector(c);

  const controllers = new Map<string, Set<string>>();
  const automations = c.readable.filter((i) => i.kind === "automation" && enabled(c, i));
  for (const item of automations) {
    const key = itemKey(item);
    const lights = new Set<string>();
    if (isTaxisItem(item)) {
      // The recipes' automations take their lights as blueprint inputs.
      const input = isObject(item.config) && isObject(item.config.use_blueprint) ? item.config.use_blueprint.input : undefined;
      if (isObject(input)) {
        for (const k of ["light_target", "main_lights", "accent_lights", "night_lights"]) {
          for (const id of entityIdsIn(input[k], c.domains)) if (id.startsWith("light.")) for (const l of lightsBehind(c, id)) lights.add(l);
        }
      }
    } else {
      for (const call of callsOf(item)) {
        if (!LIGHT_SERVICES.has(call.service)) continue;
        for (const id of reached(c, call, "light")) for (const l of lightsBehind(c, id)) lights.add(l);
      }
    }
    for (const l of lights) controllers.set(l, (controllers.get(l) ?? new Set<string>()).add(key));
  }

  // Lights with the same controllers are one finding.
  const groups = new Map<string, { controllers: string[]; lights: string[] }>();
  for (const [light, who] of controllers) {
    if (who.size < 2) continue;
    const list = [...who].sort();
    const g = groups.get(list.join("+")) ?? { controllers: list, lights: [] };
    g.lights.push(light);
    groups.set(list.join("+"), g);
  }

  const out: HealthFinding[] = [];
  for (const [key, g] of groups) {
    const lights = g.lights.sort((a, b) => nameOf(c, a).localeCompare(nameOf(c, b)) || a.localeCompare(b));
    // The group first: it names what the controllers have in common best.
    const lead = lights.find((id) => (c.h.entities[id]?.members.length ?? 0) > 0) ?? lights[0];
    const items = g.controllers.map((k) => c.readable.find((i) => itemKey(i) === k)!);
    const areas = new Set(lights.map((id) => areaOf(c, id) ?? ""));
    const label = (i: HealthItem) => `${i.name}${isTaxisItem(i) ? " (Taxis recipe)" : ""}`;
    out.push({
      id: `lights:${key}`,
      check: "lights",
      severity: "warning",
      area: areas.size === 1 && [...areas][0] ? [...areas][0] : undefined,
      entity: lead,
      entities: lights,
      item: asItem(items[0]),
      title: `${items.length} automations switch ${nameOf(c, lead)}${lights.length > 1 ? ` and ${plural(lights.length - 1, "other light")}` : ""}`,
      detail: `${names(items.map(label))} ${items.length === 2 ? "both" : "all"} turn the same lights on or off: ${names(lights.map((id) => nameOf(c, id)))}. They can undo each other. Scripts they call count. Keep one automation in charge of these lights, or make the others wait for it.`,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// 6b: the thermostats Area climate controls.
// ---------------------------------------------------------------------------

const CLIMATE_SERVICES = new Set([
  "climate.set_temperature",
  "climate.set_hvac_mode",
  "climate.set_preset_mode",
  "climate.turn_on",
  "climate.turn_off",
  "climate.toggle",
  "homeassistant.turn_on",
  "homeassistant.turn_off",
  "homeassistant.toggle",
]);

const stringList = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

function climateChecks(c: Ctx): HealthFinding[] {
  const out: HealthFinding[] = [];
  const areaName = (id: string) => c.h.areas[id]?.name ?? id;

  for (const [areaId, input] of c.climateAreas) {
    // A thermostat that has stopped answering: the area keeps whatever it was last set to.
    const down: { id: string; ms: number | null }[] = [];
    for (const id of stringList(input.climate_entities)) {
      const s = c.states[id];
      if (s && (s.state === "unavailable" || s.state === "unknown")) {
        const t = timeOf(s.lastChanged);
        const ms = t === null ? null : c.now - t;
        if (ms === null || ms >= THERMOSTAT_UNAVAILABLE_MINUTES * 60_000) down.push({ id, ms });
      }
    }
    if (down.length > 0) {
      out.push({
        id: `climate:thermostat:${areaId}`,
        check: "climate",
        severity: "warning",
        area: areaId,
        entity: down[0].id,
        entities: down.map((d) => d.id),
        title: `${areaName(areaId)} has ${plural(down.length, "thermostat")} that ${down.length === 1 ? "is" : "are"} not answering`,
        detail: `${down.map((d) => `${nameOf(c, d.id)}${d.ms === null ? "" : ` for ${ageText(d.ms)}`}`).join(", ")}. Area climate cannot set ${down.length === 1 ? "it" : "them"} meanwhile, and ${down.length === 1 ? "it keeps" : "they keep"} the last setpoint. Check the batteries, the hub or the integration.`,
        fix: { kind: "link", label: "Open the area's Capabilities", to: { page: "area", areaId, tab: "capabilities" } },
      });
    }

    // No temperature reference: a thermostat is switched on again without looking at the room.
    if (typeof input.temperature_entity !== "string" || input.temperature_entity === "") {
      out.push({
        id: `climate:reference:${areaId}`,
        check: "climate",
        severity: input.auto_hvac_on === true ? "warning" : "info",
        area: areaId,
        title: `${areaName(areaId)} has Area climate but no temperature reference`,
        detail: `The area has no temperature helper, so ${
          input.auto_hvac_on === true ? "a thermostat that is off is switched on again without checking whether the room needs it" : "nothing can tell Area climate how warm the room is, and a thermostat that takes an outside sensor has none to take"
        }. The helper averages the area's temperature sensors; make it on the Helpers tab.`,
        fix: { kind: "link", label: "Open Helpers", to: { page: "parameters", tab: "helpers" } },
      });
    }
  }

  // Other automations that set the same thermostats. Only where Area climate is one
  // of the controllers: its target is worked out again at every change and would be
  // undone by, or would undo, theirs.
  const callsOf = callCollector(c);
  const controllers = new Map<string, Set<string>>();
  const taxis = new Set<string>();
  for (const item of c.readable.filter((i) => i.kind === "automation" && enabled(c, i))) {
    const key = itemKey(item);
    const set = new Set<string>();
    const area = [...c.climateAreas.keys()].find((a) => item.id === automationIdFor("area_climate", c.codes[a].code));
    if (area !== undefined) {
      for (const id of stringList(c.climateAreas.get(area)!.climate_entities)) set.add(id);
      taxis.add(key);
    } else if (!isTaxisItem(item)) {
      for (const call of callsOf(item)) if (CLIMATE_SERVICES.has(call.service)) for (const id of reached(c, call, "climate")) set.add(id);
    }
    for (const id of set) controllers.set(id, (controllers.get(id) ?? new Set<string>()).add(key));
  }
  const groups = new Map<string, { controllers: string[]; thermostats: string[] }>();
  for (const [id, who] of controllers) {
    if (who.size < 2 || ![...who].some((k) => taxis.has(k))) continue;
    const list = [...who].sort();
    const g = groups.get(list.join("+")) ?? { controllers: list, thermostats: [] };
    g.thermostats.push(id);
    groups.set(list.join("+"), g);
  }
  for (const [key, g] of groups) {
    const thermostats = g.thermostats.sort((a, b) => nameOf(c, a).localeCompare(nameOf(c, b)) || a.localeCompare(b));
    const items = g.controllers.map((k) => c.readable.find((i) => itemKey(i) === k)!);
    const areas = new Set(thermostats.map((id) => areaOf(c, id) ?? ""));
    const label = (i: HealthItem) => `${i.name}${taxis.has(itemKey(i)) ? " (Taxis recipe)" : ""}`;
    out.push({
      id: `climate:competing:${key}`,
      check: "climate",
      severity: "warning",
      area: areas.size === 1 && [...areas][0] ? [...areas][0] : undefined,
      entity: thermostats[0],
      entities: thermostats,
      item: asItem(items[0]),
      title: `${items.length} automations set ${nameOf(c, thermostats[0])}${thermostats.length > 1 ? ` and ${plural(thermostats.length - 1, "other thermostat")}` : ""}`,
      detail: `${names(items.map(label))} ${items.length === 2 ? "both" : "all"} set the same thermostats: ${names(thermostats.map((id) => nameOf(c, id)))}. Area climate works out the target again at every change of the area, so they can undo each other. Scripts they call count. Keep one automation in charge of these thermostats.`,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// 7: the Taxis model.
// ---------------------------------------------------------------------------

function setupChecks(c: Ctx, installed: RecipeInstalled | null): HealthFinding[] {
  const out: HealthFinding[] = [];
  const areaName = (id: string) => c.h.areas[id]?.name ?? id;

  // Recipes whose installed automation no longer matches what Taxis would write.
  if (installed) {
    const cells = planRecipes(c.h, c.inventory, c.naming, c.parameters, installed, c.changes);
    for (const cell of cells) {
      if (cell.status === "out-of-date") {
        out.push({
          id: `setup:recipe:${cell.areaId}:${cell.recipe}`,
          check: "setup",
          severity: "warning",
          area: cell.areaId,
          title: `${areaName(cell.areaId)}: ${RECIPE_LABEL[cell.recipe]} is out of date`,
          detail: `${cell.reasons.join(". ")}.`,
          fix: cell.actionable
            ? { kind: "changes", label: "Update the recipe", inputs: cell.inputs }
            : { kind: "link", label: "Open Recipes", to: { page: "parameters", tab: "recipes" } },
        });
      }
      // Lights that nothing is in charge of.
      if (cell.recipe === "occupancy" && (cell.status === "ready" || cell.status === "missing")) {
        const lights = inventoryOf(c, cell.areaId).lights.filter((r) => r.counts);
        if (lights.length > 0) {
          out.push({
            id: `setup:occupancy:${cell.areaId}`,
            check: "setup",
            severity: "info",
            area: cell.areaId,
            entities: lights.map((r) => r.entityId),
            entity: lights[0].entityId,
            title: `${areaName(cell.areaId)} has lights but no Occupancy`,
            detail:
              cell.status === "ready"
                ? `${plural(lights.length, "light")} ${lights.length === 1 ? "counts" : "count"} here, and nothing tells the area when it is occupied. The Occupancy recipe can be installed.`
                : `${plural(lights.length, "light")} ${lights.length === 1 ? "counts" : "count"} here, and the area cannot be occupied yet. Missing: ${cell.missing.join("; ")}.`,
            fix:
              cell.status === "ready" && cell.actionable
                ? { kind: "changes", label: "Add Occupancy to changes", inputs: cell.inputs }
                : { kind: "link", label: "Open the area's Capabilities", to: { page: "area", areaId: cell.areaId, tab: "capabilities" } },
          });
        }
      }
    }
  }

  // Canonical helpers that something else is sitting on.
  for (const row of planHelpers(c.h, c.inventory, c.naming)) {
    if (row.status !== "conflict") continue;
    const spec = HELPERS.find((s) => s.key === row.key)!;
    out.push({
      id: `setup:helper:${row.areaId}:${row.key}`,
      check: "setup",
      severity: "warning",
      area: row.areaId,
      entity: row.canonicalId,
      title: `${row.canonicalId} cannot be the ${areaName(row.areaId)} ${spec.label.toLowerCase()} helper`,
      detail:
        row.conflict === "not-editable"
          ? `It is a group set up in YAML whose members differ from the ${spec.label.toLowerCase()} that count in ${areaName(row.areaId)}, and Taxis can only change a group made in the UI. Edit the file, or pick another name.`
          : `The id is used by “${row.heldByName}”, which is not a ${spec.helper === "group" ? "group" : "min/max"} helper, so Taxis cannot make the helper there. Pick another name for it in Settings.`,
      fix: { kind: "link", label: "Change the helper names", to: { page: "settings" } },
    });
  }

  for (const area of Object.values(c.h.areas)) {
    const code = c.codes[area.id].code;
    // Counted sensors that stopped reporting, sooner than the general check.
    const since = Math.min(SOURCE_UNAVAILABLE_HOURS, c.opts.unavailableHours) * HOUR;
    const upTo = c.opts.unavailableHours * HOUR;
    const down: { row: InventoryRow; ms: number }[] = [];
    const inv = inventoryOf(c, area.id);
    for (const cap of Object.keys(inv) as (keyof AreaInventory)[]) {
      // Area climate reports its own thermostats (check "Climate").
      if (cap === "thermostat" && c.climateAreas.has(area.id)) continue;
      for (const row of inv[cap]) {
        if (!row.counts || !row.flags.includes("unavailable")) continue;
        const t = timeOf(c.states[row.entityId]?.lastChanged);
        if (t === null) continue;
        const ms = c.now - t;
        if (ms >= since && ms < upTo) down.push({ row, ms });
      }
    }
    if (down.length > 0) {
      out.push({
        id: `setup:sources:${area.id}`,
        check: "setup",
        severity: "warning",
        area: area.id,
        entities: down.map((d) => d.row.entityId),
        entity: down[0].row.entityId,
        title: `${area.name} counts on ${plural(down.length, "sensor")} that ${down.length === 1 ? "is" : "are"} not reporting`,
        detail: `${down.map((d) => `${d.row.name} (${CAPABILITY_LABEL[d.row.capability].toLowerCase()}) for ${ageText(d.ms)}`).join(", ")}. The area's recipes cannot see ${down.length === 1 ? "it" : "them"} meanwhile. Entities out for ${plural(c.opts.unavailableHours, "hour")} or more are listed under Not reporting.`,
        fix: { kind: "link", label: "Open the area's Capabilities", to: { page: "area", areaId: area.id, tab: "capabilities" } },
      });
    }

    // The area's own temperature and humidity setting.
    for (const [field, id, spec] of [
      ["temperature_entity_id", area.temperatureEntityId, "temperature"],
      ["humidity_entity_id", area.humidityEntityId, "humidity"],
    ] as const) {
      if (!id || c.exists(id)) continue;
      if (c.changes.some((ch) => ch.kind === "area" && ch.targetId === area.id && field in ch.after)) continue;
      const canonical = canonicalId("sensor", code, c.suffix[spec]);
      const better = c.h.entities[canonical]?.platform === "min_max" ? canonical : null;
      out.push({
        id: `setup:area-sensor:${area.id}:${spec}`,
        check: "setup",
        severity: "warning",
        area: area.id,
        entity: id,
        title: `${area.name}'s ${spec} sensor does not exist`,
        detail: `The area is set to use ${id} for its ${spec}, and Home Assistant has no such entity. ${better ? `${better} is this area's ${spec} helper.` : "Clear the setting or pick a sensor."}`,
        fix: { kind: "changes", label: better ? `Use ${better}` : "Clear the setting", inputs: [{ kind: "area", op: "update", targetId: area.id, fields: { [field]: better } }] },
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// 8: helpers nothing uses.
// ---------------------------------------------------------------------------

const HELPER_DOMAINS = new Set(["input_boolean", "input_number", "input_select", "input_text", "input_datetime", "input_button", "counter", "timer", "schedule"]);
const HELPER_PLATFORMS = new Set(["template", "group", "min_max", "threshold", "derivative", "statistics", "bayesian", "trend", "filter", "utility_meter", "integration", "history_stats"]);

function helperChecks(c: Ctx): HealthFinding[] {
  // Everything that points at an entity: configs, the members of groups, and the
  // temperature and humidity sensors the areas use.
  const used = new Set<string>();
  for (const ids of c.refs.values()) for (const id of ids) used.add(id);
  for (const e of Object.values(c.h.entities)) for (const m of e.members) used.add(m);
  for (const a of Object.values(c.h.areas)) for (const id of [a.temperatureEntityId, a.humidityEntityId]) if (id) used.add(id);

  const out: HealthFinding[] = [];
  for (const e of Object.values(c.h.entities)) {
    const helper = HELPER_DOMAINS.has(e.domain) || (e.configEntryId !== null && HELPER_PLATFORMS.has(e.platform));
    if (!helper || e.disabled || used.has(e.entityId) || c.taxisIds.has(e.entityId)) continue;
    out.push({
      id: `helpers:${e.entityId}`,
      check: "helpers",
      severity: "info",
      area: e.areaId ?? undefined,
      entity: e.entityId,
      title: `${e.name} is not used by anything Taxis can read`,
      detail: `No automation, script, scene, dashboard or group uses ${e.entityId}. A template or a YAML package that Taxis cannot read may still use it, so check before removing it.${unreadableNote(c)}`,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// 9: device-based triggers, conditions and actions.
// ---------------------------------------------------------------------------

function deviceChecks(c: Ctx): HealthFinding[] {
  const out: HealthFinding[] = [];
  for (const item of c.readable) {
    if (item.kind !== "automation" && item.kind !== "script") continue;
    const uses = deviceUses(item.config);
    if (uses.length === 0) continue;
    const ids = [...new Set(uses.map((u) => u.deviceId))].sort();
    const gone = ids.filter((id) => !c.h.devices[id]);
    const sections = (["triggers", "conditions", "actions"] as const)
      .map((s) => ({ s, n: uses.filter((u) => u.section === s).length }))
      .filter((x) => x.n > 0)
      .map((x) => `${plural(x.n, x.s.slice(0, -1))} in ${x.s}`);
    const devices = ids.map((id) => c.h.devices[id]?.name ?? `${id} (not in Home Assistant)`);
    out.push({
      id: `devices:${itemKey(item)}`,
      check: "devices",
      severity: gone.length > 0 ? "warning" : "info",
      area: areaOf(c, item.entityId),
      item: asItem(item),
      title: `${itemName(item)} is tied to ${plural(ids.length, "device")} by id`,
      detail: `${sections.join(", ")}: ${names(devices)}. ${
        gone.length > 0 ? "Some of these devices are not in Home Assistant any more. " : ""
      }A device id changes when the device is removed and added again, and the automation stops working. Entity-based triggers and actions survive that.`,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Everything.
// ---------------------------------------------------------------------------

const CHECK_ORDER = HEALTH_CHECKS.map((x) => x.key) as readonly HealthCheck[];

export function runHealth(input: HealthInput): HealthReport {
  const c = context(input);
  const w = writers(c);
  const findings = [
    ...referenceChecks(c, w),
    ...unavailableChecks(c),
    ...activityChecks(c),
    ...switchChecks(c, w),
    ...lightChecks(c),
    ...climateChecks(c),
    ...setupChecks(c, input.snapshot.installed),
    ...helperChecks(c),
    ...deviceChecks(c),
  ].sort((a, b) => RANK[a.severity] - RANK[b.severity] || CHECK_ORDER.indexOf(a.check) - CHECK_ORDER.indexOf(b.check) || a.title.localeCompare(b.title) || a.id.localeCompare(b.id));

  const counts: Record<Severity, number> = { error: 0, warning: 0, info: 0 };
  const byCheck = Object.fromEntries(HEALTH_CHECKS.map((x) => [x.key, 0])) as Record<HealthCheck, number>;
  for (const f of findings) {
    counts[f.severity] += 1;
    byCheck[f.check] += 1;
  }

  const notes = [...input.snapshot.notes];
  if (!input.snapshot.installed) notes.push("Taxis could not read the recipes' blueprints, so the recipe checks were skipped.");
  const yaml = c.unreadable.length;
  if (yaml > 0) notes.push(`${plural(yaml, "automation, script or scene")} could not be read (written in YAML, or unreadable), so what they use was not checked.`);

  const count = (kind: RefKind) => c.items.filter((i) => i.kind === kind).length;
  return {
    generatedAt: new Date(input.now).toISOString(),
    readAt: c.h.fetchedAt,
    options: c.opts,
    findings,
    counts,
    byCheck,
    checked: { entities: Object.keys(c.h.entities).length, automations: count("automation"), scripts: count("script"), scenes: count("scene"), dashboards: count("dashboard"), unreadable: yaml },
    notes,
  };
}

// The findings that belong to one area, in the order they came.
export const findingsForArea = (report: HealthReport, areaId: string): HealthFinding[] => report.findings.filter((f) => f.area === areaId);

