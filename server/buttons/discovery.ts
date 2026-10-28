import { buttonRecord, validButtonMap, type ButtonControl, type ButtonExisting, type ButtonGesture, type ButtonInventory, type ButtonManaged, type ButtonMap } from "../../shared/buttons.ts";
import { gestureSource, matchGesture, normalizeTrigger, referencesDevice, summarizeActions, type TargetNames } from "../../shared/button-match.ts";
import type { Hierarchy } from "../../shared/types.ts";
import type { RawRegistry } from "../model/hierarchy.ts";
import type { RestApi } from "../ha/rest.ts";
import { mapLimit } from "../references/snapshot.ts";
import { buttonConfig } from "./mapping.ts";
import { BUTTON_MARKER, buttonHash, buttonAutomationId } from "./identity.ts";
export { BUTTON_MARKER, buttonHash, buttonAutomationId } from "./identity.ts";

export type ButtonHa = { command<T>(type: string, payload?: Record<string, unknown>): Promise<T> };
export type ButtonEvidence = { id: string; entityId: string; name: string; enabled: boolean | null; config: Record<string, unknown> | null };
export type ButtonRead = { inventory: ButtonInventory; evidence: ButtonEvidence[] };

type GestureInput = Omit<ButtonGesture, "key">;

const GESTURE_WORDS = "press|click|hold|release|button|key|action|double|single|triple|remote|rotate|step|command";
const DEVICE_TRIGGER_GESTURE = new RegExp(GESTURE_WORDS, "i");
// An enum sensor is a button when its options read like presses.
const ENUM_PRESS_OPTION = /press|click|hold|release|double|single|long|triple|action/i;
const MAX_DEVICE_TRIGGERS = 200;
const GENERIC_EVENT_NOTE = "Some event entities here have no button device class. Verify that their events represent the buttons you intend to assign.";

// The map Taxis wrote into an automation's description, if it is one.
export function storedButtonMap(config: unknown): ButtonMap | null {
  if (!buttonRecord(config) || typeof config.description !== "string" || !config.description.startsWith(BUTTON_MARKER)) return null;
  try {
    const value: unknown = JSON.parse(config.description.slice(BUTTON_MARKER.length));
    return validButtonMap(value) ? value : null;
  } catch {
    return null;
  }
}

const readable = (s: string) => s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

// Button and gesture names for a device trigger, from its type and subtype:
// subtype "1_single" is button "1", gesture "Single".
function nativeLabels(trigger: Record<string, unknown>) {
  const type = String(trigger.type ?? "Press");
  const sub = String(trigger.subtype ?? "Button");
  const words = "single|double|triple|hold|release|long|short|press|quadruple";
  const suffixed = new RegExp(`^(.*?)[_ -](${words})(?:_press)?$`).exec(sub);
  const prefixed = new RegExp(`^(${words})[_ -](.+)$`).exec(sub);
  if (suffixed) return { button: readable(suffixed[1] || "Button"), gesture: readable(suffixed[2]) };
  if (prefixed) return { button: readable(prefixed[2]), gesture: readable(prefixed[1]) };
  if (type === "action") return { button: "Button / control", gesture: readable(sub) };
  return { button: readable(sub), gesture: readable(type.replace(/^remote_button_/, "")) };
}

// ---- Controls and their gestures -------------------------------------------

// One control per device; an entity with no device gets one of its own.
class Controls {
  readonly all = new Map<string, ButtonControl>();

  constructor(private readonly h: Hierarchy) {
    for (const d of Object.values(h.devices)) {
      const integrations = new Set(d.entityIds.map((id) => h.entities[id]?.platform).filter((p): p is string => !!p));
      this.all.set(`device:${d.id}`, {
        id: `device:${d.id}`, deviceId: d.id, name: d.name, areaId: d.areaId, manufacturer: d.manufacturer, model: d.model,
        integrations: [...integrations], gestures: [], notes: [], existing: {},
      });
    }
  }

  forEntity(entityId: string): ButtonControl | null {
    const e = this.h.entities[entityId];
    if (!e) return null;
    const ofDevice = e.deviceId ? this.all.get(`device:${e.deviceId}`) : undefined;
    if (ofDevice) return ofDevice;
    const id = `entity:${entityId}`;
    if (!this.all.has(id)) {
      this.all.set(id, { id, deviceId: null, name: e.name, areaId: e.areaId, manufacturer: null, model: null, integrations: [e.platform], gestures: [], notes: [], existing: {} });
    }
    return this.all.get(id)!;
  }
}

function addGesture(control: ButtonControl, gesture: GestureInput) {
  const key = buttonHash({ trigger: gesture.trigger, eventEntity: gesture.eventEntity ?? null, eventType: gesture.eventType ?? null }).slice(0, 24);
  if (!control.gestures.some((g) => g.key === key)) control.gestures.push({ ...gesture, key });
}

// Gestures the integration advertises as device triggers.
async function addDeviceTriggerGestures(control: ButtonControl, ha: ButtonHa) {
  try {
    const list = await ha.command<unknown>("device_automation/trigger/list", { device_id: control.deviceId });
    if (!Array.isArray(list)) {
      control.notes.push("Device trigger metadata was not readable.");
      return;
    }
    if (list.length > MAX_DEVICE_TRIGGERS) control.notes.push(`Only the first ${MAX_DEVICE_TRIGGERS} device triggers are listed. Discovery is incomplete for this control.`);
    for (const value of list.slice(0, MAX_DEVICE_TRIGGERS)) {
      const trigger = normalizeTrigger(value);
      if (!trigger || trigger.platform !== "device" || trigger.device_id !== control.deviceId) continue;
      if (!DEVICE_TRIGGER_GESTURE.test(`${trigger.type ?? ""} ${trigger.subtype ?? ""}`) || typeof trigger.domain !== "string") continue;
      if (!control.integrations.includes(trigger.domain)) control.integrations.push(trigger.domain);
      addGesture(control, { ...nativeLabels(trigger), source: `${trigger.domain} device trigger`, trigger });
    }
  } catch {
    control.notes.push("This integration did not return device triggers. Entity events or existing automations may still identify its buttons.");
  }
}

function stringList(value: unknown, max: number): string[] {
  return Array.isArray(value) ? value.filter((t): t is string => typeof t === "string" && t.length > 0 && t.length <= 255).slice(0, max) : [];
}

// The options of a sensor that reports presses, or null when it is not one.
function enumPressOptions(attrs: Record<string, unknown> | undefined): string[] | null {
  if (attrs?.device_class !== "enum") return null;
  const options = stringList(attrs.options, 100);
  const presses = options.filter((o) => ENUM_PRESS_OPTION.test(o));
  return presses.length > 0 && presses.length * 2 >= options.length ? options : null;
}

// Gestures from entity states: event entities, enum sensors and button entities.
function addEntityGestures(raw: RawRegistry, h: Hierarchy, controls: Controls) {
  const genericEvents = new Set<ButtonControl>();
  for (const s of raw.states) {
    const e = h.entities[s.entity_id];
    if (!e) continue;
    const attrs = s.attributes as Record<string, unknown> | undefined;
    if (e.domain === "event" && attrs?.device_class !== "motion") {
      const control = controls.forEntity(e.entityId);
      if (!control) continue;
      addEventGestures(control, e.entityId, e.name, attrs);
      if (!["button", "doorbell"].includes(String(attrs?.device_class))) genericEvents.add(control);
    } else if (e.domain === "sensor") {
      const options = enumPressOptions(attrs);
      const control = options && controls.forEntity(e.entityId);
      if (options && control) addEnumGestures(control, e.entityId, e.name, options);
    } else if (e.domain === "button" || e.domain === "input_button") {
      const control = controls.forEntity(e.entityId);
      if (control) addGesture(control, { button: e.name, gesture: "Press", source: "HA button state", trigger: { platform: "state", entity_id: e.entityId }, eventEntity: e.entityId });
    }
  }
  // One note per control, however many generic events it has.
  for (const control of genericEvents) control.notes.push(GENERIC_EVENT_NOTE);
}

function addEventGestures(control: ButtonControl, entityId: string, name: string, attrs: Record<string, unknown> | undefined) {
  const types = stringList(attrs?.event_types, 100);
  for (const type of types) {
    addGesture(control, { button: name, gesture: readable(type), source: "HA event types", trigger: { platform: "state", entity_id: entityId }, eventEntity: entityId, eventType: type });
  }
  if (!types.length) control.notes.push(`${name}: no supported event types were exposed.`);
}

// An enum sensor is not an event entity: the generated trigger is a state
// trigger on the option, and none of the event-entity timestamp conditions
// apply. Pressing the same way twice leaves the state unchanged, so the second
// press is invisible to any automation, hence the note. not_from keeps a restart
// (unavailable → the last press value) from firing the action.
function addEnumGestures(control: ButtonControl, entityId: string, name: string, options: string[]) {
  for (const option of options) {
    addGesture(control, { button: name, gesture: option, source: "HA enum sensor", trigger: { platform: "state", entity_id: entityId, not_from: ["unavailable", "unknown"], to: option }, enumSensor: entityId });
  }
  control.notes.push(`${name} reports presses as a sensor value: pressing the same way twice in a row doesn't change the value, so the second press is missed. Prefer an event entity if the integration offers one.`);
}

// ---- Automations -----------------------------------------------------------

async function readAutomations(raw: RawRegistry, rest: Pick<RestApi, "get">): Promise<ButtonEvidence[]> {
  const evidence: ButtonEvidence[] = raw.states
    .filter((s) => s.entity_id.startsWith("automation."))
    .map((s) => ({
      id: typeof s.attributes?.id === "string" ? s.attributes.id : s.entity_id,
      entityId: s.entity_id,
      name: s.attributes?.friendly_name ?? s.entity_id,
      enabled: s.state === "on" ? true : s.state === "off" ? false : null,
      config: null,
    }));
  await mapLimit(evidence, 6, async (a) => {
    if (a.id.startsWith("automation.")) return;
    try {
      a.config = await rest.get("automation", a.id);
      if (a.config && typeof a.config.alias === "string") a.name = a.config.alias;
    } catch {
      /* Coverage stays explicit; no guessed empty mappings. */
    }
  });
  return evidence;
}

// Automations Taxis wrote: the stored map must also equal what Taxis would
// generate now, so a hand-edited one counts as external.
function findManaged(evidence: ButtonEvidence[]): ButtonManaged[] {
  const managed: ButtonManaged[] = [];
  for (const a of evidence) {
    const map = storedButtonMap(a.config);
    if (map && a.id === buttonAutomationId(map.output) && buttonHash(a.config) === buttonHash(buttonConfig(a.id, a.name, map))) {
      managed.push({ id: a.id, alias: a.name, entityId: a.entityId, enabled: a.enabled, map, fingerprint: buttonHash(a.config) });
    }
  }
  return managed;
}

// Hardware identifiers (IEEE, MAC) of a device, as legacy event triggers carry them.
function hardwareIds(raw: RawRegistry, deviceId: string | null): string[] {
  const device = raw.devices.find((d) => d.id === deviceId) as { identifiers?: unknown; connections?: unknown } | undefined;
  return [device?.identifiers, device?.connections].flatMap((pairs) =>
    Array.isArray(pairs) ? pairs.flatMap((pair) => (Array.isArray(pair) && typeof pair[1] === "string" && pair[1].length >= 8 ? [pair[1]] : [])) : [],
  );
}

type MatchContext = { evidence: ButtonEvidence[]; managed: ButtonManaged[]; raw: RawRegistry; h: Hierarchy; names: TargetNames };

// The press types of each entity that gestures come from, so a template that
// quotes one of them can be read as a filter.
function typesBySource(control: ButtonControl): Map<string, string[]> {
  const types = new Map<string, string[]>();
  for (const g of control.gestures) {
    const source = gestureSource(g);
    const type = g.eventType ?? (g.enumSensor ? String(g.trigger.to) : undefined);
    if (source && type) types.set(source, [...(types.get(source) ?? []), type]);
  }
  return types;
}

// What the automation does for this gesture: the Taxis map's own binding when
// it is one of ours, otherwise a summary of the config.
function existingEntry(a: ButtonEvidence, ctx: MatchContext, map: ButtonMap | undefined, control: ButtonControl, gesture: ButtonGesture, match: ButtonExisting["match"]): ButtonExisting {
  const own = map?.bindings.filter((b) => b.controlId === control.id && b.gestureKey === gesture.key) ?? [];
  const summary = map
    ? { services: own.map((b) => b.action.service), targets: own.flatMap((b) => (b.action.entityId ? [b.action.entityId] : [])) }
    : summarizeActions(a.config, ctx.names);
  return { id: a.id, entityId: a.entityId, name: a.name, enabled: a.enabled, match, ...summary, managed: !!map };
}

function matchGestures(control: ButtonControl, ctx: MatchContext) {
  const types = typesBySource(control);
  for (const gesture of control.gestures) {
    control.existing[gesture.key] = [];
    const siblings = types.get(gestureSource(gesture) ?? "") ?? [];
    for (const a of ctx.evidence) {
      if (!a.config) continue;
      const map = ctx.managed.find((m) => m.id === a.id)?.map;
      // A Taxis automation is matched by its own bindings only: its generated
      // triggers also listen to other presses and filter them in conditions.
      const match = map
        ? map.bindings.some((b) => b.controlId === control.id && b.gestureKey === gesture.key) ? "exact" : null
        : matchGesture(a.config, gesture, siblings);
      if (match) control.existing[gesture.key].push(existingEntry(a, ctx, map, control, gesture, match));
    }
  }
}

// Automations that mention the device but not a particular gesture of it.
function findRelated(control: ButtonControl, ctx: MatchContext): ButtonExisting[] {
  const deviceRefs = new Set([...(control.deviceId ? [control.deviceId] : []), ...hardwareIds(ctx.raw, control.deviceId)]);
  const sourceEntities = control.deviceId ? (ctx.h.devices[control.deviceId]?.entityIds ?? []) : [control.id.replace(/^entity:/, "")];
  const refs = { all: new Set([...deviceRefs, ...sourceEntities]), device: deviceRefs };
  const shown = new Set(Object.values(control.existing).flat().map((a) => a.id));
  return ctx.evidence
    .filter((a) => a.config && !shown.has(a.id) && !ctx.managed.some((m) => m.id === a.id) && referencesDevice(a.config, refs, control.gestures.length > 0))
    .map((a) => ({ id: a.id, entityId: a.entityId, name: a.name, enabled: a.enabled, match: "possible" as const, ...summarizeActions(a.config, ctx.names), managed: false }));
}

// ---- Services --------------------------------------------------------------

async function readServices(ha: ButtonHa, notes: string[]): Promise<{ services: string[]; targetServices: string[] }> {
  try {
    const result = await ha.command<unknown>("get_services");
    if (!buttonRecord(result)) return { services: [], targetServices: [] };
    const entries = Object.entries(result).flatMap(([domain, items]) => (buttonRecord(items) ? Object.entries(items).map(([name, spec]) => ({ id: `${domain}.${name}`, spec })) : []));
    return {
      services: entries.map((s) => s.id).sort(),
      targetServices: entries.filter((s) => buttonRecord(s.spec) && "target" in s.spec).map((s) => s.id).sort(),
    };
  } catch {
    notes.push("Action services could not be read; assignments cannot be queued until this read succeeds.");
    return { services: [], targetServices: [] };
  }
}

export async function discoverButtons(ha: ButtonHa, rest: Pick<RestApi, "get">, raw: RawRegistry, h: Hierarchy): Promise<ButtonRead> {
  const controls = new Controls(h);
  await mapLimit([...controls.all.values()], 6, (c) => addDeviceTriggerGestures(c, ha));
  addEntityGestures(raw, h, controls);

  const evidence = await readAutomations(raw, rest);
  const managed = findManaged(evidence);
  const names: TargetNames = { device: (id) => h.devices[id]?.name ?? id, area: (id) => h.areas[id]?.name ?? id };
  const ctx: MatchContext = { evidence, managed, raw, h, names };
  for (const control of controls.all.values()) {
    matchGestures(control, ctx);
    const related = findRelated(control, ctx);
    if (related.length || !control.gestures.length) control.related = related;
    control.gestures.sort((a, b) => a.button.localeCompare(b.button, undefined, { numeric: true }) || a.gesture.localeCompare(b.gesture));
  }

  const notes: string[] = [];
  const { services, targetServices } = await readServices(ha, notes);
  const missing = evidence.filter((a) => !a.config).length;
  if (missing) notes.push(`${missing} automation configs could not be read (including YAML-only or unavailable configurations); mapping coverage is incomplete.`);
  notes.push("Only gestures exposed by HA integrations are listed. Device triggers can be incomplete until an integration discovers them; unknown gestures are never invented.");
  notes.push("Possible references are conservative. Arbitrary MQTT topics, templates, scripts and external controllers cannot always be linked to a device; absence of a match is not proof that no other handler exists.");
  return {
    inventory: {
      controls: [...controls.all.values()].sort((a, b) => a.name.localeCompare(b.name)),
      managed, services, targetServices, notes,
      coverage: { automations: evidence.length, readable: evidence.length - missing, unreadable: missing },
      fetchedAt: new Date().toISOString(),
    },
    evidence,
  };
}
