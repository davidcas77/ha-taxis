import type { MatrixCell } from "../../shared/button-matrix.ts";
import type { ButtonAnalysisHandler, ButtonExisting, ButtonGestureAnalysis, ButtonMapping } from "../../shared/buttons.ts";

type PressBinding = Pick<ButtonMapping, "action" | "enabled"> & {
  automationId: string;
  automationEnabled: boolean | null;
  queued: boolean;
  blocked: string | null;
};
type Handler = ButtonExisting | ButtonAnalysisHandler;
type DescribeAction = (service: string, targets: readonly string[]) => string;

const count = (n: number, label: string, plural = `${label}s`) => `${n} ${n === 1 ? label : plural}`;

function summarizeMatch(handler: Handler, multipleSources: boolean, describe: DescribeAction, nameOf: (id: string) => string): string {
  if (handler.enabled === false) return `Off automation · ${handler.name}`;
  if (handler.enabled === null) return `Automation state unknown · ${handler.name}`;
  if (multipleSources) return `Trigger match · ${handler.name}`;
  if ("actions" in handler && handler.actions.length === 1) {
    const action = handler.actions[0];
    const conditional = handler.conditions.length > 0 || action.conditions.length > 0 || action.branches.length > 0 || handler.notes.length > 0;
    const label = action.uncertain ? "Possible action" : conditional ? "Conditional action" : "Configured action";
    return `${label} · ${describe(
      action.service,
      action.targets.map(({ name }) => name),
    )}`;
  }
  if ("services" in handler && handler.services.length === 1) return `Trigger match · ${describe(handler.services[0], handler.targets.map(nameOf))}`;
  return `Trigger match · ${handler.name}`;
}

function mappingState({ blocked, queued, enabled, automationEnabled }: PressBinding): string {
  if (blocked) return "Blocked by Taxis";
  if (queued) return enabled ? "Queued" : "Queued disabled mapping";
  if (!enabled) return "Disabled mapping";
  if (automationEnabled === false) return "Off automation";
  if (automationEnabled === null) return "Automation state unknown";
  return "Configured mapping";
}

export function summarizeButtonPress(
  sources: readonly MatrixCell<PressBinding>[],
  evidence: ReadonlyMap<string, ButtonGestureAnalysis>,
  describe: DescribeAction,
  nameOf: (id: string) => string,
): string {
  const bindings = sources.flatMap(({ bindings }) => bindings);
  const managed = new Set(bindings.map(({ automationId }) => automationId));
  const handlers = new Map<string, Handler>();
  const handlerSources = new Map<string, Set<string>>();
  const overlaps = new Set<string>();
  for (const { gesture, external } of sources) {
    const analysis = evidence.get(gesture.key);
    for (const handler of [...external, ...(analysis?.handlers ?? [])]) {
      if (handler.managed && managed.has(handler.id)) continue;
      const sourceKeys = handlerSources.get(handler.id) ?? new Set<string>();
      sourceKeys.add(gesture.key);
      handlerSources.set(handler.id, sourceKeys);
      const known = handlers.get(handler.id);
      if (!known || (known.match === "possible" && handler.match === "exact") || (known.match === handler.match && "actions" in handler))
        handlers.set(handler.id, handler);
    }
    for (const overlap of analysis?.overlaps ?? []) overlaps.add(JSON.stringify([overlap.target.id, overlap.kind, [...overlap.handlers].sort()]));
  }

  const exact = [...handlers.values()].filter(({ match }) => match === "exact");
  const possible = handlers.size - exact.length;
  const parts: string[] = [];
  if (bindings.length === 1) {
    const [binding] = bindings;
    const { action } = binding;
    parts.push(mappingState(binding), describe(action.service, action.entityId ? [nameOf(action.entityId)] : []));
  } else if (bindings.length > 1) {
    parts.push(count(bindings.length, "mapping"));
    const blocked = bindings.filter((binding) => binding.blocked).length;
    const queued = bindings.filter((binding) => !binding.blocked && binding.queued).length;
    const disabled = bindings.filter((binding) => !binding.blocked && !binding.enabled).length;
    const off = bindings.filter((binding) => mappingState(binding) === "Off automation").length;
    const unknown = bindings.filter((binding) => mappingState(binding) === "Automation state unknown").length;
    if (blocked > 0) parts.push(`${blocked} blocked by Taxis`);
    if (queued > 0) parts.push(`${queued} queued`);
    if (disabled > 0) parts.push(`${disabled} disabled`);
    if (off > 0) parts.push(`${off} with automation off`);
    if (unknown > 0) parts.push(`${unknown} with unknown automation state`);
  }
  if (exact.length > 0)
    parts.push(
      exact.length === 1 && bindings.length === 0
        ? summarizeMatch(exact[0], (handlerSources.get(exact[0].id)?.size ?? 0) > 1, describe, nameOf)
        : count(exact.length, "trigger match", "trigger matches"),
    );
  if (possible > 0) parts.push(count(possible, "possible match", "possible matches"));
  if (overlaps.size > 0) parts.push(count(overlaps.size, "overlap") + " to review");
  return parts.join(" · ") || "No readable handler matched";
}
