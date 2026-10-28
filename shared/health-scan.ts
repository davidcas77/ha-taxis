// Reading what a stored config says: the entity ids it uses, the services it
// calls, the conditions it tests and the devices it names. Used by the health
// checks (shared/health.ts). Pure: nothing is read from Home Assistant and no
// input is changed.
//
// Entity ids are found the way renames find them (whole ids, shared/../server/
// references/rewrite.ts) with one difference: a rename already knows the id it
// is looking for, a check has to recognise one. So a candidate counts only when
// its domain is one Home Assistant has entities in, it sits where an id can sit,
// and, in plain text, it is the whole value:
//
//   - a plain string counts when every word in it (split at commas and spaces)
//     is an entity id: `light.a`, `light.a, light.b`. A sentence that mentions
//     one does not;
//   - a template (anything with `{{`, `{%`) is searched for ids, including
//     `states.light.a.state`; a name followed by `(` is a function, not an id;
//   - the value of `action`, `service` and `perform_action` names a service
//     (`light.turn_on`), not an entity, and is never read as one; nor are
//     `alias`, `description` and `id`.
//
// A reference can still be missed (an id built by a template) or, rarely,
// invented (a template that prints text shaped like an id). The checks that use
// this say what they looked at.

// The entity domains Home Assistant core has. A home can have more (custom
// integrations); the checks add the domains its entities actually use.
export const ENTITY_DOMAINS: ReadonlySet<string> = new Set([
  "ai_task",
  "air_quality",
  "alarm_control_panel",
  "assist_satellite",
  "automation",
  "binary_sensor",
  "button",
  "calendar",
  "camera",
  "climate",
  "conversation",
  "counter",
  "cover",
  "date",
  "datetime",
  "device_tracker",
  "event",
  "fan",
  "group",
  "humidifier",
  "image",
  "image_processing",
  "input_boolean",
  "input_button",
  "input_datetime",
  "input_number",
  "input_select",
  "input_text",
  "lawn_mower",
  "light",
  "lock",
  "media_player",
  "notify",
  "number",
  "person",
  "remote",
  "scene",
  "schedule",
  "script",
  "select",
  "sensor",
  "siren",
  "stt",
  "sun",
  "switch",
  "text",
  "time",
  "timer",
  "todo",
  "tts",
  "update",
  "vacuum",
  "valve",
  "wake_word",
  "water_heater",
  "weather",
  "zone",
]);

const ACTION_KEYS = new Set(["action", "service", "perform_action"]);
const SKIPPED_KEYS = new Set([...ACTION_KEYS, "alias", "description", "id"]);

const isObject = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === "object" && !Array.isArray(v);
const isTemplate = (s: string) => s.includes("{{") || s.includes("{%");

const STATE_PARTS = ["state", "attributes", "last_changed", "last_updated", "last_reported", "entity_id", "domain", "object_id", "name", "context"];
const TOKEN = new RegExp(
  `(?<![A-Za-z0-9_.])([a-z][a-z0-9_]*)\\.([a-z0-9_]+)(?![A-Za-z0-9_])(?!\\()(?!\\.(?!(?:${STATE_PARTS.join("|")})(?![A-Za-z0-9_])))`,
  "g",
);
const STATES_TOKEN = new RegExp(
  `(?<![A-Za-z0-9_.])states\\.([a-z][a-z0-9_]*)\\.([a-z0-9_]+)(?![A-Za-z0-9_])(?!\\.(?!(?:${STATE_PARTS.join("|")})(?![A-Za-z0-9_])))`,
  "g",
);
const PLAIN_ID = /^[a-z][a-z0-9_]*\.[a-z0-9_]+$/;

// The entity ids in one string, given the domains that count.
export function idsInString(s: string, domains: ReadonlySet<string>): string[] {
  if (isTemplate(s)) {
    const out = new Set<string>();
    for (const m of s.matchAll(STATES_TOKEN)) if (domains.has(m[1])) out.add(`${m[1]}.${m[2]}`);
    for (const m of s.matchAll(TOKEN)) if (domains.has(m[1]) && m[1] !== "states") out.add(`${m[1]}.${m[2]}`);
    return [...out];
  }
  const words = s.split(/[\s,]+/).filter(Boolean);
  if (words.length === 0 || !words.every((w) => PLAIN_ID.test(w) && domains.has(w.slice(0, w.indexOf("."))))) return [];
  return [...new Set(words)];
}

// Every entity id a config uses, wherever it sits (values, lists, object keys).
export function entityIdsIn(config: unknown, domains: ReadonlySet<string>): Set<string> {
  const out = new Set<string>();
  const add = (s: string) => {
    for (const id of idsInString(s, domains)) out.add(id);
  };
  const walk = (v: unknown, key?: string) => {
    if (typeof v === "string") {
      if (key === undefined || !SKIPPED_KEYS.has(key)) add(v);
    } else if (Array.isArray(v)) {
      for (const x of v) walk(x, key);
    } else if (isObject(v)) {
      for (const [k, x] of Object.entries(v)) {
        add(k);
        walk(x, k);
      }
    }
  };
  walk(config);
  return out;
}

// ---------------------------------------------------------------------------
// Services.
// ---------------------------------------------------------------------------

// What a service call points at, as written. Ids are the plain entity ids named;
// areas, floors, labels and devices are named too and the caller resolves them.
// `dynamic` is true when part of the target is a template or "all": the call may
// reach anything, so a check that needs to be sure has to stand back.
export type ServiceCall = {
  service: string;
  entityIds: string[];
  areaIds: string[];
  floorIds: string[];
  labelIds: string[];
  deviceIds: string[];
  dynamic: boolean;
};

// A list written as a list or as a comma-separated string. A template is not a
// list of anything (it is worked out when the call runs), so it gives nothing.
const asList = (v: unknown): string[] => {
  const items = typeof v === "string" ? v.split(",") : Array.isArray(v) ? v : [];
  return items
    .filter((x): x is string => typeof x === "string")
    .map((x) => x.trim())
    .filter((x) => x && !isTemplate(x));
};

// Every string a target field holds, as written.
const written = (v: unknown): string[] => (typeof v === "string" ? [v] : Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

const TARGET_KEYS = ["entity_id", "area_id", "floor_id", "label_id", "device_id"];

// Every service call in a config: an object with an `action` (or the older
// `service`) that names a service. The target is read from `target`, from `data`
// and from the call itself, which is where older configs put an `entity_id`.
export function serviceCalls(config: unknown): ServiceCall[] {
  const out: ServiceCall[] = [];
  const visit = (v: unknown) => {
    if (Array.isArray(v)) {
      for (const x of v) visit(x);
      return;
    }
    if (!isObject(v)) return;
    const name = ["action", "service", "perform_action"].map((k) => v[k]).find((x): x is string => typeof x === "string" && PLAIN_ID.test(x));
    if (name) {
      const places = [v, isObject(v.data) ? v.data : {}, isObject(v.target) ? v.target : {}];
      const pick = (key: string) => places.flatMap((p) => asList(p[key]));
      out.push({
        service: name,
        entityIds: pick("entity_id").filter((id) => PLAIN_ID.test(id)),
        areaIds: pick("area_id"),
        floorIds: pick("floor_id"),
        labelIds: pick("label_id"),
        deviceIds: pick("device_id"),
        dynamic: TARGET_KEYS.some((k) => places.some((p) => written(p[k]).some((x) => isTemplate(x) || x === "all"))),
      });
    }
    for (const x of Object.values(v)) visit(x);
  };
  visit(config);
  return out;
}

// ---------------------------------------------------------------------------
// Conditions.
// ---------------------------------------------------------------------------

export type ConditionUse = {
  condition: "state" | "numeric_state";
  // The entities the condition tests, and the entities named as its limits.
  entityIds: string[];
  limitIds: string[];
  above: unknown;
  below: unknown;
};

const toUse = (c: Record<string, unknown>, domains: ReadonlySet<string>): ConditionUse | null => {
  if (c.condition !== "state" && c.condition !== "numeric_state") return null;
  const ids = (v: unknown) => asList(v).flatMap((s) => idsInString(s, domains));
  return { condition: c.condition, entityIds: ids(c.entity_id), limitIds: [...ids(c.above), ...ids(c.below)], above: c.above, below: c.below };
};

const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : v === undefined || v === null ? [] : [v]);

// The state and numeric_state conditions that gate a whole automation or script:
// the top-level conditions of an automation (and inside an `and`), and the
// condition steps at the top of a script's sequence. A condition inside `or`,
// `not`, `if` or `choose` only picks a branch, so one that fails there does not
// stop the run; those are not in this list.
export function gatingConditions(config: unknown, domains: ReadonlySet<string>): ConditionUse[] {
  if (!isObject(config)) return [];
  const out: ConditionUse[] = [];
  const take = (c: unknown) => {
    if (!isObject(c)) return;
    if (c.condition === "and") for (const x of asArray(c.conditions)) take(x);
    const use = toUse(c, domains);
    if (use) out.push(use);
  };
  for (const c of asArray(config.conditions ?? config.condition)) take(c);
  for (const step of asArray(config.sequence)) take(step);
  return out;
}

// Every state condition, wherever it sits.
export function stateConditions(config: unknown, domains: ReadonlySet<string>): ConditionUse[] {
  const out: ConditionUse[] = [];
  const visit = (v: unknown) => {
    if (Array.isArray(v)) {
      for (const x of v) visit(x);
    } else if (isObject(v)) {
      const use = toUse(v, domains);
      if (use?.condition === "state") out.push(use);
      for (const x of Object.values(v)) visit(x);
    }
  };
  visit(config);
  return out;
}

const num = (v: unknown): number | null => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && !isTemplate(v) && Number.isFinite(Number(v))) return Number(v);
  return null;
};

// A numeric condition whose limits leave no number that passes: above 30 and
// below 20. Returns the two limits, or null.
export function emptyRange(c: ConditionUse): { above: number; below: number } | null {
  if (c.condition !== "numeric_state") return null;
  const above = num(c.above);
  const below = num(c.below);
  return above !== null && below !== null && above >= below ? { above, below } : null;
}

// ---------------------------------------------------------------------------
// Devices.
// ---------------------------------------------------------------------------

export type DeviceUse = { deviceId: string; section: "triggers" | "conditions" | "actions" };

const SECTION: Record<string, DeviceUse["section"]> = {
  triggers: "triggers",
  trigger: "triggers",
  conditions: "conditions",
  condition: "conditions",
  actions: "actions",
  action: "actions",
  sequence: "actions",
};

// The devices a config names by id: a trigger, condition or action of the device
// kind (a `device_id` with a `domain` and a `type`), or the device a service call
// targets. Found inside the triggers, conditions and actions (or a script's
// sequence) only. The inputs of a blueprint are not read.
export function deviceUses(config: unknown): DeviceUse[] {
  if (!isObject(config)) return [];
  const out: DeviceUse[] = [];
  const visit = (v: unknown, section: DeviceUse["section"] | null) => {
    if (Array.isArray(v)) {
      for (const x of v) visit(x, section);
    } else if (isObject(v)) {
      if (section && v.device_id !== undefined) for (const id of asList(v.device_id)) out.push({ deviceId: id, section });
      for (const [k, x] of Object.entries(v)) {
        if (k === "use_blueprint") continue;
        if (k === "target" && isObject(x)) {
          if (section) for (const id of asList(x.device_id)) out.push({ deviceId: id, section });
          continue;
        }
        visit(x, section ?? (Object.hasOwn(SECTION, k) ? SECTION[k] : null));
      }
    }
  };
  visit(config, null);
  return out;
}

// ---------------------------------------------------------------------------
// Targets written as "all".
// ---------------------------------------------------------------------------

// The services of the calls that target every entity of their domain with a
// literal `entity_id: all` (`light.turn_off` with `entity_id: all`). serviceCalls
// drops "all" from the ids and marks the call dynamic; this tells which calls it was.
export function allTargetServices(config: unknown): string[] {
  const out: string[] = [];
  const visit = (v: unknown) => {
    if (Array.isArray(v)) {
      for (const x of v) visit(x);
      return;
    }
    if (!isObject(v)) return;
    const name = ["action", "service", "perform_action"].map((k) => v[k]).find((x): x is string => typeof x === "string" && PLAIN_ID.test(x));
    if (name) {
      const places = [v, isObject(v.data) ? v.data : {}, isObject(v.target) ? v.target : {}];
      if (places.some((p) => written(p.entity_id).some((x) => x.trim() === "all"))) out.push(name);
    }
    for (const x of Object.values(v)) visit(x);
  };
  visit(config);
  return out;
}
