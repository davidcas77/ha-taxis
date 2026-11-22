import { BUTTON_SERVICE, buttonRecord, type ButtonAnalysisAction, type ButtonAnalysisTarget } from "../../shared/buttons.ts";
import type { Hierarchy } from "../../shared/types.ts";
import { conditions, entityPattern, list, negateGuards, strings, type Guard, type PressFacts } from "./analysis-conditions.ts";
import type { ButtonReferenceReader } from "./discovery.ts";

type Path = { guards: Guard[]; branches: string[]; via: string[]; stack: ReadonlySet<string>; facts: PressFacts | null };
type ActionHit = { id: string; operation: "on" | "off" | "other" };
export type ActionEvidence = { value: ButtonAnalysisAction; guards: Guard[]; hits: ActionHit[] };
export type ReadContext = {
  h: Hierarchy;
  reference: ButtonReferenceReader;
  name: (id: string) => string;
  actionInputs?: (step: Record<string, unknown>) => readonly string[];
  preferConfiguredTargets?: boolean;
};
type Walk = { ctx: ReadContext; actions: ActionEvidence[]; notes: Set<string>; remaining: number; branch: number };

const MAX_STEPS = 80;
const MAX_ACTIONS = 18;
const MAX_DEPTH = 9;
const MAX_TARGETS = 10;
const MAX_REFERENCES = 12;
const PRIVATE_DOMAINS = new Set(["person", "device_tracker", "input_text", "text"]);

export function createReferenceRead(source?: ButtonReferenceReader): ButtonReferenceReader {
  const reads = new Map<string, Promise<Record<string, unknown> | null>>();
  return (kind, id) => {
    const current = reads.get(id);
    if (current) return current;
    if (!source || reads.size >= MAX_REFERENCES) return Promise.resolve(null);
    const next = source(kind, id).catch(() => null);
    reads.set(id, next);
    return next;
  };
}

export async function inspectActions(raw: unknown, top: Guard[], facts: PressFacts | null, ctx: ReadContext) {
  const walk: Walk = { ctx, actions: [], notes: new Set(), remaining: MAX_STEPS, branch: 0 };
  if (top.some((guard) => guard.truth === false)) walk.notes.add("The readable top-level conditions exclude this press.");
  else await runSequence(raw, { guards: [], branches: [], via: [], stack: new Set(), facts }, walk, 0);
  if (top.some((guard) => guard.opaque)) walk.notes.add("One or more conditions could not be evaluated statically.");
  return { actions: walk.actions.map((action) => ({ ...action, guards: [...top, ...action.guards] })), notes: [...walk.notes] };
}

function emit(walk: Walk, path: Path, service: string, targets: ButtonAnalysisTarget[], hits: ActionHit[], uncertain: boolean, settings?: string[]) {
  if (walk.actions.length >= MAX_ACTIONS) {
    walk.notes.add("Additional actions were omitted.");
    return;
  }
  if (path.guards.some((guard) => guard.opaque)) walk.notes.add("One or more branch conditions could not be evaluated statically.");
  walk.actions.push({
    value: {
      service,
      targets,
      conditions: path.guards.map((guard) => guard.text),
      branches: path.branches,
      via: path.via,
      uncertain,
      ...(settings?.length ? { settings } : {}),
    },
    guards: path.guards,
    hits,
  });
}

type Flow = "continues" | "stops" | "conditional";
const guard = (text: string): Guard => ({ text, truth: null, limits: [] });
const flowThrough = (branches: Flow[]): Flow =>
  branches.length > 0 && branches.every((flow) => flow === "stops") ? "stops" : branches.some((flow) => flow !== "continues") ? "conditional" : "continues";

async function runSequence(raw: unknown, current: Path, walk: Walk, depth: number): Promise<Flow> {
  if (depth >= MAX_DEPTH) {
    walk.notes.add("A branch exceeded the inspection depth.");
    return "conditional";
  }
  let path = current;
  let mayStop = false;
  let maySkipSequence = false;
  const readConditions = (value: unknown) => conditions(value, { facts: path.facts, name: walk.ctx.name });
  for (const step of list(raw)) {
    if (walk.remaining-- <= 0 || walk.actions.length >= MAX_ACTIONS) {
      walk.notes.add("Additional steps were omitted.");
      return "conditional";
    }
    if (!buttonRecord(step)) {
      walk.notes.add("An action step could not be interpreted.");
      continue;
    }
    if (step.enabled === false) continue;
    const dynamicEnabled = step.enabled !== undefined && step.enabled !== true;
    const here = dynamicEnabled ? { ...path, guards: [...path.guards, guard("If this dynamically enabled step runs")] } : path;
    if (dynamicEnabled) walk.notes.add("An action has a dynamic enabled setting.");
    const branch = (value: unknown, guards: Guard[], label: string) =>
      runSequence(value, { ...here, guards: [...here.guards, ...guards], branches: [...here.branches, label] }, walk, depth + 1);
    let flow: Flow = "continues";
    if (typeof step.condition === "string") {
      const guards = readConditions(step);
      if (guards.some((condition) => condition.truth === false)) return mayStop ? "conditional" : "continues";
      if (guards.some((condition) => condition.truth === null)) maySkipSequence = true;
      path = { ...path, guards: [...path.guards, ...guards] };
      continue;
    }
    if (step.stop !== undefined) {
      flow = "stops";
    } else if (step.choose !== undefined) {
      const label = `Choose ${++walk.branch}`;
      const previous: Guard[] = [];
      const paths: Flow[] = [];
      let always = false;
      const choices = list(step.choose);
      for (const [index, option] of choices.slice(0, 8).entries()) {
        if (!buttonRecord(option)) {
          paths.push("conditional");
          continue;
        }
        const optionGuards = readConditions(option.conditions);
        if (optionGuards.some((condition) => condition.truth === false)) continue;
        paths.push(await branch(option.sequence, [...previous, ...optionGuards], `${label} · option ${index + 1}`));
        if (optionGuards.every((condition) => condition.truth === true)) {
          always = true;
          break;
        }
        previous.push(negateGuards(optionGuards));
      }
      if (!always) {
        if (choices.length > 8) {
          walk.notes.add("Additional choose options were omitted; the default path may depend on them.");
          paths.push("conditional");
          previous.push(guard("If no omitted option matches"));
        }
        paths.push(step.default === undefined ? "continues" : await branch(step.default, previous, `${label} · default`));
      }
      flow = flowThrough(paths);
    } else if (step.if !== undefined) {
      const label = `If ${++walk.branch}`;
      const guards = readConditions(step.if);
      const paths: Flow[] = [];
      if (!guards.some((condition) => condition.truth === false)) paths.push(await branch(step.then, guards, `${label} · then`));
      if (!guards.every((condition) => condition.truth === true))
        paths.push(step.else === undefined ? "continues" : await branch(step.else, [negateGuards(guards)], `${label} · else`));
      flow = flowThrough(paths);
    } else if (buttonRecord(step.repeat)) {
      const repeat = step.repeat;
      if (repeat.count === 0 || repeat.count === "0" || (Array.isArray(repeat.for_each) && !repeat.for_each.length)) continue;
      const guards = readConditions(repeat.while);
      const positive =
        (typeof repeat.count === "number" && repeat.count > 0) || (Array.isArray(repeat.for_each) && repeat.for_each.length > 0) || repeat.until !== undefined;
      const conditional = !positive && !guards.length;
      if (!guards.some((condition) => condition.truth === false)) {
        walk.notes.add("A repeated path depends on its count, items or conditions.");
        const result = await branch(
          repeat.sequence,
          [...guards, ...(conditional ? [guard("When the repetition has an iteration")] : [])],
          `Repeat ${++walk.branch}`,
        );
        flow = positive ? result : result === "continues" ? "continues" : "conditional";
        if (repeat.while !== undefined || repeat.until !== undefined || conditional) {
          path = { ...path, guards: [...path.guards, guard("If the repetition finishes")] };
        }
      }
    } else if (step.parallel !== undefined) {
      const paths: Flow[] = [];
      const entries = list(step.parallel);
      for (const entry of entries.slice(0, 8)) paths.push(await branch(entry, [], `Parallel path ${++walk.branch}`));
      if (entries.length > 8) walk.notes.add("Additional parallel paths were omitted.");
      if (paths.includes("stops")) flow = "stops";
      else if (paths.includes("conditional") || entries.length > 8) flow = "conditional";
    } else if (step.sequence !== undefined) {
      flow = await runSequence(step.sequence, here, walk, depth + 1);
    } else if (step.delay !== undefined || step.wait_for_trigger !== undefined || step.wait_template !== undefined) {
      walk.notes.add("A delay or wait can affect when subsequent actions run.");
      path = {
        ...path,
        facts: path.facts ? { triggerIds: path.facts.triggerIds } : null,
        guards: [...path.guards, guard("After a configured delay or wait")],
      };
      if (step.wait_for_trigger !== undefined || step.wait_template !== undefined) mayStop = true;
    } else if (step.variables !== undefined) {
      walk.notes.add("Configured variables are omitted. Actions that depend on them may be dynamic.");
    } else {
      await serviceAction(step, here, walk, depth);
    }
    if (flow === "stops" && !dynamicEnabled) {
      walk.notes.add("A configured Stop ends this path before later actions.");
      return maySkipSequence ? "conditional" : "stops";
    }
    if (flow !== "continues") {
      mayStop = true;
      path = { ...path, guards: [...path.guards, guard("If an earlier path did not stop the run")] };
      walk.notes.add("Later actions depend on whether an earlier path stops the run.");
    }
  }
  return mayStop ? "conditional" : "continues";
}

function targetsOf(step: Record<string, unknown>, service: string, h: Hierarchy): { ids: string[]; uncertain: boolean } {
  const target = buttonRecord(step.target) ? step.target : {};
  const data = buttonRecord(step.data) ? step.data : {};
  const parts = [step, target, data];
  const domain = service.split(".")[0];
  const allow = (id: string) => domain === "homeassistant" || id.startsWith(`${domain}.`) || id.startsWith("group.");
  const ids = new Set<string>();
  let uncertain = (step.target !== undefined && !buttonRecord(step.target)) || step.data_template !== undefined;
  for (const part of parts) {
    for (const id of list(part.entity_id).slice(0, MAX_TARGETS + 1)) {
      if (typeof id === "string" && entityPattern.test(id)) ids.add(id);
      else uncertain = true;
    }
    const add = (source: string[] | undefined) => {
      if (!source) {
        uncertain = true;
        return;
      }
      let max = 0;
      for (const id of source) {
        if (!allow(id) || h.entities[id]?.disabled) continue;
        if (++max > MAX_TARGETS) {
          uncertain = true;
          break;
        }
        ids.add(id);
      }
    };
    for (const id of strings(part.area_id).slice(0, MAX_TARGETS)) add(h.areas[id]?.entityIds);
    for (const id of strings(part.device_id).slice(0, MAX_TARGETS)) add(h.devices[id]?.entityIds);
    for (const id of strings(part.floor_id).slice(0, MAX_TARGETS)) {
      const floor = h.floors.find((f) => f.id === id);
      add(floor?.areaIds.flatMap((area) => h.areas[area]?.entityIds ?? []));
    }
    const labels = new Set(strings(part.label_id).slice(0, MAX_TARGETS));
    if (labels.size) {
      // Entity, device and area labels may each add targets. Service support
      // still varies by integration, so these are resolved candidates.
      const areas = Object.values(h.areas).filter((area) => area.labels.some((id) => labels.has(id)));
      const devices = Object.values(h.devices).filter((device) => device.labels.some((id) => labels.has(id)));
      add([
        ...areas.flatMap((area) => area.entityIds),
        ...devices.flatMap((device) => device.entityIds),
        ...Object.values(h.entities)
          .filter((entity) => entity.labels.some((id) => labels.has(id)))
          .map((entity) => entity.entityId),
      ]);
    }
    if (["area_id", "floor_id", "device_id", "label_id"].some((key) => part[key] !== undefined)) uncertain = true;
  }
  return { ids: [...ids].slice(0, MAX_TARGETS), uncertain: uncertain || ids.size > MAX_TARGETS };
}

function serviceSettings(value: unknown): string[] {
  if (!buttonRecord(value)) return [];
  const names = {
    brightness_pct: "Brightness (%)",
    color_temp_kelvin: "Color temperature (K)",
    transition: "Transition (s)",
    temperature: "Temperature",
    percentage: "Percentage",
    position: "Position (%)",
    volume_level: "Volume level",
  };
  return Object.entries(names).flatMap(([key, label]) => {
    const n = value[key];
    return typeof n === "number" && Number.isFinite(n) && Math.abs(n) <= 1e6 ? [`${label}: ${n}`] : [];
  });
}

const isPrivate = (id: string) => PRIVATE_DOMAINS.has(id.split(".")[0]);
const targetOf = (ctx: ReadContext, id: string): ButtonAnalysisTarget => ({ id, name: ctx.name(id) });
const opOf = (service: string) => (service.endsWith(".turn_on") ? "on" : service.endsWith(".turn_off") ? "off" : "other");
function affected(h: Hierarchy, ids: string[], service: string): { output: string[]; incomplete: boolean } {
  const domain = service.split(".")[0];
  const scope = domain === "homeassistant";
  const traversable =
    scope || ["light", "switch", "fan", "cover", "lock", "media_player", "climate", "valve", "scene", "script", "input_boolean"].includes(domain);
  if (!traversable) return { output: ids, incomplete: false };
  const visited = new Set<string>();
  const out = new Set<string>();
  let incomplete = false;
  const visit = (id: string, depth = 0) => {
    if (depth >= 5 || visited.size >= 35) {
      incomplete = true;
      return;
    }
    if (visited.has(id)) return;
    visited.add(id);
    const members = h.entities[id]?.members ?? [];
    if (!members.length) {
      out.add(id);
      return;
    }
    for (const member of members) if (scope || member.startsWith(`${domain}.`) || member.startsWith("group.")) visit(member, depth + 1);
  };
  ids.forEach((id) => visit(id));
  return { output: [...out].slice(0, MAX_TARGETS), incomplete: incomplete || out.size > MAX_TARGETS };
}

const CONTROLS_OUTPUT = new Set(["light", "switch", "fan", "cover", "lock", "media_player", "climate", "valve", "homeassistant", "input_boolean"]);

async function serviceAction(step: Record<string, unknown>, path: Path, walk: Walk, depth: number) {
  const { ctx } = walk;
  const raw = step.action ?? step.service;
  if (typeof raw !== "string" || !BUTTON_SERVICE.test(raw) || raw.length > 100) {
    const kind =
      raw !== undefined || step.service_template !== undefined
        ? "Dynamic service"
        : step.device_id !== undefined
          ? "Integration device action"
          : "Unresolved action";
    emit(walk, path, kind, [], [], true);
    walk.notes.add("Some actions have dynamic or integration-specific behavior that was not resolved.");
    return;
  }
  const service = raw;
  const { ids, uncertain } = targetsOf(step, service, ctx.h);
  const scope = service.split(".")[0];
  const operation = opOf(service);
  const group = affected(ctx.h, ids, service);
  const staticTargets = [...new Set([...ids, ...group.output])].filter((id) => !isPrivate(id)).slice(0, MAX_TARGETS);
  const refs =
    scope === "script" && !["script.turn_on", "script.turn_off", "script.toggle", "script.reload"].includes(service)
      ? [service]
      : service === "script.turn_on" || service === "scene.turn_on"
        ? group.output.filter((id) => id.startsWith(`${scope}.`))
        : [];
  const configuredInputs = !path.via.length ? (ctx.actionInputs?.(step) ?? []) : [];
  const configuredTargets = ctx.preferConfiguredTargets && ids.length > 0 ? ids.filter((id) => !isPrivate(id)) : staticTargets;
  const visibleTargets = [...new Set([...configuredInputs, ...(!configuredInputs.length && !configuredTargets.length ? refs : configuredTargets)])];
  const publicTargets = visibleTargets.slice(0, MAX_TARGETS).map((id) => targetOf(ctx, id));
  const hits: ActionHit[] = CONTROLS_OUTPUT.has(scope)
    ? group.output.filter((id) => !isPrivate(id) && ctx.h.entities[id] && !ctx.h.entities[id].disabled).map((id) => ({ id, operation }))
    : [];
  const dynamic = uncertain || group.incomplete || staticTargets.length < new Set([...ids, ...group.output]).size || visibleTargets.length > MAX_TARGETS;
  emit(walk, path, service, publicTargets, hits, dynamic, serviceSettings(step.data));
  if (dynamic) walk.notes.add("Some targets are dynamic, resolved only as candidates, private, or omitted by the read limit.");
  if (configuredInputs.length) {
    walk.notes.add("The displayed lights are script inputs. The script chooses what to do at runtime.");
    return;
  }
  if (
    ["automation.trigger", "scene.apply", "script.toggle", "homeassistant.toggle", "homeassistant.turn_on"].includes(service) &&
    (service.startsWith("automation.") ||
      service.startsWith("scene.") ||
      service.startsWith("script.") ||
      group.output.some((id) => /^(script|scene)\./.test(id)))
  ) {
    walk.notes.add("An action can activate configuration indirectly. Its effects were not expanded.");
  }
  if ((service === "scene.turn_on" || service === "script.turn_on") && !refs.length) {
    walk.notes.add("No static script or scene target could be resolved for an indirect action.");
  }
  for (const ref of refs.slice(0, 6)) {
    const kind = ref.startsWith("script.") ? "script" : "scene";
    if (path.stack.has(ref) || path.stack.size >= 4) {
      walk.notes.add("Script recursion or the reference-depth limit stopped expansion.");
      continue;
    }
    const config = await ctx.reference(kind, ref);
    if (!config) {
      walk.notes.add("A called script or scene could not be read, or the reference limit was reached.");
      continue;
    }
    const next = { ...path, facts: null, via: [...path.via, ctx.name(ref)], stack: new Set([...path.stack, ref]) };
    if (kind === "script") {
      if (config.use_blueprint || config.sequence === undefined) walk.notes.add("A script blueprint or unsupported script action was not expanded.");
      else await runSequence(config.sequence, next, walk, depth + 1);
    } else inspectScene(config, next, walk);
  }
}

function inspectScene(config: Record<string, unknown>, path: Path, walk: Walk) {
  if (!buttonRecord(config.entities)) {
    walk.notes.add("A scene was readable but did not expose a static entity list.");
    return;
  }
  const entries = Object.entries(config.entities);
  const known = entries.filter(([id]) => entityPattern.test(id) && !isPrivate(id)).slice(0, MAX_TARGETS);
  if (entries.length > known.length) walk.notes.add("Some scene targets were private, dynamic, or omitted.");
  for (const [id, value] of known) {
    const state = buttonRecord(value) ? value.state : value;
    const operation = state === "on" || state === "off" ? state : "other";
    const ids = affected(walk.ctx.h, [id], "homeassistant.turn_on").output;
    const hits = ids
      .filter((target) => !isPrivate(target) && walk.ctx.h.entities[target] && !walk.ctx.h.entities[target].disabled)
      .map((target) => ({ id: target, operation }) as const);
    const targets = [...new Set([id, ...ids])]
      .filter((target) => !isPrivate(target))
      .slice(0, MAX_TARGETS)
      .map((target) => targetOf(walk.ctx, target));
    emit(walk, path, "scene state", targets, hits, operation === "other", operation === "other" ? [] : [`State: ${operation}`]);
  }
}
