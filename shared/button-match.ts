import { buttonRecord } from "./buttons.ts";

// Which existing automations handle a button gesture. Pure functions over an
// automation config (as Home Assistant stores it) and a discovered gesture;
// nothing here reads or changes anything. Discovery lives in
// server/buttons/discovery.ts, which calls matchGesture() once per automation
// per gesture.
//
// Real automations are written in a few shapes, and each is matched on its own:
//
//   device trigger   {trigger: device, domain, device_id, type, subtype}
//                    exact when those four fields are equal (discovery_id,
//                    metadata and ids are ignored)
//   event entity     a state trigger on event.x, narrowed by a condition on its
//                    event_type attribute (or by "attribute: event_type, to:")
//   enum sensor      the same, narrowed by the sensor's state instead
//   blueprint        use_blueprint.input holds the entity; sibling inputs such
//                    as b3_single say which press the blueprint handles
//
// "exact" means the automation runs for this gesture and, as far as the config
// can tell, only for it. "possible" means it may run for it (an unfiltered
// trigger, a template we could not read). null means no relation.

export type MatchLevel = "exact" | "possible";

// The part of a discovered gesture the matcher needs.
export type MatchableGesture = {
  trigger: Record<string, unknown>;
  eventEntity?: string;
  eventType?: string;
  enumSensor?: string;
};

// What Home Assistant names things, to render device and area targets.
export type TargetNames = {
  device: (id: string) => string;
  area: (id: string) => string;
};

type Source = {
  entityId: string;
  // The press type: an event type, or the enum option. Undefined for a button
  // entity, which has a single "press".
  type: string | undefined;
  kind: "event" | "enum";
};

// A condition that narrows an entity to some values of an attribute.
type StateFilter = { entityIds: string[]; attribute: string | undefined; states: string[]; negated: boolean };
type TemplateFilter = { text: string; negated: boolean };
type Evidence = { states: StateFilter[]; templates: TemplateFilter[] };

const asList = (value: unknown): unknown[] => (Array.isArray(value) ? value : value === undefined || value === null ? [] : [value]);
const asStrings = (value: unknown): string[] => asList(value).filter((v): v is string => typeof v === "string");
const ENTITY_ID = /^[a-z_]+\.[a-z0-9_]+$/;

// A trigger as a plain record, with the new-style `trigger:` key folded into
// `platform:`. Fields that do not change what it listens to are dropped.
export function normalizeTrigger(value: unknown): Record<string, unknown> | null {
  if (!buttonRecord(value)) return null;
  const out = { ...value };
  for (const key of ["id", "metadata", "alias", "enabled"]) delete out[key];
  if (typeof out.trigger === "string") {
    out.platform = out.trigger;
    delete out.trigger;
  }
  return out;
}

function triggersOf(config: Record<string, unknown>): Record<string, unknown>[] {
  return asList(config.triggers ?? config.trigger).flatMap((t) => normalizeTrigger(t) ?? []) as Record<string, unknown>[];
}

// The entity a gesture comes from, when it comes from one (not a device trigger).
function sourceOf(gesture: MatchableGesture): Source | null {
  if (gesture.eventEntity) return { entityId: gesture.eventEntity, type: gesture.eventType, kind: "event" };
  if (gesture.enumSensor) {
    const to = gesture.trigger.to;
    return { entityId: gesture.enumSensor, type: typeof to === "string" ? to : undefined, kind: "enum" };
  }
  return null;
}

// The entity a gesture belongs to, for grouping sibling gestures.
export function gestureSource(gesture: MatchableGesture): string | null {
  return sourceOf(gesture)?.entityId ?? null;
}

const better = (a: MatchLevel | null, b: MatchLevel | null): MatchLevel | null => (a === "exact" || b === "exact" ? "exact" : a ?? b);

// The match of one automation against one gesture. `siblingTypes` are all the
// press types of the gesture's own entity: a template that quotes one of them
// is read as a filter, anything else is not.
export function matchGesture(config: Record<string, unknown>, gesture: MatchableGesture, siblingTypes: readonly string[]): MatchLevel | null {
  const source = sourceOf(gesture);
  if (!source) return gesture.trigger.platform === "device" ? matchDeviceGesture(config, gesture.trigger) : null;
  return better(matchTriggers(config, source, siblingTypes), matchBlueprintEntity(config, source));
}

// ---- Device triggers -------------------------------------------------------

// Only the four fields that name the trigger are compared. HA's trigger list
// adds discovery_id and metadata; the UI saves neither.
function matchDeviceGesture(config: Record<string, unknown>, trigger: Record<string, unknown>): MatchLevel | null {
  const same = triggersOf(config).some(
    (t) => t.platform === "device" && t.domain === trigger.domain && t.device_id === trigger.device_id && t.type === trigger.type && t.subtype === trigger.subtype,
  );
  if (same) return "exact";
  // A blueprint that takes the device itself handles its buttons, which one is
  // inside the blueprint.
  return blueprintValues(config).some((v) => holds(v, trigger.device_id)) ? "possible" : null;
}

// ---- Event entities and enum sensors ---------------------------------------

// Reading a config's conditions is the same for every gesture, so it is kept.
const evidenceCache = new WeakMap<object, Evidence>();

function evidenceOf(config: Record<string, unknown>): Evidence {
  let evidence = evidenceCache.get(config);
  if (!evidence) {
    evidence = collectEvidence(config);
    evidenceCache.set(config, evidence);
  }
  return evidence;
}

function matchTriggers(config: Record<string, unknown>, source: Source, siblingTypes: readonly string[]): MatchLevel | null {
  const evidence = evidenceOf(config);
  let result: MatchLevel | null = null;
  for (const trigger of triggersOf(config)) {
    const level = matchTrigger(trigger, source, siblingTypes, evidence);
    result = better(result, level);
  }
  return result;
}

function matchTrigger(trigger: Record<string, unknown>, source: Source, siblingTypes: readonly string[], evidence: Evidence): MatchLevel | null {
  const templateTrigger = trigger.platform === "template" && typeof trigger.value_template === "string" && trigger.value_template.includes(source.entityId);
  const stateTrigger = trigger.platform === "state" && asStrings(trigger.entity_id).includes(source.entityId);
  if (!stateTrigger && !templateTrigger) return null;
  // A button entity has no press types: any change of it is the press.
  if (source.type === undefined) return "exact";
  const wanted = triggerTypes(trigger, source);
  if (wanted) return wanted.includes(source.type) ? "exact" : null;
  const extra: Evidence = templateTrigger
    ? { ...evidence, templates: [...evidence.templates, { text: String(trigger.value_template), negated: false }] }
    : evidence;
  return levelFromConditions(source, siblingTypes, extra);
}

// The press types a state trigger is limited to, or null when it is not limited
// (it runs on any press). An event entity is limited through its event_type
// attribute; an enum sensor through its state.
function triggerTypes(trigger: Record<string, unknown>, source: Source): string[] | null {
  if (trigger.platform !== "state") return null;
  const attribute = trigger.attribute;
  const limited = source.kind === "event" ? attribute === "event_type" : attribute === undefined;
  if (!limited) return null;
  const to = asStrings(trigger.to);
  return to.length ? to : null;
}

// What the conditions say about one press type, given that the trigger runs on
// any press of the entity.
function levelFromConditions(source: Source, siblingTypes: readonly string[], evidence: Evidence): MatchLevel | null {
  const allowed = new Set<string>();
  let unreadable = false;
  const attribute = source.kind === "event" ? "event_type" : undefined;
  for (const filter of evidence.states) {
    if (!filter.entityIds.includes(source.entityId) || filter.attribute !== attribute) continue;
    // A negated filter says what is excluded; that is not read as an allow-list.
    if (filter.negated) unreadable = true;
    else filter.states.forEach((s) => allowed.add(s));
  }
  for (const template of evidence.templates) {
    const verdict = readTemplate(template.text, source, siblingTypes);
    if (verdict === null) continue;
    if (verdict === "unknown" || template.negated) unreadable = true;
    else verdict.forEach((t) => allowed.add(t));
  }
  if (allowed.size) return allowed.has(source.type!) ? "exact" : unreadable ? "possible" : null;
  // No filter at all, or one we could not read: it may run for any press.
  return "possible";
}

// Reads a template for the press types it quotes. Returns:
//   a list of types   it tests for these (event_type == 'Double press')
//   "unknown"         it is about this entity, but names no type we recognise,
//                     or negates the test
//   null              it has nothing to do with this entity's press
function readTemplate(text: string, source: Source, siblingTypes: readonly string[]): string[] | "unknown" | null {
  const mentionsEntity = text.includes(source.entityId);
  const testsPress = source.kind === "event" ? /event_type/.test(text) : /to_state\.state|from_state\.state/.test(text);
  if (!mentionsEntity && !testsPress) return null;
  const lower = text.toLowerCase();
  const quoted = siblingTypes.filter((t) => lower.includes(`'${t.toLowerCase()}'`) || lower.includes(`"${t.toLowerCase()}"`));
  if (!quoted.length) return mentionsEntity ? "unknown" : null;
  // "event_type != 'Long press'" would otherwise read as exact for Long press.
  if (/!=|\bnot\b/.test(text)) return "unknown";
  return quoted;
}

// ---- Conditions ------------------------------------------------------------

function collectEvidence(config: Record<string, unknown>): Evidence {
  const evidence: Evidence = { states: [], templates: [] };
  collectConditions(asList(config.conditions ?? config.condition), false, evidence, 0);
  collectActionConditions(config.actions ?? config.action, evidence, 0);
  return evidence;
}

// Conditions nested in and/or/not. Under `not` the filter is kept but marked,
// because it then excludes instead of selecting.
function collectConditions(conditions: unknown[], negated: boolean, out: Evidence, depth: number): void {
  if (depth > 12) return;
  for (const c of conditions) {
    if (typeof c === "string") {
      out.templates.push({ text: c, negated });
      continue;
    }
    if (!buttonRecord(c)) continue;
    switch (c.condition) {
      case "and":
      case "or":
        collectConditions(asList(c.conditions), negated, out, depth + 1);
        break;
      case "not":
        collectConditions(asList(c.conditions), true, out, depth + 1);
        break;
      case "state":
        out.states.push({ entityIds: asStrings(c.entity_id), attribute: typeof c.attribute === "string" ? c.attribute : undefined, states: asStrings(c.state), negated });
        break;
      case "template":
        if (typeof c.value_template === "string") out.templates.push({ text: c.value_template, negated });
        break;
    }
  }
}

// Conditions inside actions: choose options, if/while/until, and a bare
// `condition:` step that stops the sequence.
function collectActionConditions(value: unknown, out: Evidence, depth: number): void {
  if (depth > 16) return;
  if (Array.isArray(value)) {
    value.slice(0, 100).forEach((v) => collectActionConditions(v, out, depth + 1));
    return;
  }
  if (!buttonRecord(value)) return;
  if (typeof value.condition === "string") {
    collectConditions([value], false, out, 0);
    return;
  }
  const own = ["conditions", "if", "while", "until"];
  for (const key of own) collectConditions(asList(value[key]), false, out, 0);
  for (const [key, child] of Object.entries(value)) if (!own.includes(key)) collectActionConditions(child, out, depth + 1);
}

// ---- Blueprints ------------------------------------------------------------

function blueprintInput(config: Record<string, unknown>): Record<string, unknown> {
  const blueprint = config.use_blueprint;
  return buttonRecord(blueprint) && buttonRecord(blueprint.input) ? blueprint.input : {};
}

const blueprintValues = (config: Record<string, unknown>): unknown[] => Object.values(blueprintInput(config));

// Does an input value (a string, or a list of them) hold this id?
function holds(value: unknown, id: unknown): boolean {
  if (typeof id !== "string") return false;
  return value === id || (Array.isArray(value) && value.includes(id));
}

// The button number in an input name: button3_event, b3_single, button_3_double.
function buttonToken(key: string): string | null {
  return /(?:^|[^a-z])(?:button|btn|key|b)[ _-]?(\d+)/i.exec(key)?.[1] ?? null;
}

type PressWord = "single" | "double" | "triple" | "long";

// single / double / triple / long (hold) in an input name or a press type.
// A release is not a press and gives no word.
function pressWord(text: string): PressWord | null {
  const t = text.toLowerCase().replace(/[_-]/g, " ");
  if (/release/.test(t)) return null;
  const word = /(single|double|triple|long|hold)/.exec(t)?.[1];
  return word === undefined ? null : word === "hold" ? "long" : (word as PressWord);
}

const nonEmpty = (value: unknown): boolean => (Array.isArray(value) ? value.length > 0 : buttonRecord(value) ? Object.keys(value).length > 0 : typeof value === "string" ? value.trim() !== "" : value !== undefined && value !== null);

// A blueprint input that holds the entity is a possible match for its presses.
// When the blueprint has one input per press for that button (b3_single,
// b3_double), those say which presses are handled.
function matchBlueprintEntity(config: Record<string, unknown>, source: Source): MatchLevel | null {
  const input = blueprintInput(config);
  let result: MatchLevel | null = null;
  for (const [key, value] of Object.entries(input)) {
    if (!holds(value, source.entityId)) continue;
    result = better(result, blueprintLevel(key, input, source));
  }
  return result;
}

function blueprintLevel(key: string, input: Record<string, unknown>, source: Source): MatchLevel | null {
  const token = buttonToken(key);
  const wanted = source.type === undefined ? null : pressWord(source.type);
  if (!token || !wanted) return "possible";
  const perPress = Object.entries(input).filter(([k]) => k !== key && buttonToken(k) === token && pressWord(k) !== null);
  // No per-press inputs: the blueprint decides inside, so only "possible".
  if (!perPress.length) return "possible";
  return perPress.some(([k, v]) => pressWord(k) === wanted && nonEmpty(v)) ? "exact" : null;
}

// ---- Device-wide references -----------------------------------------------

function containsValue(value: unknown, ids: ReadonlySet<string>, depth = 0): boolean {
  if (depth > 20) return false;
  if (typeof value === "string") return ids.has(value) || [...ids].some((id) => id.includes(".") && value.includes(id));
  if (Array.isArray(value)) return value.some((v) => containsValue(v, ids, depth + 1));
  return buttonRecord(value) && Object.values(value).some((v) => containsValue(v, ids, depth + 1));
}

// References to a device that cannot be tied to one gesture:
//  - a legacy `event` trigger (zha_event, xiaomi click…) whose data names the
//    device, its hardware id or one of its entities;
//  - for a control with no gestures at all, any trigger or blueprint that does;
//  - a blueprint taking the device itself or its hardware id.
// They are listed under the control, never on a gesture.
export function referencesDevice(config: Record<string, unknown>, refs: { all: ReadonlySet<string>; device: ReadonlySet<string> }, hasGestures: boolean): boolean {
  if (!hasGestures) return containsValue([config.triggers ?? config.trigger, config.use_blueprint], refs.all);
  if (triggersOf(config).some((t) => t.platform === "event" && containsValue(t, refs.all))) return true;
  return containsValue(config.use_blueprint, refs.device);
}

// ---- What an automation does ----------------------------------------------

// The services an automation calls and what they target. Entities are listed by
// id; devices and areas as `device:<name>` and `area:<name>`.
export function summarizeActions(config: unknown, names: TargetNames): { services: string[]; targets: string[] } {
  const services = new Set<string>();
  const targets = new Set<string>();
  const addTargets = (holder: unknown) => {
    if (!buttonRecord(holder)) return;
    for (const id of asStrings(holder.entity_id)) if (ENTITY_ID.test(id)) targets.add(id);
    for (const id of asStrings(holder.device_id)) if (isPlainId(id)) targets.add(`device:${names.device(id)}`);
    for (const id of asStrings(holder.area_id)) if (isPlainId(id)) targets.add(`area:${names.area(id)}`);
  };
  const walk = (value: unknown, depth = 0) => {
    if (depth > 16) return;
    if (Array.isArray(value)) {
      value.slice(0, 100).forEach((v) => walk(v, depth + 1));
      return;
    }
    if (!buttonRecord(value)) return;
    const service = value.action ?? value.service;
    if (typeof service === "string" && /^[a-z_]+\.[a-z_]+$/.test(service)) services.add(service);
    addTargets(value.target);
    addTargets(value.data);
    Object.values(value).forEach((v) => walk(v, depth + 1));
  };
  walk(config);
  return { services: [...services].slice(0, 30), targets: [...targets].slice(0, 50) };
}

// Not a template, not a blank.
const isPlainId = (id: string): boolean => id.length > 0 && id.length <= 255 && !id.includes("{");
