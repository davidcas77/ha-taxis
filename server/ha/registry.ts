import { CATEGORY_SCOPES, type CategoryScope } from "../../shared/types.ts";
import type { RawArea, RawCategory, RawConfig, RawConfigEntry, RawDevice, RawEntity, RawFloor, RawLabel, RawRegistry, RawState } from "../model/hierarchy.ts";
import type { HaSocket } from "./socket.ts";

// The pieces of a read, so a check can ask for only what it looks at.
//
// A full read is about twelve WebSocket commands, and get_states alone can be
// megabytes on a large install. Apply verifies its work several times; most of
// those checks need the registries, or the states, but not both and never the
// rest. A partial read leaves the pieces it did not fetch EMPTY (never stale):
// a check that asks for too little fails visibly instead of trusting old data.
export type ReadPart = "config" | "floors" | "areas" | "devices" | "entities" | "labels" | "categories" | "states" | "integrations";

export const FULL_READ: readonly ReadPart[] = ["config", "floors", "areas", "devices", "entities", "labels", "categories", "states", "integrations"];

// The named reads Apply uses. Each says what its caller needs.
export const READS = {
  // What the hierarchy is built from, minus the home's name/version and the
  // integration list (they say nothing about whether a change took).
  hierarchy: ["floors", "areas", "devices", "entities", "labels", "categories", "states"],
  // Did a registry edit take? Verification reads the registries, never states.
  registries: ["floors", "areas", "devices", "entities", "labels", "categories"],
  // Helpers and automations: the entity registry (does it exist, what platform),
  // the areas (is it there, does a sensor point at it) and the states (members,
  // durations, loaded or not).
  entitiesAndStates: ["areas", "entities", "states"],
  // Is the automation loaded yet? Only a state can say.
  states: ["states"],
} as const satisfies Record<string, readonly ReadPart[]>;

export type ReadScope = readonly ReadPart[];

// How Apply reads Home Assistant back: say which pieces the check needs. Tests
// pass a fake that ignores the scope and returns everything.
export type FreshRead = (scope?: ReadScope) => Promise<RawRegistry>;

// One read of what is asked for (everything by default). The commands run in
// parallel over the same connection; all of them are read-only (see
// READ_COMMANDS).
export async function readRegistry(ha: Pick<HaSocket, "command">, scope: ReadScope = FULL_READ): Promise<RawRegistry> {
  const want = new Set<ReadPart>(scope);
  const ask = <T>(part: ReadPart, type: string, payload?: Record<string, unknown>): Promise<T[]> =>
    want.has(part) ? ha.command<T[]>(type, payload) : Promise.resolve([]);

  const [config, floors, areas, devices, entities, labels, states, integrations, ...categoryLists] = await Promise.all([
    want.has("config") ? ha.command<RawConfig>("get_config") : Promise.resolve({} as RawConfig),
    ask<RawFloor>("floors", "config/floor_registry/list"),
    ask<RawArea>("areas", "config/area_registry/list"),
    ask<RawDevice>("devices", "config/device_registry/list"),
    ask<RawEntity>("entities", "config/entity_registry/list"),
    ask<RawLabel>("labels", "config/label_registry/list"),
    ask<RawState>("states", "get_states"),
    // Which integrations work, to say why an entity does not. Not needed for anything
    // else, so an answer that doesn't come leaves the rest of the read as it was.
    want.has("integrations") ? ha.command<RawConfigEntry[]>("config_entries/get").catch(() => [] as RawConfigEntry[]) : Promise.resolve([] as RawConfigEntry[]),
    ...CATEGORY_SCOPES.map((scope) => ask<RawCategory>("categories", "config/category_registry/list", { scope })),
  ]);
  const categories = Object.fromEntries(CATEGORY_SCOPES.map((scope, i) => [scope, categoryLists[i] as RawCategory[]])) as Record<CategoryScope, RawCategory[]>;
  return { config, floors, areas, devices, entities, labels, categories, integrations: Array.isArray(integrations) ? integrations : [], states };
}
