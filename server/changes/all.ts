import type { Change } from "../../shared/types.ts";
import type { HaRest } from "../ha/rest.ts";
import type { RawRegistry } from "../model/hierarchy.ts";
import { applyChanges, isRename, type Outcome, type Retarget } from "./apply.ts";
import { applyHelperChanges } from "./helpers.ts";
import { applyAutomationChanges, applyBlueprintChanges, type RecipeWs } from "./recipes.ts";

// The whole Apply, in the order that lets each step rely on the one before:
//
//   1. the registries: floors, labels, categories, areas, devices and entities
//      (and, for a renamed entity id, what uses the old one);
//   2. blueprints, which an automation made from them needs;
//   3. helpers: groups, min/max sensors and the recipes' timers, toggles and
//      template sensors, which may need a new area or a renamed entity;
//   4. the recipes' automations, whose inputs name the helpers and the blueprint.
//
// Each step reads Home Assistant back to check what it did. A change that fails
// doesn't stop the others; the ones that depend on it say so.

export type ApplyAllIO = {
  ha: RecipeWs;
  rest: Pick<HaRest, "request" | "get" | "post">;
  readFresh: () => Promise<RawRegistry>;
  // Waiting for Home Assistant to catch up; tests make it instant.
  sleep?: (ms: number) => Promise<void>;
};

export async function applyAll(pending: Change[], io: ApplyAllIO): Promise<{ results: Outcome[]; realIds: Map<string, string>; retargets: Retarget[] }> {
  const registry = await applyChanges(pending, io.ha, io.readFresh, { ha: io.ha, rest: io.rest });
  const renamed = new Map(pending.filter(isRename).map((c) => [c.targetId, String(c.after.new_entity_id)]));
  const blueprints = await applyBlueprintChanges(pending, { ha: io.ha, rest: io.rest, readFresh: io.readFresh, sleep: io.sleep });
  const helpers = await applyHelperChanges(pending, { ha: io.ha, rest: io.rest, readFresh: io.readFresh, realIds: registry.realIds, renamed, sleep: io.sleep });
  const automations = await applyAutomationChanges(pending, { ha: io.ha, rest: io.rest, readFresh: io.readFresh, renamed, sleep: io.sleep });
  const results = pending.map(
    (c) =>
      [registry.results, blueprints, helpers, automations].map((list) => list.find((r) => r.changeId === c.id)).find(Boolean) ?? { changeId: c.id, ok: false, message: "Not sent." },
  );
  return { results, realIds: registry.realIds, retargets: registry.retargets };
}
