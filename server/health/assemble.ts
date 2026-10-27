import type { HealthItem, HealthSnapshot, HealthState } from "../../shared/health.ts";
import { ANNOUNCE_SCRIPT_ID } from "../../shared/blueprints.ts";
import { parseDuration, type RecipeInstalled } from "../../shared/recipes.ts";
import type { Hierarchy } from "../../shared/types.ts";
import { blueprintVersions, installedOf, type RecipeWs } from "../changes/recipes.ts";
import type { RawRegistry, RawState } from "../model/hierarchy.ts";
import type { Snapshot } from "../references/snapshot.ts";

// Putting together what the health checks look at, from reads Taxis already
// makes: the registries and states (get_states), the configs of automations,
// scripts, scenes and dashboards (the references snapshot) and the list of
// blueprints (blueprint/list). No new read, and nothing is written.

const text = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);

export function healthStates(states: readonly RawState[]): Record<string, HealthState> {
  const out: Record<string, HealthState> = {};
  for (const s of states) {
    out[s.entity_id] = {
      state: String(s.state),
      lastChanged: text(s.last_changed),
      lastTriggered: text(s.attributes?.last_triggered),
      restored: s.attributes?.restored === true,
    };
  }
  return out;
}

// The blueprints Home Assistant has and their versions, or null when it can't be
// read (an old Home Assistant, or a refusal): the recipe checks then stand down.
export async function readBlueprints(ha: Pick<RecipeWs, "command">): Promise<Record<string, number | null> | null> {
  try {
    return await blueprintVersions(ha);
  } catch {
    return null;
  }
}

// What the recipes page learns from reading Home Assistant again, taken from what
// is already in hand: the Taxis automations are among the stored configs, and
// the timers' lengths are in the states.
export function installedFrom(states: readonly RawState[], snap: Snapshot, blueprints: Record<string, number | null>): RecipeInstalled {
  const out: RecipeInstalled = { blueprints, automations: {}, scripts: {}, timers: {}, controllers: {} };
  for (const s of states) {
    if (s.entity_id.startsWith("timer.")) out.timers[s.entity_id] = parseDuration(s.attributes?.duration);
  }
  for (const item of snap.items) {
    if (!item.id.startsWith("taxis_") || !item.config || typeof item.config !== "object") continue;
    if (item.kind === "automation") out.automations[item.id] = installedOf(item.config as Record<string, unknown>);
    else if (item.kind === "script" && item.id === ANNOUNCE_SCRIPT_ID) out.scripts[item.id] = installedOf(item.config as Record<string, unknown>);
  }
  return out;
}

export function healthSnapshot(raw: Pick<RawRegistry, "states">, hierarchy: Hierarchy, snap: Snapshot, blueprints: Record<string, number | null> | null): HealthSnapshot {
  const items: HealthItem[] = snap.items.map((i) => ({ kind: i.kind, id: i.id, entityId: i.entityId, name: i.name, config: i.config, yaml: i.yaml }));
  return {
    hierarchy,
    states: healthStates(raw.states),
    items,
    installed: blueprints ? installedFrom(raw.states, snap, blueprints) : null,
    notes: snap.notes,
  };
}
