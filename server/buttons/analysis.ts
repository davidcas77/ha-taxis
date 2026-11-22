import { matchEventReceivedTrigger, normalizeTrigger } from "../../shared/button-match.ts";
import {
  buttonRecord,
  type ButtonAiPreview,
  type ButtonAnalysis,
  type ButtonAnalysisHandler,
  type ButtonAnalysisOverlap,
  type ButtonControl,
  type ButtonGesture,
  type ButtonGestureAnalysis,
} from "../../shared/buttons.ts";
import type { Hierarchy } from "../../shared/types.ts";
import { AQARA_H2_EVENT_CONDITION, aqaraH2LightInputs, aqaraH2RouterMatch } from "./aqara-h2-router.ts";
import { conditions, incompatible, list, strings, type PressFacts } from "./analysis-conditions.ts";
import { createReferenceRead, inspectActions, type ActionEvidence, type ReadContext } from "./analysis-actions.ts";
import { buttonHash } from "./identity.ts";
import type { ButtonEvidence, ButtonRead } from "./discovery.ts";

const MAX_GESTURES = 50;
const MAX_HANDLERS = 8;
const MAX_CANDIDATES = 1500;
const MAX_RELATED = 12;
const MAX_PREVIEW = 28_000;
const has = (v: object, key: string) => Object.hasOwn(v, key);

type AnalysisRead = ButtonRead & { h: Hierarchy };
type Match = { level: "exact" | "possible"; facts: PressFacts | null; note?: string; disabled?: boolean };
type Handler = { display: ButtonAnalysisHandler; actions: ActionEvidence[]; mayRun: boolean; filtered: boolean };
type Candidate = { config: ButtonEvidence; match: Match; routerActions?: readonly unknown[] };

function selectorCoversEntity(target: Record<string, unknown>, source: string, h: Hierarchy): boolean {
  const entity = h.entities[source];
  if (!entity) return false;
  const area = entity.areaId ? h.areas[entity.areaId] : undefined;
  const device = entity.deviceId ? h.devices[entity.deviceId] : undefined;
  const labels = new Set([...entity.labels, ...(area?.labels ?? []), ...(device?.labels ?? [])]);
  return Boolean(
    (device && strings(target.device_id).includes(device.id)) ||
    (area && strings(target.area_id).includes(area.id)) ||
    (area?.floorId && strings(target.floor_id).includes(area.floorId)) ||
    strings(target.label_id).some((id) => labels.has(id)),
  );
}

function staticMatch(config: Record<string, unknown>, gesture: ButtonGesture, h: Hierarchy): Match | null {
  const sourceId = gesture.enumSensor ?? gesture.eventEntity;
  const type = gesture.enumSensor ? String(gesture.trigger.to) : gesture.eventType;
  const candidates = list(config.triggers ?? config.trigger)
    .slice(0, 80)
    .flatMap((raw, index) => {
      const trigger = normalizeTrigger(raw);
      if (!trigger || !buttonRecord(raw)) return [];
      const id = typeof raw.id === "string" || typeof raw.id === "number" ? String(raw.id) : String(index);
      let level: Match["level"] | null = null;
      if (gesture.trigger.platform === "device") {
        if (trigger.platform === "device" && ["device_id", "domain", "type", "subtype"].every((key) => trigger[key] === gesture.trigger[key])) level = "exact";
      } else if (sourceId && type && trigger.platform === "event.received" && buttonRecord(trigger.target)) {
        const excluded = buttonRecord(trigger.target.exclude) && selectorCoversEntity(trigger.target.exclude, sourceId, h);
        if (!excluded) level = matchEventReceivedTrigger(trigger, sourceId, type, selectorCoversEntity(trigger.target, sourceId, h));
      } else if (sourceId && trigger.platform === "state" && strings(trigger.entity_id).includes(sourceId)) {
        const sourceAttribute = gesture.enumSensor ? undefined : "event_type";
        if (!type) level = trigger.attribute === undefined && trigger.to === undefined ? "exact" : "possible";
        else if (trigger.attribute === sourceAttribute && strings(trigger.to).includes(type)) level = "exact";
        else if (trigger.attribute !== sourceAttribute || trigger.to === undefined || (typeof trigger.to === "string" && trigger.to.includes("{")))
          level = "possible";
      } else if (sourceId && trigger.platform === "template" && typeof trigger.value_template === "string" && trigger.value_template.includes(sourceId)) {
        level = "possible";
      }
      if (!level) return [];
      const options = buttonRecord(trigger.options) ? trigger.options : {};
      const filtered =
        ["from", "not_from", "not_to", "for", "variables"].some((key) => has(trigger, key)) ||
        has(options, "for") ||
        (options.behavior !== undefined && options.behavior !== "each");
      if (raw.enabled !== undefined && raw.enabled !== true && raw.enabled !== false) level = "possible";
      return [{ id, level, filtered, disabled: raw.enabled === false }];
    });
  if (!candidates.length) return null;
  const active = candidates.filter((t) => !t.disabled);
  const matched = active.length ? active : candidates;
  const exact = matched.some((t) => t.level === "exact");
  return {
    level: exact ? "exact" : "possible",
    facts: { triggerIds: matched.map((t) => t.id), entityId: sourceId, type, eventAttribute: Boolean(gesture.eventType && !gesture.enumSensor) },
    disabled: !active.length,
    note: !active.length
      ? "All matching triggers are disabled."
      : matched.some((t) => t.filtered)
        ? "A matching trigger has additional filters or timing rules."
        : !exact
          ? "The trigger is broad or templated. Conditions may select this press."
          : undefined,
  };
}

function overlaps(handlers: Handler[], ctx: ReadContext): ButtonAnalysisOverlap[] {
  const out = new Map<string, ButtonAnalysisOverlap>();
  const involved = handlers.filter((handler) => handler.display.enabled === true && handler.mayRun);
  for (const [i, a] of involved.entries()) {
    for (const b of involved.slice(i + 1)) {
      const handlerIds = [a.display.id, b.display.id];
      for (const left of a.actions)
        for (const right of b.actions) {
          if (incompatible(left.guards, right.guards)) continue;
          for (const x of left.hits) {
            const y = right.hits.find((hit) => hit.id === x.id);
            if (!y) continue;
            const key = JSON.stringify([x.id, ...handlerIds]);
            const old = out.get(key);
            const opposing = (x.operation === "on" && y.operation === "off") || (x.operation === "off" && y.operation === "on");
            const conditional =
              a.display.match !== "exact" ||
              b.display.match !== "exact" ||
              a.filtered ||
              b.filtered ||
              !!(left.guards.length || right.guards.length) ||
              left.value.uncertain ||
              right.value.uncertain;
            if (!old || (opposing && old.kind === "shared") || (opposing === (old.kind === "opposing") && !conditional && old.conditional)) {
              out.set(key, { target: { id: x.id, name: ctx.name(x.id) }, handlers: handlerIds, kind: opposing ? "opposing" : "shared", conditional });
            }
          }
        }
    }
  }
  return [...out.values()].slice(0, 15);
}

function plain(s: unknown, limit = 112): string {
  return typeof s === "string"
    ? s
        .replace(/[\x00-\x1f\x7f]/g, " ")
        .trim()
        .slice(0, limit)
    : "";
}

const status = (handler: Candidate) => Number(handler.config.enabled !== true) * 2 + Number(handler.match.level !== "exact");
type BuildResult = { analysis: ButtonAnalysis; count: number };

export async function buildButtonAnalysis(
  control: ButtonControl,
  read: AnalysisRead,
  redact: (text: string) => string = (s) => s,
  idLabel?: (rawId: string) => string,
): Promise<BuildResult> {
  const clean = (v: unknown, max = 112) => plain(redact(plain(v, 1024)), max);
  const identifier = (id: string, max = 160) => (idLabel ? idLabel(id) : clean(id, max));
  const ctx: ReadContext = {
    h: read.h,
    reference: createReferenceRead(read.readReference),
    name: (id) => (/^(person|device_tracker|input_text|text)\./.test(id) ? "Private entity" : clean(read.h.entities[id]?.name ?? id)),
  };
  const configs = read.evidence.slice(0, MAX_CANDIDATES);
  const byId = new Map(configs.map((config) => [config.id, config]));
  const managed = new Map(read.inventory.managed.map((m) => [m.id, m.map]));
  const seen = new Set<string>();
  const notes = new Set([
    "This is stored configuration evidence. No press was simulated and no execution was observed.",
    "Only gestures exposed by Home Assistant are shown. Templates, external controllers and unreadable YAML may hide other behavior.",
    "Shared-output findings compare different enabled handlers for the same press. Conditions and branch choices can prevent actions from running together.",
  ]);
  for (const note of control.notes.slice(0, 6)) if (plain(note)) notes.add(clean(note, 240));
  if (read.inventory.coverage.unreadable) notes.add("Home Assistant did not expose every automation configuration. The mapping is incomplete.");
  if (read.evidence.length > configs.length) notes.add("The automation inspection limit was reached.");
  if (control.gestures.length > MAX_GESTURES) notes.add("Some gestures were omitted by the review limit.");

  const handlerFor = async (candidate: Candidate, gesture?: ButtonGesture): Promise<Handler> => {
    const a = candidate.config;
    const map = managed.get(a.id);
    const match = candidate.match;
    const config = a.config ?? {};
    const router = candidate.routerActions;
    const bindings = map?.bindings.filter((b) => b.controlId === control.id && b.gestureKey === gesture?.key) ?? [];
    const handbook = new Set<string>();
    if (match.note) handbook.add(match.note);
    const isBlueprint = config.use_blueprint !== undefined && !router;
    if (isBlueprint) handbook.add("Only a blueprint input reference was identified. The blueprint’s press logic and actions were not read.");
    const top = map ? [] : conditions(config.conditions ?? config.condition, { facts: match.facts, name: ctx.name });
    if (router) top.unshift({ text: AQARA_H2_EVENT_CONDITION, truth: null, limits: [] });
    const managedActions = bindings
      .filter((b) => b.enabled)
      .map((b) => ({
        action: b.action.service,
        ...(b.action.entityId && { target: { entity_id: b.action.entityId } }),
        data: b.action.data,
      }));
    if (map && bindings.some((b) => !b.enabled)) handbook.add("A managed binding for this press is disabled.");
    const steps = router ?? (map ? managedActions : (config.actions ?? config.action));
    const inspect = !match.disabled && !isBlueprint && !!a.config;
    const result = inspect
      ? await inspectActions(steps, top, match.facts, router ? { ...ctx, actionInputs: aqaraH2LightInputs, preferConfiguredTargets: true } : ctx)
      : { actions: [], notes: [] };
    for (const note of result.notes) handbook.add(note);
    if (inspect && !result.actions.length && !handbook.size) handbook.add("No readable action was found for this press.");
    if (a.enabled === null) handbook.add("Home Assistant did not report whether this automation is enabled.");
    const actions = result.actions.map((action) => ({
      ...action,
      value: {
        ...action.value,
        service: clean(action.value.service),
        targets: action.value.targets.map((target) => ({ id: identifier(target.id), name: clean(target.name) })),
        conditions: action.value.conditions.slice(0, 10).map((text) => clean(text, 220)),
        branches: action.value.branches.slice(0, 6),
        via: action.value.via.slice(0, 4).map((text) => clean(text)),
      },
    }));
    return {
      display: {
        id: identifier(a.id),
        name: clean(a.name) || "Unnamed automation",
        enabled: a.enabled,
        match: match.level,
        managed: !!map,
        conditions: top.map((guard) => clean(guard.text, 220)),
        actions: actions.map((a) => a.value),
        notes: [...handbook],
      },
      actions,
      mayRun: !match.disabled && !top.some((guard) => guard.truth === false),
      filtered: Boolean(match.note),
    };
  };

  const gestures: ButtonGestureAnalysis[] = [];
  for (const g of control.gestures.slice(0, MAX_GESTURES)) {
    const existing = new Set((control.existing[g.key] ?? []).map((handler) => handler.id));
    const candidates = configs
      .flatMap((a): Candidate[] => {
        const map = managed.get(a.id);
        if (map) {
          const bound = map.bindings.filter((binding) => binding.controlId === control.id && binding.gestureKey === g.key);
          return bound.length ? [{ config: a, match: { level: "exact", facts: null, disabled: bound.every((binding) => !binding.enabled) } }] : [];
        }
        if (!a.config) return [];
        const router = aqaraH2RouterMatch(a.config, g, read.aqaraH2RouterVerified === true);
        if (router !== undefined)
          return router
            ? [
                {
                  config: a,
                  ...(router.level === "exact" && { routerActions: router.actions }),
                  match: { level: router.level, facts: null, note: router.note },
                },
              ]
            : [];
        const match = staticMatch(a.config, g, read.h);
        if (match) return [{ config: a, match }];
        if (existing.has(a.id))
          return [{ config: a, match: { level: "possible", facts: null, note: "The press association could not be established from a literal trigger." } }];
        return [];
      })
      .sort((a, b) => status(a) - status(b));
    if (candidates.length > MAX_HANDLERS) notes.add("Some gesture handlers were omitted by the review limit.");
    for (const candidate of candidates) seen.add(candidate.config.id);
    const handlers: Handler[] = [];
    for (const candidate of candidates.slice(0, MAX_HANDLERS)) handlers.push(await handlerFor(candidate, g));
    if (handlers.some((handler) => handler.display.match === "possible" && !handler.actions.length))
      notes.add("Possible references with unknown actions were not treated as confirmed output matches.");
    gestures.push({
      key: identifier(g.key, 180),
      button: clean(g.button),
      gesture: clean(g.gesture),
      source: clean(g.source),
      handlers: handlers.map((handler) => handler.display),
      overlaps: overlaps(handlers, ctx).map((overlap) => ({ ...overlap, target: { id: identifier(overlap.target.id), name: clean(overlap.target.name) } })),
    });
  }
  const related: ButtonAnalysisHandler[] = [];
  const linked = (control.related ?? []).filter((reference) => !seen.has(reference.id));
  if (linked.length > MAX_RELATED) notes.add("Some device-level references were omitted by the review limit.");
  for (const item of linked.slice(0, MAX_RELATED)) {
    const config = byId.get(item.id);
    if (!config) continue;
    const candidate = await handlerFor({
      config,
      match: {
        level: "possible",
        facts: null,
        note: "This may refer to the control, but no particular press could be established.",
      },
    });
    related.push(candidate.display);
  }
  return {
    analysis: {
      control: { name: clean(control.name), integrations: control.integrations.slice(0, 12).map((value) => clean(value)) },
      coverage: read.inventory.coverage,
      gestures,
      related,
      notes: [...notes],
    },
    count: seen.size,
  };
}

type FullPreview = ButtonAiPreview & { analysis: ButtonAnalysis };
export async function buttonAnalysisPreview(control: ButtonControl, read: AnalysisRead, redact: (text: string) => string): Promise<FullPreview> {
  const { analysis, count } = await buildButtonAnalysis(control, read, redact);
  let content = JSON.stringify(analysis, null, 2);
  if (content.length > MAX_PREVIEW) {
    const outbound = structuredClone(analysis);
    analysis.notes.push("The AI preview was shortened. The local mapping includes additional evidence.");
    outbound.notes.push("Evidence was shortened to fit the AI preview. Some local details are omitted.");
    content = JSON.stringify(outbound);
    for (const cap of [8, 4, 2, 1, 0]) {
      if (content.length <= MAX_PREVIEW) break;
      for (const gesture of outbound.gestures) for (const handler of gesture.handlers) handler.actions = handler.actions.slice(0, cap);
      for (const handler of outbound.related) handler.actions = handler.actions.slice(0, cap);
      content = JSON.stringify(outbound);
    }
    while (content.length > MAX_PREVIEW && outbound.related.length) {
      outbound.related.pop();
      content = JSON.stringify(outbound);
    }
    while (content.length > MAX_PREVIEW && outbound.gestures.some((g) => g.handlers.length > 1)) {
      for (const gesture of outbound.gestures) {
        if (gesture.handlers.length > 1) gesture.handlers.pop();
        const ids = new Set(gesture.handlers.map((handler) => handler.id));
        gesture.overlaps = gesture.overlaps.filter((overlap) => overlap.handlers.every((id) => ids.has(id)));
      }
      content = JSON.stringify(outbound);
    }
    while (content.length > MAX_PREVIEW && outbound.gestures.length) {
      outbound.gestures.pop();
      content = JSON.stringify(outbound);
    }
  }
  return { analysis, content, fingerprint: buttonHash(content), count };
}
