// Reading the parts of a stored automation the automation checks need: its
// triggers, conditions and the actions that always run. Both the current syntax
// (`triggers`, `trigger:`, `conditions`, `actions`) and the older one (`trigger`,
// `platform:`, `condition`, `action`) are read. Pure; nothing is changed.

import { serviceCalls, type ServiceCall } from "../health-scan.ts";

export type Obj = Record<string, unknown>;

export const isObj = (v: unknown): v is Obj => Boolean(v) && typeof v === "object" && !Array.isArray(v);
export const asArr = (v: unknown): unknown[] => (Array.isArray(v) ? v : v === undefined || v === null ? [] : [v]);

// A string or a list of strings, as a list. A template gives nothing.
export const strings = (v: unknown): string[] =>
  asArr(v)
    .filter((x): x is string => typeof x === "string")
    .flatMap((x) => x.split(","))
    .map((x) => x.trim())
    .filter((x) => x !== "" && !x.includes("{{") && !x.includes("{%"));

export const triggersOf = (config: unknown): Obj[] => (isObj(config) ? asArr(config.triggers ?? config.trigger).filter(isObj) : []);

// The kind of a trigger: `trigger: state` (current) or `platform: state` (older).
export const triggerKind = (t: Obj): string => (typeof t.trigger === "string" ? t.trigger : typeof t.platform === "string" ? t.platform : "");

export const conditionsOf = (config: unknown): unknown[] => (isObj(config) ? asArr(config.conditions ?? config.condition) : []);

// The actions of an automation (a script has a sequence). In the older syntax an
// automation's `action` is the list itself.
export const actionsOf = (config: unknown): unknown[] =>
  isObj(config) ? asArr(config.actions ?? (Array.isArray(config.action) ? config.action : undefined) ?? config.sequence) : [];

export const modeOf = (config: unknown): string => (isObj(config) && typeof config.mode === "string" ? config.mode : "single");

// ---------------------------------------------------------------------------
// The actions that always run.
// ---------------------------------------------------------------------------

// The service calls that run every time the actions run: plain steps, and the
// steps inside a plain `sequence` or `parallel`. A step behind an `if`, a
// `choose`, a `repeat`, a `wait` or a `condition` is not included, and a
// `condition` step ends the list (what follows may never run). So a call in the
// list is one that really happens.
export type AlwaysCall = ServiceCall & { data: Obj };
export function alwaysCalls(actions: unknown): AlwaysCall[] {
  const out: AlwaysCall[] = [];
  const walk = (steps: unknown): boolean => {
    for (const step of asArr(steps)) {
      if (!isObj(step)) continue;
      if (step.enabled === false) continue;
      if (Object.hasOwn(step, "condition")) return false;
      if (Object.hasOwn(step, "sequence")) {
        if (!walk(step.sequence)) return false;
        continue;
      }
      if (Object.hasOwn(step, "parallel")) {
        walk(asArr(step.parallel).flatMap((p) => (isObj(p) && Object.hasOwn(p, "sequence") ? asArr(p.sequence) : [p])));
        continue;
      }
      if (["if", "choose", "repeat", "wait_template", "wait_for_trigger", "stop"].some((k) => Object.hasOwn(step, k))) {
        if (Object.hasOwn(step, "stop")) return false;
        continue;
      }
      const calls = serviceCalls(step);
      // A plain step is one call; serviceCalls also finds nested ones (a service
      // inside `data`), which are not calls, so only the step's own is taken.
      if (calls.length > 0) out.push({ ...calls[0], data: isObj(step.data) ? step.data : {} });
    }
    return true;
  };
  walk(actions);
  return out;
}

// Whether any step of the actions waits or delays (anywhere in the tree), with a
// delay that is not zero.
export function waits(actions: unknown): boolean {
  const zero = (v: unknown): boolean => {
    if (v === 0 || v === "0" || v === "00:00:00" || v === "0:00:00") return true;
    if (isObj(v)) return Object.values(v).every((x) => x === 0 || x === "0");
    return false;
  };
  const visit = (v: unknown): boolean => {
    if (Array.isArray(v)) return v.some(visit);
    if (!isObj(v)) return false;
    if ((Object.hasOwn(v, "delay") && !zero(v.delay)) || Object.hasOwn(v, "wait_template") || Object.hasOwn(v, "wait_for_trigger")) return true;
    return Object.values(v).some(visit);
  };
  return visit(actions);
}

// ---------------------------------------------------------------------------
// Triggers.
// ---------------------------------------------------------------------------

// A trigger that fires when Home Assistant starts.
export const isStartTrigger = (t: Obj): boolean =>
  (triggerKind(t) === "homeassistant" && t.event === "start") ||
  (triggerKind(t) === "event" && ["homeassistant_started", "homeassistant_start"].includes(String(t.event_type)));

// The wording of the types of device triggers of buttons and remotes.
const BUTTON_TYPE = /press|button|click|release|hold|tap/i;
export const isButtonDeviceTrigger = (t: Obj): boolean => triggerKind(t) === "device" && typeof t.type === "string" && BUTTON_TYPE.test(t.type);

// Events the common remote integrations send when a button is used.
export const BUTTON_EVENTS: ReadonlySet<string> = new Set([
  "zha_event",
  "deconz_event",
  "hue_event",
  "lutron_caseta_button_event",
  "zwave_js_value_notification",
  "shelly.click",
]);

// An event entity (`event.*`) a state trigger watches.
export const eventEntitiesOf = (t: Obj): string[] => (triggerKind(t) === "state" ? strings(t.entity_id).filter((id) => id.startsWith("event.")) : []);

// A trigger a button or remote starts.
export const isButtonTrigger = (t: Obj): boolean =>
  eventEntitiesOf(t).length > 0 ||
  isButtonDeviceTrigger(t) ||
  (triggerKind(t) === "event" && typeof t.event_type === "string" && BUTTON_EVENTS.has(t.event_type));
