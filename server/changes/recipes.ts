import {
  SCRIPT_IDS,
  blueprintByPath,
  blueprintForRecipe,
  blueprintVersion,
  BLUEPRINTS,
  inputEntityIds,
  isHouseRecipe,
  mapInputEntities,
  type RecipeKey,
} from "../../shared/blueprints.ts";
import { sameValue } from "../../shared/changes.ts";
import { parseDuration, type InstalledAutomation, type RecipeInstalled } from "../../shared/recipes.ts";
import type { Change } from "../../shared/types.ts";
import { READS, type FreshRead } from "../ha/registry.ts";
import type { ConfigKind, HaConfig, RestApi } from "../ha/rest.ts";
import type { RawRegistry } from "../model/hierarchy.ts";
import { searchRelated } from "../references/find.ts";
import { mapLimit } from "../references/snapshot.ts";
import { applyButtonChanges } from "../buttons/apply.ts";
import type { Outcome } from "./apply.ts";

// Applying a recipe: its blueprint, and its automation (or the announce script).
//
//   blueprint   written once per blueprint, with the text Taxis holds for that
//               path (shared/blueprints.ts), when Home Assistant has none or one
//               of another version. Run before the helpers.
//   automation  one per area and recipe, created or replaced through the REST
//               config API as a use of the blueprint with its inputs. Run after
//               the helpers, because its inputs name them.
//   script      the same for taxis_announce and taxis_goodbye, the scripts Taxis makes.
//               A house recipe (shared/recipes-house.ts) has no area: its automation
//               is checked like the others, minus the area.
//
// All are checked against a fresh read: the blueprint has to be listed with the
// version Taxis wrote, the automation's or script's stored config has to be what
// was sent, and an automation Home Assistant could not load (its state is
// unavailable) or a script it did not list is reported. Nothing here deletes
// anything.

// The WebSocket client, as far as this file uses it.
export type RecipeWs = {
  command<T>(type: string, payload?: Record<string, unknown>): Promise<T>;
  write<T>(type: string, payload: Record<string, unknown>): Promise<T>;
};

export type RecipeIO = {
  ha: RecipeWs;
  rest: Pick<RestApi, "get" | "post">;
  readFresh: FreshRead;
  // Where bulk reads of automation configs (button discovery) come from, when
  // Apply shares them between steps. Verification never uses it. Defaults to `rest`.
  configReads?: Pick<RestApi, "get">;
  // From the registry step of the same Apply: entity ids renamed (old to new),
  // which an automation's inputs may still carry.
  renamed?: ReadonlyMap<string, string>;
  // Waiting for Home Assistant to catch up; tests make it instant.
  sleep?: (ms: number) => Promise<void>;
};

type BlueprintList = Record<string, { metadata?: { description?: unknown } } | { error?: unknown }>;

// Blueprint path -> the version it states, for the Taxis blueprints Home
// Assistant has: null when it has none, 0 when it has one without a version line.
// Automation blueprints and the script blueprint are listed apart, one read each.
export async function blueprintVersions(ha: Pick<RecipeWs, "command">): Promise<Record<string, number | null>> {
  const out: Record<string, number | null> = {};
  for (const domain of ["automation", "script"] as const) {
    const list = await ha.command<BlueprintList>("blueprint/list", { domain });
    for (const b of BLUEPRINTS.filter((x) => x.domain === domain)) {
      const entry = list && typeof list === "object" && Object.hasOwn(list, b.path) ? list[b.path] : undefined;
      out[b.path] = entry && "metadata" in entry && entry.metadata ? (blueprintVersion(entry.metadata.description) ?? 0) : null;
    }
  }
  return out;
}

const fail = (c: Change, message: string): Outcome => ({ changeId: c.id, ok: false, message });

// ---------------------------------------------------------------------------
// Blueprints.
// ---------------------------------------------------------------------------

export async function applyBlueprintChanges(all: Change[], io: RecipeIO): Promise<Outcome[]> {
  const changes = all.filter((c) => c.kind === "blueprint");
  if (changes.length === 0) return [];

  let there: Record<string, number | null>;
  try {
    there = await blueprintVersions(io.ha);
  } catch (e) {
    return changes.map((c) => fail(c, `Taxis couldn't read Home Assistant's blueprints first (${(e as Error).message}), so nothing was sent.`));
  }

  const outcome = new Map<number, Outcome>();
  const sent: Change[] = [];
  for (const c of changes) {
    const path = String(c.after.path);
    const info = blueprintByPath(path);
    if (!info) {
      outcome.set(c.id, fail(c, "Taxis has no blueprint at that path any more."));
      continue;
    }
    // Written only when it is missing or another version.
    if (there[path] === info.version) {
      outcome.set(c.id, { changeId: c.id, ok: true, message: "Applied (the blueprint was already this version)." });
      continue;
    }
    try {
      await io.ha.write("blueprint/save", { domain: info.domain, path, yaml: info.yaml, allow_override: true });
      sent.push(c);
    } catch (e) {
      outcome.set(c.id, fail(c, `Home Assistant refused it: ${(e as Error).message}`));
    }
  }

  if (sent.length > 0) {
    let after: Record<string, number | null> | null = null;
    try {
      after = await blueprintVersions(io.ha);
    } catch (e) {
      for (const c of sent) outcome.set(c.id, fail(c, `Sent, but Taxis couldn't read the blueprints back to check it (${(e as Error).message}).`));
    }
    if (after) {
      for (const c of sent) {
        const path = String(c.after.path);
        const want = blueprintByPath(path)!.version;
        const read = after[path];
        outcome.set(
          c.id,
          read === want
            ? { changeId: c.id, ok: true, message: "Applied.", details: [`${path} is version ${want}.`] }
            : fail(
                c,
                read === null
                  ? "Home Assistant doesn't list the blueprint after saving it."
                  : `Home Assistant lists the blueprint as version ${read}, not ${want}.`,
              ),
        );
      }
    }
  }
  return changes.map((c) => outcome.get(c.id) ?? fail(c, "Not sent."));
}

// ---------------------------------------------------------------------------
// Automations and the announce script.
// ---------------------------------------------------------------------------

type UseBlueprint = { path: string; input: Record<string, unknown> };

// The config Home Assistant stores for a recipe's automation.
export function automationConfig(c: Change, input: Record<string, unknown>): HaConfig {
  const recipe = c.after.recipe as RecipeKey;
  return {
    id: c.targetId,
    alias: c.after.alias,
    description: `Made by Taxis from the ${blueprintForRecipe(recipe).path} blueprint. Changes made here are overwritten when the recipe is installed again.`,
    use_blueprint: { path: (c.after.use_blueprint as UseBlueprint).path, input },
  };
}

// The config of the announce script. A script's config has no id of its own: its key
// in the URL is the id.
export function scriptConfig(c: Change, input: Record<string, unknown>): HaConfig {
  const path = (c.after.use_blueprint as UseBlueprint).path;
  return {
    alias: c.after.alias,
    description: `Made by Taxis from the ${path} blueprint. Changes made here are overwritten when the recipe is installed again.`,
    use_blueprint: { path, input },
  };
}

// The parts of a stored config Taxis sets: what has to match to say it is the same.
const sameConfig = (a: HaConfig | null, b: HaConfig): boolean => {
  if (!a) return false;
  const ua = a.use_blueprint as UseBlueprint | undefined;
  const ub = b.use_blueprint as UseBlueprint;
  return a.alias === b.alias && ua?.path === ub.path && sameValue(ua?.input ?? {}, ub.input);
};

export const applyAutomationChanges = async (all: Change[], io: RecipeIO): Promise<Outcome[]> => [
  ...(await applyConfigChanges(
    all.filter((c) => !c.after.button_map),
    io,
    "automation",
  )),
  ...(await applyButtonChanges(
    all.filter((c) => c.kind === "automation" && !!c.after.button_map),
    io,
  )),
];
export const applyScriptChanges = (all: Change[], io: RecipeIO): Promise<Outcome[]> => applyConfigChanges(all, io, "script");

// What differs between the two: where the stored config lives, what its state in
// Home Assistant is, and the area an automation is for.
const CONFIG: Record<
  "automation" | "script",
  {
    rest: ConfigKind;
    what: string;
    state: (s: RawRegistry["states"][number], id: string) => boolean;
    config: (c: Change, input: Record<string, unknown>) => HaConfig;
  }
> = {
  automation: {
    rest: "automation",
    what: "automation",
    state: (s, id) => s.entity_id.startsWith("automation.") && (s.attributes as { id?: unknown } | undefined)?.id === id,
    config: automationConfig,
  },
  script: { rest: "script", what: "script", state: (s, id) => s.entity_id === `script.${id}`, config: scriptConfig },
};

async function applyConfigChanges(all: Change[], io: RecipeIO, kind: "automation" | "script"): Promise<Outcome[]> {
  const changes = all.filter((c) => c.kind === kind);
  if (changes.length === 0) return [];
  const { rest: restKind, what, state: stateOf, config: configOf } = CONFIG[kind];
  const sleep = io.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  let fresh: RawRegistry;
  let versions: Record<string, number | null>;
  try {
    fresh = await io.readFresh(READS.entitiesAndStates);
    versions = await blueprintVersions(io.ha);
  } catch (e) {
    return changes.map((c) => fail(c, `Taxis couldn't read Home Assistant first (${(e as Error).message}), so nothing was sent.`));
  }
  const known = new Set(fresh.entities.map((e) => e.entity_id));
  for (const s of fresh.states) known.add(s.entity_id);
  const current = (id: string) => (!known.has(id) && io.renamed?.has(id) && known.has(io.renamed.get(id)!) ? io.renamed.get(id)! : id);

  const outcome = new Map<number, Outcome>();
  const sent = new Map<number, HaConfig>();
  for (const c of changes) {
    const id = c.targetId;
    const ub = c.after.use_blueprint as UseBlueprint;
    const info = blueprintByPath(ub.path);
    if (!info) {
      outcome.set(c.id, fail(c, "Taxis has no blueprint at that path any more."));
      continue;
    }
    if (kind === "automation" && !isHouseRecipe(c.after.recipe) && !fresh.areas.some((a) => a.area_id === c.after.area_id)) {
      outcome.set(c.id, fail(c, "The area it is for is no longer in Home Assistant."));
      continue;
    }
    // Inputs name entities, some made earlier in this same Apply: each has to be there now.
    // Notify services are not entities and are not looked for.
    const input = mapInputEntities(ub.path, ub.input, current);
    const gone = inputEntityIds(ub.path, input).find((e) => !known.has(e));
    if (gone) {
      outcome.set(c.id, fail(c, `“${gone}” isn't in Home Assistant, so the ${what} would not work. Apply again once it is there.`));
      continue;
    }
    if (versions[ub.path] !== info.version) {
      outcome.set(c.id, fail(c, `Home Assistant doesn't have the current version of the blueprint, so the ${what} would not load. Apply again to write it.`));
      continue;
    }

    const config = configOf(c, input);
    try {
      const existing = await io.rest.get(restKind, id);
      if (sameConfig(existing, config)) {
        sent.set(c.id, config); // Matching storage still needs runtime verification, including retries.
        continue;
      }
      await io.rest.post(restKind, id, config);
      sent.set(c.id, config);
    } catch (e) {
      outcome.set(c.id, fail(c, (e as Error).message));
    }
  }

  // Check what was sent: the stored config, and that Home Assistant loaded it.
  // A problem may only be Home Assistant catching up, so it is read again before
  // it is reported.
  let pending = changes.filter((c) => sent.has(c.id));
  for (let attempt = 0; attempt < 4 && pending.length > 0; attempt++) {
    let states: RawRegistry["states"] = [];
    try {
      // Only the states can say whether Home Assistant has loaded it.
      states = (await io.readFresh(READS.states)).states;
    } catch {
      // Keep the state unverified; the stored config alone does not prove it loaded.
    }
    const wrong = new Map<number, string>();
    for (const c of pending) {
      let stored: HaConfig | null;
      try {
        stored = await io.rest.get(restKind, c.targetId);
      } catch (e) {
        wrong.set(c.id, `Sent, but Taxis couldn't read it back to check it (${(e as Error).message}).`);
        continue;
      }
      if (!stored) wrong.set(c.id, `Home Assistant doesn't have the ${what} after saving it.`);
      else if (!sameConfig(stored, sent.get(c.id)!)) wrong.set(c.id, "Home Assistant stored something different from what Taxis sent.");
      else {
        const state = states.find((x) => stateOf(x, c.targetId));
        if (!state) wrong.set(c.id, `Home Assistant saved the ${what}, but has not listed it as loaded yet. Check it before retrying.`);
        else if (state.state === "unavailable")
          wrong.set(c.id, "Home Assistant saved it but couldn't load it (it shows as unavailable). Check the blueprint's inputs in Home Assistant.");
        else outcome.set(c.id, { changeId: c.id, ok: true, message: "Applied." });
      }
    }
    pending = pending.filter((c) => wrong.has(c.id));
    if (attempt === 3 || pending.length === 0) for (const c of pending) outcome.set(c.id, fail(c, wrong.get(c.id)!));
    if (pending.length > 0 && attempt < 3) await sleep(500);
  }
  return changes.map((c) => outcome.get(c.id) ?? fail(c, "Not sent."));
}

// ---------------------------------------------------------------------------
// What is installed, for the Recipes page.
// ---------------------------------------------------------------------------

// Taxis's own automations carry its id.
const isTaxisAutomation = (s: RawRegistry["states"][number]) =>
  s.entity_id.startsWith("automation.") && String((s.attributes as { id?: unknown } | undefined)?.id ?? "").startsWith("taxis_");

// What a stored config says of the blueprint it uses.
export function installedOf(config: HaConfig): InstalledAutomation {
  const ub = config.use_blueprint as { path?: unknown; input?: unknown } | undefined;
  return {
    alias: typeof config.alias === "string" ? config.alias : null,
    path: typeof ub?.path === "string" ? ub.path : null,
    input: ub?.input && typeof ub.input === "object" && !Array.isArray(ub.input) ? (ub.input as Record<string, unknown>) : {},
  };
}

export async function readInstalled(
  io: { ha: RecipeWs; rest: Pick<RestApi, "get"> },
  raw: RawRegistry,
  lightGroups: readonly string[],
  thermostats: readonly string[] = [],
): Promise<RecipeInstalled> {
  const out: RecipeInstalled = { blueprints: await blueprintVersions(io.ha), automations: {}, scripts: {}, timers: {}, controllers: {} };

  for (const s of raw.states) {
    if (s.entity_id.startsWith("timer.")) out.timers[s.entity_id] = parseDuration((s.attributes as { duration?: unknown } | undefined)?.duration);
  }

  const mine = raw.states.filter(isTaxisAutomation);
  await mapLimit(mine, 6, async (s) => {
    const id = String((s.attributes as { id?: unknown }).id);
    // An id Taxis could not have made is left alone (and never sent to Home Assistant).
    if (!/^[A-Za-z0-9_-]{1,255}$/.test(id)) return;
    const config = await io.rest.get("automation", id);
    if (!config) return;
    out.automations[id] = installedOf(config);
  });

  // The scripts Taxis makes (announce, goodbye), when Home Assistant lists one under its id.
  for (const scriptId of SCRIPT_IDS) {
    if (!raw.states.some((s) => s.entity_id === `script.${scriptId}`)) continue;
    const config = await io.rest.get("script", scriptId);
    if (config) out.scripts[scriptId] = installedOf(config);
  }

  // Other automations that already use an area's light group or a thermostat:
  // installing a recipe would make two things control the same lights or heating.
  const taxisEntities = new Set(mine.map((s) => s.entity_id));
  const nameOf = new Map(raw.states.map((s) => [s.entity_id, String((s.attributes as { friendly_name?: unknown } | undefined)?.friendly_name ?? s.entity_id)]));
  await mapLimit([...lightGroups, ...thermostats], 6, async (group) => {
    const related = await searchRelated(io.ha, group);
    const others = (related.automation ?? []).filter((e) => !taxisEntities.has(e)).map((entityId) => ({ entityId, name: nameOf.get(entityId) ?? entityId }));
    if (others.length > 0) out.controllers[group] = others.sort((a, b) => a.name.localeCompare(b.name));
  });
  return out;
}
