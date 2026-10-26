import { blueprintByPath, blueprintForRecipe, blueprintVersion, BLUEPRINTS, type RecipeKey } from "../../shared/blueprints.ts";
import { ENTITY_ID_RE, sameValue } from "../../shared/changes.ts";
import { parseDuration, type InstalledAutomation, type RecipeInstalled } from "../../shared/recipes.ts";
import type { Change } from "../../shared/types.ts";
import type { HaConfig, RestApi } from "../ha/rest.ts";
import type { RawRegistry } from "../model/hierarchy.ts";
import { searchRelated } from "../references/find.ts";
import { mapLimit } from "../references/snapshot.ts";
import type { Outcome } from "./apply.ts";

// Applying a recipe: its blueprint, and its automation.
//
//   blueprint   written once per blueprint, with the text Taxis holds for that
//               path (shared/blueprints.ts), when Home Assistant has none or one
//               of another version. Run before the helpers.
//   automation  one per area and recipe, created or replaced through the REST
//               config API as a use of the blueprint with its inputs. Run after
//               the helpers, because its inputs name them.
//
// Both are checked against a fresh read: the blueprint has to be listed with the
// version Taxis wrote, the automation's stored config has to be what was sent,
// and an automation Home Assistant could not load (its state is unavailable)
// is reported. Nothing here deletes anything.

// The WebSocket client, as far as this file uses it.
export type RecipeWs = {
  command<T>(type: string, payload?: Record<string, unknown>): Promise<T>;
  write<T>(type: string, payload: Record<string, unknown>): Promise<T>;
};

export type RecipeIO = {
  ha: RecipeWs;
  rest: Pick<RestApi, "get" | "post">;
  readFresh: () => Promise<RawRegistry>;
  // From the registry step of the same Apply: entity ids renamed (old to new),
  // which an automation's inputs may still carry.
  renamed?: ReadonlyMap<string, string>;
  // Waiting for Home Assistant to catch up; tests make it instant.
  sleep?: (ms: number) => Promise<void>;
};

type BlueprintList = Record<string, { metadata?: { description?: unknown } } | { error?: unknown }>;

// Blueprint path -> the version it states, for the Taxis blueprints Home
// Assistant has: null when it has none, 0 when it has one without a version line.
export async function blueprintVersions(ha: Pick<RecipeWs, "command">): Promise<Record<string, number | null>> {
  const list = await ha.command<BlueprintList>("blueprint/list", { domain: "automation" });
  const out: Record<string, number | null> = {};
  for (const b of BLUEPRINTS) {
    const entry = list && typeof list === "object" && Object.hasOwn(list, b.path) ? list[b.path] : undefined;
    out[b.path] = entry && "metadata" in entry && entry.metadata ? blueprintVersion(entry.metadata.description) ?? 0 : null;
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
      await io.ha.write("blueprint/save", { domain: "automation", path, yaml: info.yaml, allow_override: true });
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
            : fail(c, read === null ? "Home Assistant doesn't list the blueprint after saving it." : `Home Assistant lists the blueprint as version ${read}, not ${want}.`),
        );
      }
    }
  }
  return changes.map((c) => outcome.get(c.id) ?? fail(c, "Not sent."));
}

// ---------------------------------------------------------------------------
// Automations.
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

// The parts of a stored config Taxis sets: what has to match to say it is the same.
const sameConfig = (a: HaConfig | null, b: HaConfig): boolean => {
  if (!a) return false;
  const ua = a.use_blueprint as UseBlueprint | undefined;
  const ub = b.use_blueprint as UseBlueprint;
  return a.alias === b.alias && ua?.path === ub.path && sameValue(ua?.input ?? {}, ub.input);
};

export async function applyAutomationChanges(all: Change[], io: RecipeIO): Promise<Outcome[]> {
  const changes = all.filter((c) => c.kind === "automation");
  if (changes.length === 0) return [];
  const sleep = io.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  let fresh: RawRegistry;
  let versions: Record<string, number | null>;
  try {
    fresh = await io.readFresh();
    versions = await blueprintVersions(io.ha);
  } catch (e) {
    return changes.map((c) => fail(c, `Taxis couldn't read Home Assistant first (${(e as Error).message}), so nothing was sent.`));
  }
  const known = new Set(fresh.entities.map((e) => e.entity_id));
  for (const s of fresh.states) known.add(s.entity_id);
  const current = (id: string) => (!known.has(id) && io.renamed?.has(id) && known.has(io.renamed.get(id)!) ? io.renamed.get(id)! : id);
  const mapId = (v: unknown): unknown => (typeof v === "string" && ENTITY_ID_RE.test(v) ? current(v) : Array.isArray(v) ? v.map(mapId) : v);

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
    if (!fresh.areas.some((a) => a.area_id === c.after.area_id)) {
      outcome.set(c.id, fail(c, "The area it is for is no longer in Home Assistant."));
      continue;
    }
    // Inputs name entities, some made earlier in this same Apply: each has to be there now.
    const input = Object.fromEntries(Object.entries(ub.input).map(([k, v]) => [k, mapId(v)]));
    const wanted = Object.values(input).flat().filter((v): v is string => typeof v === "string" && ENTITY_ID_RE.test(v));
    const gone = wanted.find((e) => !known.has(e));
    if (gone) {
      outcome.set(c.id, fail(c, `“${gone}” isn't in Home Assistant, so the automation would not work. Apply again once it is there.`));
      continue;
    }
    if (versions[ub.path] !== info.version) {
      outcome.set(c.id, fail(c, "Home Assistant doesn't have the current version of the blueprint, so the automation would not load. Apply again to write it."));
      continue;
    }

    const config = automationConfig(c, input);
    try {
      const existing = await io.rest.get("automation", id);
      if (sameConfig(existing, config)) {
        outcome.set(c.id, { changeId: c.id, ok: true, message: "Applied (it was already like this)." });
        continue;
      }
      await io.rest.post("automation", id, config);
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
      states = (await io.readFresh()).states;
    } catch {
      // The stored config below is still checked; the state is a bonus.
    }
    const wrong = new Map<number, string>();
    for (const c of pending) {
      let stored: HaConfig | null;
      try {
        stored = await io.rest.get("automation", c.targetId);
      } catch (e) {
        wrong.set(c.id, `Sent, but Taxis couldn't read it back to check it (${(e as Error).message}).`);
        continue;
      }
      if (!stored) wrong.set(c.id, "Home Assistant doesn't have the automation after saving it.");
      else if (!sameConfig(stored, sent.get(c.id)!)) wrong.set(c.id, "Home Assistant stored something different from what Taxis sent.");
      else {
        const state = states.find((x) => (x.attributes as { id?: unknown } | undefined)?.id === c.targetId);
        if (state?.state === "unavailable") wrong.set(c.id, "Home Assistant saved it but couldn't load it (it shows as unavailable). Check the blueprint's inputs in Home Assistant.");
        else outcome.set(c.id, { changeId: c.id, ok: true, message: "Applied.", ...(state ? {} : { details: ["Home Assistant hasn't listed the automation yet; it may take a moment."] }) });
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
const isTaxisAutomation = (s: RawRegistry["states"][number]) => s.entity_id.startsWith("automation.") && String((s.attributes as { id?: unknown } | undefined)?.id ?? "").startsWith("taxis_");

export async function readInstalled(io: Pick<RecipeIO, "ha" | "rest">, raw: RawRegistry, lightGroups: readonly string[]): Promise<RecipeInstalled> {
  const out: RecipeInstalled = { blueprints: await blueprintVersions(io.ha), automations: {}, timers: {}, controllers: {} };

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
    const ub = config.use_blueprint as { path?: unknown; input?: unknown } | undefined;
    const installed: InstalledAutomation = {
      alias: typeof config.alias === "string" ? config.alias : null,
      path: typeof ub?.path === "string" ? ub.path : null,
      input: ub?.input && typeof ub.input === "object" && !Array.isArray(ub.input) ? (ub.input as Record<string, unknown>) : {},
    };
    out.automations[id] = installed;
  });

  // Other automations that already use an area's light group: installing a
  // recipe would make two things control the same lights.
  const taxisEntities = new Set(mine.map((s) => s.entity_id));
  const nameOf = new Map(raw.states.map((s) => [s.entity_id, String((s.attributes as { friendly_name?: unknown } | undefined)?.friendly_name ?? s.entity_id)]));
  await mapLimit([...lightGroups], 6, async (group) => {
    const related = await searchRelated(io.ha, group);
    const others = (related.automation ?? []).filter((e) => !taxisEntities.has(e)).map((entityId) => ({ entityId, name: nameOf.get(entityId) ?? entityId }));
    if (others.length > 0) out.controllers[group] = others.sort((a, b) => a.name.localeCompare(b.name));
  });
  return out;
}
