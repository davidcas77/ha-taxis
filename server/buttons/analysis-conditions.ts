import { buttonRecord } from "../../shared/buttons.ts";

export const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : v == null ? [] : [v]);
export const strings = (v: unknown): string[] => list(v).filter((x): x is string => typeof x === "string");
export const entityPattern = /^[a-z][a-z0-9_]*\.[a-z0-9_]{1,128}$/;

type Truth = boolean | null;
type StateLimit = { key: string; values: string[]; negated: boolean };
export type Guard = { text: string; truth: Truth; limits: StateLimit[]; opaque?: boolean };
export type PressFacts = { triggerIds: string[]; entityId?: string; type?: string; eventAttribute?: boolean };
type ConditionContext = { facts: PressFacts | null; name: (id: string) => string };

const staticToken = /^[a-zA-Z][a-zA-Z0-9_ -]{0,47}$/;
const ordinaryStates = new Set([
  "on",
  "off",
  "open",
  "closed",
  "opening",
  "closing",
  "locked",
  "unlocked",
  "playing",
  "paused",
  "idle",
  "home",
  "not_home",
  "unknown",
  "unavailable",
]);
const boolAnd = (guards: Guard[]) => (guards.some((g) => g.truth === false) ? false : guards.every((g) => g.truth === true) ? true : null);
const boolOr = (guards: Guard[]) => (guards.some((g) => g.truth === true) ? true : guards.every((g) => g.truth === false) ? false : null);
const negate = (v: Truth) => (v === null ? null : !v);
const knownDuration = (v: unknown) => (typeof v === "string" && /^-?\d{1,3}:\d{2}(:\d{2})?$/.test(v) ? v : null);
const knownNumber = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= 1e8 ? v : null);

export function negateGuards(guards: Guard[]): Guard {
  return {
    text: guards.length > 1 ? `Unless all of these pass: ${guards.map((g) => g.text).join("; ")}` : `Unless: ${guards[0]?.text ?? "unconditional path"}`,
    truth: negate(boolAnd(guards)),
    limits: guards.length === 1 && guards[0].limits.length === 1 ? [{ ...guards[0].limits[0], negated: !guards[0].limits[0].negated }] : [],
    opaque: guards.some((g) => g.opaque),
  };
}

export function conditions(value: unknown, context: ConditionContext, depth = 0, budget = { remaining: 48 }): Guard[] {
  if (depth >= 4) return [{ text: "More nested conditions were not read.", truth: null, limits: [], opaque: true }];
  const items = list(value);
  const guards: Guard[] = [];
  let examined = 0;
  for (const raw of items.slice(0, 8)) {
    if (budget.remaining <= 0) break;
    examined++;
    budget.remaining--;
    if (!buttonRecord(raw) || raw.enabled !== false) guards.push(condition(raw, context, depth, budget));
  }
  if (items.length > examined) guards.push({ text: "Additional conditions were omitted.", truth: null, limits: [], opaque: true });
  return guards;
}

function condition(raw: unknown, context: ConditionContext, depth: number, budget: { remaining: number }): Guard {
  const { facts, name } = context;
  const opaque = (text: string): Guard => ({ text, truth: null, limits: [], opaque: true });
  const describe = (text: string): Guard => ({ text, truth: null, limits: [] });
  if (!buttonRecord(raw)) return opaque(typeof raw === "string" ? "Template condition (contents withheld)." : "Unrecognized condition.");
  if (raw.enabled !== undefined && raw.enabled !== true) return opaque("Condition with a dynamic enabled setting.");
  const kind = raw.condition;
  if (kind === "and" || kind === "or" || kind === "not") {
    const nested = conditions(raw.conditions, context, depth + 1, budget);
    if (!nested.length) return opaque("Empty logical condition.");
    const joined = nested.map((g) => g.text).join("; ");
    if (kind === "not") {
      const limit = nested.length === 1 && nested[0].limits.length === 1 ? nested[0].limits[0] : null;
      return {
        text: `None of these: ${joined}`,
        truth: negate(boolOr(nested)),
        limits: limit ? [{ ...limit, negated: !limit.negated }] : [],
        opaque: nested.some((g) => g.opaque),
      };
    }
    return {
      text: `${kind === "and" ? "All" : "Any"} of these: ${joined}`,
      truth: kind === "and" ? boolAnd(nested) : boolOr(nested),
      limits: kind === "and" ? nested.flatMap((g) => g.limits) : [],
      opaque: nested.some((g) => g.opaque),
    };
  }
  const ids = strings(raw.entity_id)
    .filter((id) => entityPattern.test(id))
    .slice(0, 5);
  const subjects = ids.map(name).join(", ") || "Configured target";
  if (kind === "trigger") {
    const accepted = list(raw.id)
      .filter((id) => typeof id === "string" || typeof id === "number")
      .map(String);
    const matched = facts?.triggerIds ?? [];
    const truth =
      matched.length && accepted.length
        ? matched.every((id) => accepted.includes(id))
          ? true
          : matched.every((id) => !accepted.includes(id))
            ? false
            : null
        : null;
    return {
      text:
        truth === true ? "On this Home Assistant trigger" : truth === false ? "On another Home Assistant trigger" : "Only for selected Home Assistant triggers",
      truth,
      limits: [],
    };
  }
  if (kind === "state") {
    const states = strings(raw.state).slice(0, 12);
    const isKnown = states.length > 0 && list(raw.state).length === states.length && states.every((state) => staticToken.test(state));
    const attribute = typeof raw.attribute === "string" ? raw.attribute : undefined;
    const press = Boolean(facts?.type && ids.length === 1 && ids[0] === facts.entityId && (facts.eventAttribute ? attribute === "event_type" : !attribute));
    const truth = press && isKnown && raw.for === undefined ? states.includes(facts!.type!) : null;
    const display =
      states.length && states.every((state) => ordinaryStates.has(state)) ? states.join(" or ") : press ? "the configured press type" : "a configured value";
    const attrLabel = attribute === "event_type" ? " press type" : attribute ? " attribute" : "";
    const limits =
      isKnown &&
      ids.length === 1 &&
      list(raw.entity_id).length === 1 &&
      raw.for === undefined &&
      (raw.attribute === undefined || (attribute && staticToken.test(attribute)))
        ? [{ key: `${ids[0]}:${attribute ?? ""}`, values: states, negated: false }]
        : [];
    return { text: `${subjects}${attrLabel} is ${display}${raw.for === undefined ? "" : " for a configured duration"}`, truth, limits, opaque: !isKnown };
  }
  if (kind === "numeric_state") {
    if (raw.value_template !== undefined) return opaque(`Template-based numeric condition for ${subjects} (template withheld).`);
    const describeLimit = (value: unknown) =>
      knownNumber(value) ?? (typeof value === "string" && entityPattern.test(value) ? name(value) : "a configured limit");
    const limits = [
      raw.above === undefined ? "" : `above ${describeLimit(raw.above)}`,
      raw.below === undefined ? "" : `below ${describeLimit(raw.below)}`,
    ].filter(Boolean);
    return describe(`Numeric state of ${subjects}${limits.length ? ` is ${limits.join(" and ")}` : ""}`);
  }
  if (kind === "time" || kind === "sun") {
    const boundary = (value: unknown) => {
      if (kind === "sun" && (value === "sunrise" || value === "sunset")) return value;
      return knownDuration(value) ?? (typeof value === "string" && entityPattern.test(value) ? name(value) : "a configured boundary");
    };
    const test = ["after", "before"].flatMap((key) =>
      raw[key] === undefined
        ? []
        : [`${key} ${boundary(raw[key])}${kind === "sun" && knownDuration(raw[`${key}_offset`]) ? ` (offset ${knownDuration(raw[`${key}_offset`])})` : ""}`],
    );
    const days = strings(raw.weekday).filter((day) => /^(mon|tue|wed|thu|fri|sat|sun)$/.test(day));
    if (days.length) test.push(`on ${days.join(", ")}`);
    return describe(`${kind === "sun" ? "Sun" : "Time"} condition${test.length ? ` ${test.join(" and ")}` : ""}`);
  }
  if (kind === "template") return opaque("Template condition (contents withheld).");
  if (kind === "device") return opaque("Integration device condition (details depend on the device).");
  if (kind === "zone") return opaque("Location condition (details withheld).");
  return opaque("Unresolved Home Assistant condition.");
}

export function incompatible(left: Guard[], right: Guard[]): boolean {
  const limits = [...left, ...right].flatMap((g) => g.limits);
  return limits.some((limit) => {
    if (limit.negated) return false;
    const compare = limits.filter((candidate) => candidate.key === limit.key);
    return !limit.values.some((value) => compare.every((candidate) => candidate.negated !== candidate.values.includes(value)));
  });
}
