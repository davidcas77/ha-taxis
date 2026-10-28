import { allTargetServices, entityIdsIn, serviceCalls } from "../health-scan.ts";
import { canonicalId } from "../helpers.ts";
import { floorCodes, houseGroupId } from "../naming.ts";
import { type HealthFinding, type HealthItem } from "./types.ts";
import { type Ctx, areaOf, asItem, enabled, isTaxisItem, itemKey, itemName, names, nameOf, plural, reached, timeOf } from "./context.ts";
import {
  type AlwaysCall,
  type Obj,
  actionsOf,
  alwaysCalls,
  conditionsOf,
  eventEntitiesOf,
  isButtonDeviceTrigger,
  isButtonTrigger,
  isObj,
  isStartTrigger,
  modeOf,
  strings,
  triggerKind,
  triggersOf,
  waits,
} from "./automation-scan.ts";

// Checks on how the user's own automations are written: what runs at a restart,
// what contradicts what, what a button press loses, what breaks when a device is
// paired again, and what cannot work while a person is unknown. They read the
// stored configs only. The Taxis recipes' automations are left to the recipes'
// own checks (except that ids are checked for all), and a check that is unsure
// says nothing.

const HOUR = 3_600_000;

// Enabled automations that are not Taxis recipes, with a readable config.
const own = (c: Ctx): HealthItem[] => c.readable.filter((i) => i.kind === "automation" && enabled(c, i) && !isTaxisItem(i));

const where = (c: Ctx, item: HealthItem) => areaOf(c, item.entityId);

// ---------------------------------------------------------------------------
// 1: automations that change devices at every Home Assistant restart.
// ---------------------------------------------------------------------------

const STARTUP_DOMAINS = new Set(["light", "switch", "climate", "media_player", "cover", "fan", "humidifier", "lock", "siren", "valve"]);
const STARTUP_SERVICE = /^(turn_on|turn_off|toggle|set_.+|media_.+|open_.+|close_.+|volume_.+|select_.+|play_media)$/;

// The groups that stand for a floor or the whole house.
function wideLights(c: Ctx): Set<string> {
  const out = new Set<string>(["light.all", houseGroupId(c.naming)]);
  for (const code of Object.values(floorCodes(c.h, c.naming))) out.add(canonicalId("light", code.code, c.suffix.lights));
  return out;
}

// A light group that gathers lights in three or more areas is house-wide too.
function manyAreas(c: Ctx, id: string, seen = new Set<string>()): Set<string> {
  const out = new Set<string>();
  if (seen.has(id)) return out;
  seen.add(id);
  const e = c.h.entities[id];
  if (!e) return out;
  if (e.members.length === 0) {
    if (e.areaId) out.add(e.areaId);
    return out;
  }
  for (const m of e.members) for (const a of manyAreas(c, m, seen)) out.add(a);
  return out;
}

export function startupChecks(c: Ctx): HealthFinding[] {
  const out: HealthFinding[] = [];
  const wide = wideLights(c);
  for (const item of own(c)) {
    const config = item.config;
    if (!isObj(config) || !triggersOf(config).some(isStartTrigger)) continue;
    // A condition on the whole automation: it may stop the run at a restart.
    if (conditionsOf(config).length > 0) continue;
    const allServices = allTargetServices(config);
    const touched = new Set<string>();
    let wideOff: string | null = null;
    for (const call of alwaysCalls(actionsOf(config))) {
      const [domain, name] = call.service.split(".");
      const homeassistant = domain === "homeassistant" && (name === "turn_on" || name === "turn_off" || name === "toggle");
      if (!(homeassistant || (STARTUP_DOMAINS.has(domain) && STARTUP_SERVICE.test(name)))) continue;
      const off = name === "turn_off";
      if (call.dynamic) {
        // A target of "all" or a template: it changes something, but what is not known.
        if (allServices.includes(call.service)) {
          touched.add(`every ${domain === "homeassistant" ? "entity" : domain}`);
          if (off && domain === "light") wideOff ??= "light.all";
        } else touched.add("whatever its template names");
        continue;
      }
      const ids = new Set<string>(call.entityIds);
      for (const d of STARTUP_DOMAINS) for (const id of reached(c, call, d)) ids.add(id);
      for (const id of ids) {
        touched.add(nameOf(c, id));
        if (off && id.startsWith("light.") && (wide.has(id) || manyAreas(c, id).size >= 3)) wideOff = id;
      }
    }
    if (touched.size === 0 && wideOff === null) continue;
    const list = [...touched].sort();
    const what = wideOff
      ? `${nameOf(c, wideOff)}, which is the lights of the ${wideOff === houseGroupId(c.naming) || wideOff === "light.all" ? "whole house" : "floor"}`
      : names(list);
    out.push({
      id: `automation-startup:${itemKey(item)}`,
      check: "automation-startup",
      severity: wideOff ? "error" : "warning",
      area: where(c, item),
      item: asItem(item),
      title: `${itemName(item)} runs at every Home Assistant restart and changes ${wideOff ? nameOf(c, wideOff) : names(list)}`,
      detail: `It starts when Home Assistant starts, has no condition, and ${wideOff ? `turns off ${what}` : `changes ${what}`}. Every restart (an update, a power cut) then switches ${wideOff ? "the house's lights off" : "them"} whatever state they were in. Add a condition (for instance the time of day, or someone being home) or take the start-up trigger out.`,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// 2: two automations with the same trigger that set the same thing differently.
// ---------------------------------------------------------------------------

// A trigger as a comparable string: the kind, the entity or time and the fields
// that decide when it fires. Two automations share a trigger only when these are
// equal. A trigger of a kind not listed has none.
const norm = (v: unknown): unknown => (Array.isArray(v) ? v.map(String).sort() : (v ?? null));

function signatures(config: unknown): Map<string, string> {
  const out = new Map<string, string>();
  for (const t of triggersOf(config)) {
    const kind = triggerKind(t);
    if (kind === "homeassistant" && isStartTrigger(t)) out.set("start", "Home Assistant starting");
    else if (kind === "state" || kind === "numeric_state") {
      for (const id of strings(t.entity_id)) {
        const key = JSON.stringify([
          kind,
          id,
          norm(t.from),
          norm(t.to),
          norm(t.not_from),
          norm(t.not_to),
          norm(t.above),
          norm(t.below),
          norm(t.for),
          norm(t.attribute),
        ]);
        out.set(key, `${id} ${kind === "state" ? "changing" : "crossing a level"}`);
      }
    } else if (kind === "time" && typeof t.at === "string" && /^\d{1,2}:\d{2}(:\d{2})?$/.test(t.at)) out.set(JSON.stringify(["time", t.at]), `${t.at}`);
  }
  return out;
}

// What an automation always does to a target: "power", "temperature", ... and the value.
function effects(c: Ctx, config: unknown): Map<string, string> {
  const out = new Map<string, string>();
  const put = (id: string, key: string, value: unknown) => {
    if (value === undefined || value === null || (typeof value === "string" && (value.includes("{{") || value.includes("{%")))) return;
    out.set(`${id}|${key}`, String(value));
  };
  for (const call of alwaysCalls(actionsOf(config)) as AlwaysCall[]) {
    if (call.dynamic) continue;
    const [domain, name] = call.service.split(".");
    if (!STARTUP_DOMAINS.has(domain)) continue;
    const ids = reached(c, call, domain);
    for (const id of ids) {
      if (name === "turn_on" || name === "turn_off") put(id, "power", name === "turn_on" ? "on" : "off");
      else if (call.service === "climate.set_temperature") put(id, "temperature", call.data.temperature);
      else if (call.service === "climate.set_hvac_mode") put(id, "hvac_mode", call.data.hvac_mode);
      else if (call.service === "cover.open_cover") put(id, "position", "100");
      else if (call.service === "cover.close_cover") put(id, "position", "0");
      else if (call.service === "cover.set_cover_position") put(id, "position", call.data.position);
    }
  }
  return out;
}

// The state conditions of an automation as entity -> states, when every one is
// a plain state condition on one entity; null when any is something else (then
// Taxis cannot tell whether the two can be true together).
function plainConditions(config: unknown): Map<string, Set<string>> | null {
  const out = new Map<string, Set<string>>();
  for (const cond of conditionsOf(config)) {
    if (!isObj(cond) || cond.condition !== "state" || cond.attribute !== undefined || cond.for !== undefined) return null;
    const ids = strings(cond.entity_id);
    const states = strings(cond.state);
    if (ids.length !== 1 || states.length === 0) return null;
    const had = out.get(ids[0]);
    out.set(ids[0], had ? new Set(states.filter((s) => had.has(s))) : new Set(states));
  }
  return out;
}

const exclusive = (a: Map<string, Set<string>>, b: Map<string, Set<string>>): boolean => {
  for (const [id, states] of a) {
    const other = b.get(id);
    if (other && [...states].every((s) => !other.has(s))) return true;
  }
  return false;
};

const VALUE_LABEL: Record<string, string> = { power: "on or off", temperature: "temperature", hvac_mode: "mode", position: "position" };

export function conflictChecks(c: Ctx): HealthFinding[] {
  type Entry = { item: HealthItem; sigs: Map<string, string>; effects: Map<string, string>; plain: Map<string, Set<string>> | null };
  const entries: Entry[] = own(c)
    .map((item) => ({ item, sigs: signatures(item.config), effects: effects(c, item.config), plain: plainConditions(item.config) }))
    .filter((e) => e.sigs.size > 0 && e.effects.size > 0)
    .sort((a, b) => itemKey(a.item).localeCompare(itemKey(b.item)));

  const out: HealthFinding[] = [];
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const a = entries[i];
      const b = entries[j];
      const shared = [...a.sigs.keys()].filter((k) => b.sigs.has(k));
      if (shared.length === 0) continue;
      if (!a.plain || !b.plain || exclusive(a.plain, b.plain)) continue;
      const clashes = [...a.effects].filter(([k, v]) => b.effects.has(k) && b.effects.get(k) !== v);
      if (clashes.length === 0) continue;
      const targets = [...new Set(clashes.map(([k]) => k.split("|")[0]))].sort();
      const lines = clashes.map(([k, v]) => {
        const [id, key] = k.split("|");
        return `${nameOf(c, id)} (${VALUE_LABEL[key] ?? key}): ${itemName(a.item)} sets ${v}, ${itemName(b.item)} sets ${b.effects.get(k)}`;
      });
      const area = [...new Set(targets.map((id) => c.h.entities[id]?.areaId ?? ""))];
      out.push({
        id: `automation-conflicts:${itemKey(a.item)}+${itemKey(b.item)}`,
        check: "automation-conflicts",
        severity: "warning",
        area: area.length === 1 && area[0] ? area[0] : undefined,
        entity: targets[0],
        entities: targets,
        item: asItem(a.item),
        title: `${itemName(a.item)} and ${itemName(b.item)} set ${names(targets.map((id) => nameOf(c, id)))} differently on the same trigger`,
        detail: `Both start on ${a.sigs.get(shared[0])}${shared.length > 1 ? ` (and ${plural(shared.length - 1, "other trigger")})` : ""} and neither has a condition that keeps the other out. ${lines.join("; ")}. Whichever runs last wins, and Home Assistant gives no order. Keep one of them, or add a condition so only one runs.`,
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// 3 and 6: automations a button or remote starts.
// ---------------------------------------------------------------------------

export function buttonChecks(c: Ctx): HealthFinding[] {
  const out: HealthFinding[] = [];
  for (const item of own(c)) {
    const triggers = triggersOf(item.config);

    // 3: the first press after a restart is lost. An event entity is unknown until
    // its first event, so a trigger that ignores a change from unknown ignores that press.
    const lost: string[] = [];
    for (const t of triggers) {
      if (!strings(t.not_from).includes("unknown")) continue;
      for (const id of eventEntitiesOf(t)) lost.push(id);
    }
    if (lost.length > 0) {
      const ids = [...new Set(lost)].sort();
      out.push({
        id: `automation-buttons:first-press:${itemKey(item)}`,
        check: "automation-buttons",
        severity: "info",
        area: where(c, item),
        entity: ids[0],
        entities: ids,
        item: asItem(item),
        title: `${itemName(item)} ignores the first press after a restart`,
        detail: `Its trigger on ${names(ids.map((id) => nameOf(c, id)))} has “unknown” in not_from. An event entity is unknown after every Home Assistant restart until its first press, so that press changes it from unknown and the automation skips it. Take “unknown” out of not_from, or use not_from: unavailable only.`,
      });
    }

    // 6: presses that arrive while a run waits are dropped in mode single.
    if (modeOf(item.config) === "single" && triggers.some(isButtonTrigger) && waits(actionsOf(item.config))) {
      out.push({
        id: `automation-buttons:mode:${itemKey(item)}`,
        check: "automation-buttons",
        severity: "info",
        area: where(c, item),
        item: asItem(item),
        title: `${itemName(item)} is started by a button but drops presses while it waits`,
        detail: `It is in mode single, and its actions wait or delay. A press while a run is still going is ignored (Home Assistant logs a warning). Set mode: queued to run every press in turn, or mode: restart to start over on the last press.`,
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// 4: device ids where an entity does the same.
// ---------------------------------------------------------------------------

const SWITCHED_DOMAINS = new Set(["light", "switch", "fan", "cover", "climate", "media_player", "lock", "humidifier", "siren", "valve"]);

export type Equivalent = { device: string; entities: string[] };

// For each device a config names by id, the entities that could be named instead:
// the event entities of a device a button trigger names, and the entities of the
// domain a service call on the device uses. Devices with no such entity are left out.
export function entityEquivalents(c: Ctx, config: unknown): Equivalent[] {
  const found = new Map<string, Set<string>>();
  const add = (deviceId: string, ids: string[]) => {
    if (ids.length === 0) return;
    const set = found.get(deviceId) ?? new Set<string>();
    for (const id of ids) set.add(id);
    found.set(deviceId, set);
  };
  const entitiesOf = (deviceId: string, domain: string) =>
    (c.h.devices[deviceId]?.entityIds ?? []).filter((id) => id.startsWith(`${domain}.`) && !c.h.entities[id]?.disabled);
  for (const t of triggersOf(config)) {
    if (!isButtonDeviceTrigger(t)) continue;
    for (const id of strings(t.device_id)) add(id, entitiesOf(id, "event"));
  }
  for (const call of serviceCalls(config)) {
    const domain = call.service.split(".")[0];
    if (!SWITCHED_DOMAINS.has(domain)) continue;
    for (const id of call.deviceIds) add(id, entitiesOf(id, domain));
  }
  return [...found]
    .map(([deviceId, set]) => ({ device: c.h.devices[deviceId]?.name ?? deviceId, entities: [...set].sort() }))
    .sort((a, b) => a.device.localeCompare(b.device));
}

// ---------------------------------------------------------------------------
// 5: two automations with the same id.
// ---------------------------------------------------------------------------

export function idChecks(c: Ctx): HealthFinding[] {
  const byId = new Map<string, HealthItem[]>();
  for (const item of c.readable) {
    if (item.kind !== "automation" || !isObj(item.config) || typeof item.config.id !== "string" || item.config.id === "") continue;
    byId.set(item.config.id, [...(byId.get(item.config.id) ?? []), item]);
  }
  const out: HealthFinding[] = [];
  for (const [id, items] of byId) {
    if (items.length < 2) continue;
    out.push({
      id: `automation-ids:${id}`,
      check: "automation-ids",
      severity: "error",
      item: asItem(items[0]),
      title: `${plural(items.length, "automation")} share the id “${id}”`,
      detail: `${names(items.map(itemName).sort())} all use the id ${id}. Home Assistant keeps one entity per id, so only one of them runs and the others are ignored or overwritten when saved. Give each its own id (copy the automation in the editor, or change the id in the file).`,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// 7: arrival and away logic on a person who is unknown.
// ---------------------------------------------------------------------------

// Every condition object in a config, wherever it sits.
function conditionObjects(config: unknown): Obj[] {
  const out: Obj[] = [];
  const visit = (v: unknown) => {
    if (Array.isArray(v)) v.forEach(visit);
    else if (isObj(v)) {
      if (typeof v.condition === "string") out.push(v);
      Object.values(v).forEach(visit);
    }
  };
  visit(config);
  return out;
}

export function peopleChecks(c: Ctx): HealthFinding[] {
  const hours = Math.max(c.opts.unavailableHours, 24);
  const users = new Map<string, HealthItem[]>();
  for (const item of c.readable) {
    if ((item.kind !== "automation" && item.kind !== "script") || !enabled(c, item) || isTaxisItem(item) || !isObj(item.config)) continue;
    const ids = entityIdsIn({ triggers: triggersOf(item.config), conditions: conditionObjects(item.config) }, c.domains);
    for (const id of ids) if (id.startsWith("person.")) users.set(id, [...(users.get(id) ?? []), item]);
  }
  const out: HealthFinding[] = [];
  for (const [id, items] of [...users].sort(([a], [b]) => a.localeCompare(b))) {
    const state = c.stateOf(id);
    if (state !== "unknown" && state !== "unavailable") continue;
    const since = timeOf(c.states[id]?.lastChanged);
    if (since === null || c.now - since < hours * HOUR) continue;
    out.push({
      id: `away-people:${id}`,
      check: "away-people",
      severity: "warning",
      entity: id,
      item: asItem(items[0]),
      title: `Away/arrival can't work while ${nameOf(c, id)} is ${state}`,
      detail: `${nameOf(c, id)} has been ${state} for ${plural(Math.round((c.now - since) / HOUR), "hour")}, and ${names(items.map(itemName).sort())} ${items.length === 1 ? "tests" : "test"} it as a trigger or condition. A person with no working device tracker is never home or away, so arrival and leaving are not seen. Check the person's device trackers (Settings, People) and the Companion app's location permission.`,
    });
  }
  return out;
}
