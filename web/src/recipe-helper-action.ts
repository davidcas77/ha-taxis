import { HOUSE_AREAS_OCCUPIED_ID, HOUSE_OCCUPIED_ID } from "../../shared/climate.ts";
import { heldBy, pendingRename } from "../../shared/recipes.ts";
import type { Change, ChangeInput, Hierarchy } from "../../shared/types.ts";

// Resolve only dependencies encoded by the existing planners; never include an automation.
export function helperCreateInput(h: Hierarchy, changes: readonly Change[], id: string, external: boolean, candidates: readonly ChangeInput[]): ChangeInput[] {
  if (external) return [];
  const visit = (target: string, stack: Set<string>): ChangeInput[] | null => {
    if (
      stack.has(target) ||
      h.entities[target] ||
      pendingRename(changes, target) ||
      changes.some((c) => c.kind === "helper" && (c.targetId === target || c.after.entity_id === target))
    )
      return null;
    const input = candidates.find((c) => c.kind === "helper" && c.op === "create" && c.fields?.entity_id === target);
    if (!input) return null;
    const type = input.fields?.helper;
    let deps: { id: string; domain: string; platform: string }[] = [];
    if (type === "template") {
      if (target === HOUSE_OCCUPIED_ID) deps = [{ id: HOUSE_AREAS_OCCUPIED_ID, domain: "binary_sensor", platform: "group" }];
      else {
        const match = /^\{\{ is_state\('(timer\.[a-z0-9_]+)','active'\) \}\}$/.exec(String(input.fields?.state_template));
        if (!match) return null;
        deps = [{ id: match[1], domain: "timer", platform: "timer" }];
      }
    } else if (type === "derivative") {
      const ids = input.fields?.entities;
      if (!Array.isArray(ids) || ids.length !== 1 || typeof ids[0] !== "string") return null;
      deps = [{ id: ids[0], domain: "sensor", platform: "min_max" }];
    } else if (!["timer", "input_boolean", "schedule", "group", "min_max"].includes(String(type))) return null;
    const out: ChangeInput[] = [];
    const next = new Set(stack).add(target);
    for (const dep of deps) {
      if (pendingRename(changes, dep.id)) return null;
      const relevant = changes.filter((c) => c.kind === "helper" && (c.targetId === dep.id || c.after.entity_id === dep.id));
      if (relevant.some((c) => c.op !== "create")) return null;
      const held = heldBy(h, dep.id, dep.domain, dep.platform === "timer" ? undefined : dep.platform);
      if (held.state === "ok") {
        const entity = h.entities[dep.id];
        if (relevant.length || entity.disabled || entity.state === "unavailable" || entity.state === "unknown" || entity.state == null) return null;
        continue;
      }
      if (held.state !== "absent") return null;
      const queued = relevant.find((c) => c.op === "create" && c.after.entity_id === dep.id);
      const expected = dep.platform === "min_max" ? "min_max" : dep.platform;
      if (queued) {
        if (relevant.length !== 1 || queued.after.helper !== expected || (expected === "group" && queued.after.group_type !== dep.domain)) return null;
        continue;
      }
      const child = visit(dep.id, next);
      if (!child || child.at(-1)?.fields?.helper !== expected || (expected === "group" && child.at(-1)?.fields?.group_type !== dep.domain)) return null;
      out.push(...child);
    }
    out.push(input);
    return out;
  };
  return visit(id, new Set()) ?? [];
}
