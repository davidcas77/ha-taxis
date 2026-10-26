import { blueprintForRecipe, type RecipeKey } from "./blueprints.ts";
import { ENTITY_ID_RE, sameValue } from "./changes.ts";
import { RECIPE_HELPER_SUFFIX, canonicalId, effectiveSuffixes, helperExclusions } from "./helpers.ts";
import { areaChoice, areaInventory, type InventorySettings, type LightRole } from "./inventory.ts";
import { areaCodes, type NamingSettings } from "./naming.ts";
import { resolveAll, withSeconds, type ParameterSettings } from "./parameters.ts";
import type { Change, ChangeInput, Hierarchy } from "./types.ts";

// Recipes: for each area, whether Taxis can install a recipe (an automation made
// from a Taxis blueprint, with the helpers it needs), what is missing when it
// can't, and whether an installed one still matches the sensors and parameters.
// Pure functions; nothing here changes anything. Applying lives in
// server/changes/helpers.ts and server/changes/recipes.ts.

export const RECIPES: readonly { key: RecipeKey; label: string }[] = [
  { key: "occupancy", label: "Occupancy" },
  { key: "motion_lights", label: "Motion lights" },
  { key: "media_off", label: "Media off" },
];

export const RECIPE_LABEL = Object.fromEntries(RECIPES.map((r) => [r.key, r.label])) as Record<RecipeKey, string>;

export const automationIdFor = (recipe: RecipeKey, code: string) => `taxis_${recipe}_${code}`;

export const automationAlias = (areaName: string, recipe: RecipeKey) => `${areaName} – ${RECIPE_LABEL[recipe]} (Taxis)`;

// The helpers the recipes of an area need, by entity id: the hold timer, the
// occupied sensor and the pause switch (Occupancy makes them, the others use
// them) and the manual override timer (Motion lights).
export function runtimeIds(code: string) {
  return {
    timer: `timer.${code}_${RECIPE_HELPER_SUFFIX.hold}`,
    occupied: `binary_sensor.${code}_${RECIPE_HELPER_SUFFIX.occupied}`,
    switch: `input_boolean.${code}_${RECIPE_HELPER_SUFFIX.switch}`,
    override: `timer.${code}_${RECIPE_HELPER_SUFFIX.override}`,
  };
}

// The length the override timer is made with when the override has no fixed
// time: the automation sets the real length each time it starts the timer.
export const OVERRIDE_PLACEHOLDER_SECONDS = 3600;

// ---------------------------------------------------------------------------
// What Home Assistant holds that the registries don't show. The server reads
// it (server/index.ts) and the planner compares with it.
// ---------------------------------------------------------------------------

export type InstalledAutomation = { alias: string | null; path: string | null; input: Record<string, unknown> };

export type RecipeInstalled = {
  // Blueprint path -> the version it states: null when the blueprint isn't
  // there, 0 when it is there without a version line.
  blueprints: Record<string, number | null>;
  // Automation id -> its stored config, null when there is none.
  automations: Record<string, InstalledAutomation | null>;
  // Timer entity id -> its duration in seconds, when Home Assistant says.
  timers: Record<string, number | null>;
  // Canonical light group -> other automations that use it.
  controllers: Record<string, { entityId: string; name: string }[]>;
};

export const NOTHING_INSTALLED: RecipeInstalled = { blueprints: {}, automations: {}, timers: {}, controllers: {} };

export type RecipesResponse = { ok: true; installed: RecipeInstalled } | { ok: false; error: string };

// ---------------------------------------------------------------------------
// The plan.
// ---------------------------------------------------------------------------

export type RecipeStatus = "missing" | "ready" | "installed" | "out-of-date" | "in-changes";

export type RecipeCell = {
  areaId: string;
  areaName: string;
  recipe: RecipeKey;
  status: RecipeStatus;
  // missing: what is needed, in words.
  missing: string[];
  // out-of-date: how it differs, in words.
  reasons: string[];
  // Things worth knowing that don't stop it.
  notes: string[];
  // Other automations that already control this area's light group.
  controlledBy: { entityId: string; name: string }[];
  // What adding the cell to the change list sends, in order. Empty unless ready
  // or out of date.
  inputs: ChangeInput[];
  // True when the cell can be added to the change list.
  actionable: boolean;
};

const INPUT_LABEL: Record<string, string> = {
  starts_entities: "Sensors that start",
  holds_entities: "Sensors that hold",
  bed_entities: "Bed presence sensors",
  hold_timer: "Hold timer",
  hold_minutes: "Hold timeout (min)",
  extended_after: "Extended after (min)",
  extended_hold: "Extended hold timeout (min)",
  sleep_hold: "Sleep hold timeout (min)",
  pause_switch: "Pause switch",
  occupied_entity: "Occupied sensor",
  light_target: "Lights",
  main_lights: "Main lights",
  accent_lights: "Accent lights",
  night_lights: "Night lights",
  lux_entity: "Light level sensor",
  lux_threshold: "Dark below (lx)",
  night_start: "Night starts",
  night_end: "Night ends",
  day_brightness: "Day brightness (%)",
  day_kelvin: "Day colour (K)",
  night_brightness: "Night brightness (%)",
  night_kelvin: "Night colour (K)",
  transition: "Transition (s)",
  dim_before_off: "Dim before off (s)",
  dim_level: "Dim level (%)",
  override_timer: "Override timer",
  override_minutes: "Manual override lasts (min)",
  speaker_entities: "Speakers",
  tv_entities: "TVs",
  speaker_minutes: "Speakers off when clear for (min)",
  tv_minutes: "TVs off when clear for (min)",
};

const show = (v: unknown): string => (v === undefined || v === null || v === "" ? "none" : Array.isArray(v) ? (v.length ? v.join(", ") : "none") : String(v));

// Nothing, an empty list and an empty string are all "none": a blueprint takes
// the same default for each.
const none = (v: unknown) => v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);

// What differs between the inputs an automation has and the ones Taxis would
// send, in words.
function inputDifferences(was: Record<string, unknown>, now: Record<string, unknown>): string[] {
  const out: string[] = [];
  for (const key of Object.keys(INPUT_LABEL)) {
    const a = was[key];
    const b = now[key];
    if (none(a) && none(b)) continue;
    if (!sameValue(a ?? null, b ?? null)) out.push(`${INPUT_LABEL[key]}: ${show(a)} → ${show(b)}`);
  }
  // An input this version of Taxis doesn't know.
  for (const key of Object.keys(was)) if (!(key in INPUT_LABEL)) out.push(`${key}: not used any more`);
  return out;
}

// ---------------------------------------------------------------------------
// What is already in the change list.
// ---------------------------------------------------------------------------

const pendingHelper = (changes: readonly Change[], id: string) => changes.some((c) => c.kind === "helper" && (c.targetId === id || c.after.entity_id === id));
const pendingRename = (changes: readonly Change[], id: string) => changes.some((c) => c.kind === "entity" && c.after.new_entity_id === id);
const pendingDuration = (changes: readonly Change[], id: string) => changes.some((c) => c.kind === "helper" && c.op === "update" && c.targetId === id && "duration" in c.after);
const pendingAutomation = (changes: readonly Change[], id: string) => changes.some((c) => c.kind === "automation" && c.targetId === id);
const pendingBlueprint = (changes: readonly Change[], path: string, version: number) => changes.some((c) => c.kind === "blueprint" && c.targetId === path && c.after.version === version);

// A helper of the recipes in Home Assistant: absent, as it should be, or the
// id is held by something Taxis can't use.
type Held = { state: "absent" } | { state: "ok" } | { state: "taken"; name: string };

function heldBy(h: Hierarchy, id: string, domain: string, platform?: string): Held {
  const e = h.entities[id];
  if (!e) return { state: "absent" };
  // A timer or a toggle has to be set up in the UI to be edited; a template
  // sensor has to be one made by a config entry.
  const mine = e.domain === domain && e.inRegistry && (platform ? e.platform === platform && e.configEntryId !== null : e.platform === domain);
  return mine ? { state: "ok" } : { state: "taken", name: e.name };
}

const taken = (id: string, held: Held) => (held.state === "taken" ? `${id} is already used by “${held.name}”` : null);

// ---------------------------------------------------------------------------
// The cells.
// ---------------------------------------------------------------------------

export function planRecipes(
  h: Hierarchy,
  inventory: InventorySettings,
  naming: NamingSettings,
  params: ParameterSettings,
  installed: RecipeInstalled,
  changes: readonly Change[],
): RecipeCell[] {
  const codes = areaCodes(h, naming);
  const exclusions = helperExclusions(h, naming);
  const suffix = effectiveSuffixes(naming.helperNames);
  const out: RecipeCell[] = [];

  for (const area of Object.values(h.areas)) {
    const code = codes[area.id].code;
    const ids = runtimeIds(code);
    const values = resolveAll(params, h, inventory, area.id);
    const inv = areaInventory(h, inventory, area.id, exclusions(area.id));
    const usable = [ids.timer, ids.occupied, ids.switch, ids.override].every((id) => ENTITY_ID_RE.test(id));

    const occupancyId = automationIdFor("occupancy", code);
    const motionId = automationIdFor("motion_lights", code);
    const mediaOffId = automationIdFor("media_off", code);
    const timer = heldBy(h, ids.timer, "timer");
    const occupied = heldBy(h, ids.occupied, "binary_sensor", "template");
    const toggle = heldBy(h, ids.switch, "input_boolean");
    const overrideTimer = heldBy(h, ids.override, "timer");

    // The blueprint is written when Home Assistant has none, or one of another version.
    const blueprintInput = (recipe: RecipeKey): ChangeInput[] => {
      const bp = blueprintForRecipe(recipe);
      const there = installed.blueprints[bp.path] ?? null;
      if (there === bp.version || pendingBlueprint(changes, bp.path, bp.version)) return [];
      return [{ kind: "blueprint", op: there === null ? "create" : "update", fields: { path: bp.path, version: bp.version } }];
    };
    const blueprintReason = (recipe: RecipeKey): string[] => {
      const bp = blueprintForRecipe(recipe);
      const there = installed.blueprints[bp.path] ?? null;
      if (there === null) return ["The blueprint is missing"];
      return there === bp.version ? [] : [`The blueprint is version ${there}, Taxis has ${bp.version}`];
    };

    const automationInput = (recipe: RecipeKey, id: string, input: Record<string, unknown>): ChangeInput => ({
      kind: "automation",
      op: installed.automations[id] ? "update" : "create",
      fields: { automation_id: id, recipe, area_id: area.id, alias: automationAlias(area.name, recipe), use_blueprint: { path: blueprintForRecipe(recipe).path, input } },
    });

    // How an installed automation differs from what Taxis would write now.
    const automationReasons = (recipe: RecipeKey, id: string, input: Record<string, unknown>): string[] => {
      const there = installed.automations[id];
      if (!there) return [];
      const reasons: string[] = [];
      if (there.path !== blueprintForRecipe(recipe).path) reasons.push("It isn't made from the Taxis blueprint");
      else reasons.push(...inputDifferences(there.input, input));
      if (there.alias !== automationAlias(area.name, recipe)) reasons.push(`Name: ${show(there.alias)} → ${automationAlias(area.name, recipe)}`);
      return reasons;
    };

    const statusOf = (id: string, missing: string[], reasons: string[]): RecipeStatus => {
      if (pendingAutomation(changes, id)) return "in-changes";
      if (missing.length > 0) return "missing";
      if (installed.automations[id]) return reasons.length === 0 ? "installed" : "out-of-date";
      return "ready";
    };

    // A timer that exists but is not as long as it should be.
    const timerNow = (id: string) => installed.timers[id] ?? null;
    const durationDiffers = (id: string, held: Held, seconds: number) => held.state === "ok" && timerNow(id) !== null && timerNow(id) !== seconds && !pendingDuration(changes, id);

    const timerCreate = (name: string, id: string, seconds: number): ChangeInput => ({
      kind: "helper",
      op: "create",
      fields: { helper: "timer", name, entity_id: id, area_id: area.id, duration: seconds },
    });
    const timerUpdate = (id: string, seconds: number): ChangeInput => ({ kind: "helper", op: "update", targetId: id, fields: { duration: seconds } });

    // The sensors of the area that sleep is read from: bed sensors, in a bedroom.
    const bedSensors = areaChoice(inventory, area.id).bedroom
      ? inv.presence.filter((r) => r.counts && r.bed).map((r) => r.entityId).sort()
      : [];

    // ---- Occupancy --------------------------------------------------------
    const sources = [...inv.motion, ...inv.presence].filter((r) => r.counts);
    const starts = sources.filter((r) => r.role === "starts").map((r) => r.entityId).sort();
    const holds = sources.filter((r) => r.role === "holds").map((r) => r.entityId).sort();
    const holdMinutes = values.hold_timeout as number;
    const holdSeconds = holdMinutes * 60;
    const occupancyInput = {
      starts_entities: starts,
      holds_entities: holds,
      bed_entities: bedSensors,
      occupied_entity: ids.occupied,
      hold_timer: ids.timer,
      hold_minutes: holdMinutes,
      extended_after: values.extended_after,
      extended_hold: values.extended_hold,
      sleep_hold: values.sleep_hold,
      pause_switch: ids.switch,
    };

    const occMissing: string[] = [];
    if (starts.length === 0) occMissing.push(sources.length === 0 ? "A motion or presence sensor" : "A sensor that starts occupancy (the counted ones are all set to hold)");
    if (!usable) occMissing.push("An area code that makes valid entity ids (Settings)");
    else for (const m of [taken(ids.timer, timer), taken(ids.occupied, occupied), taken(ids.switch, toggle)]) if (m) occMissing.push(m);

    const occReasons = automationReasons("occupancy", occupancyId, occupancyInput);
    const occInstalled = Boolean(installed.automations[occupancyId]);
    if (occInstalled) {
      occReasons.push(...blueprintReason("occupancy"));
      if (timer.state === "absent" && !pendingHelper(changes, ids.timer)) occReasons.push(`${ids.timer} is missing`);
      if (occupied.state === "absent" && !pendingHelper(changes, ids.occupied)) occReasons.push(`${ids.occupied} is missing`);
      if (toggle.state === "absent" && !pendingHelper(changes, ids.switch)) occReasons.push(`${ids.switch} is missing`);
    }
    // The timer's duration, when Home Assistant says it and it isn't the hold timeout.
    const timerDiffers = durationDiffers(ids.timer, timer, holdSeconds);
    if (occInstalled && timerDiffers) occReasons.push(`The hold timer is ${timerNow(ids.timer)! / 60} min, the hold timeout says ${holdMinutes}`);
    const occStatus = statusOf(occupancyId, occMissing, occReasons);

    const occInputs: ChangeInput[] = [];
    if (occStatus === "ready" || occStatus === "out-of-date") {
      occInputs.push(...blueprintInput("occupancy"));
      if (timer.state === "absent" && !pendingHelper(changes, ids.timer)) {
        occInputs.push(timerCreate(`${area.name} hold`, ids.timer, holdSeconds));
      } else if (timerDiffers) {
        occInputs.push(timerUpdate(ids.timer, holdSeconds));
      }
      if (toggle.state === "absent" && !pendingHelper(changes, ids.switch)) {
        occInputs.push({ kind: "helper", op: "create", fields: { helper: "input_boolean", name: `${area.name} automations paused`, entity_id: ids.switch, area_id: area.id, icon: "mdi:pause-circle-outline" } });
      }
      if (occupied.state === "absent" && !pendingHelper(changes, ids.occupied)) {
        occInputs.push({
          kind: "helper",
          op: "create",
          fields: { helper: "template", name: `${area.name} occupied`, entity_id: ids.occupied, area_id: area.id, state_template: `{{ is_state('${ids.timer}','active') }}`, device_class: "occupancy" },
        });
      }
      occInputs.push(automationInput("occupancy", occupancyId, occupancyInput));
    }
    out.push({
      areaId: area.id,
      areaName: area.name,
      recipe: "occupancy",
      status: occStatus,
      missing: occStatus === "missing" ? occMissing : [],
      reasons: occStatus === "out-of-date" ? occReasons : [],
      notes: [],
      controlledBy: [],
      inputs: occInputs,
      actionable: occInputs.length > 0,
    });

    // What the recipes that follow Occupancy need of it: the automation, installed
    // or in the list, and the occupied sensor and pause switch it makes.
    const needsOccupancy = (): string[] => {
      if (!(occInstalled || pendingAutomation(changes, occupancyId))) return ["Occupancy (install it first)"];
      if (!usable) return ["An area code that makes valid entity ids (Settings)"];
      return ([[ids.occupied, occupied], [ids.switch, toggle]] as const)
        .filter(([id, held]) => held.state === "absent" && !pendingHelper(changes, id))
        .map(([id]) => `${id} is missing (the Occupancy recipe makes it)`);
    };

    // ---- Motion lights ----------------------------------------------------
    const lightsId = canonicalId("light", code, suffix.lights);
    const lights = h.entities[lightsId];
    const lightsPending = pendingHelper(changes, lightsId) || pendingRename(changes, lightsId);
    const luxId = canonicalId("sensor", code, suffix.illuminance);
    const lux = h.entities[luxId]?.platform === "min_max" ? luxId : null;
    // The counted lights by role. Task lights are never switched on by the
    // recipe; the light group still turns them off.
    const lightsOf = (role: LightRole) => inv.lights.filter((r) => r.counts && r.light === role).map((r) => r.entityId).sort();
    const mainLights = lightsOf("main");
    const accentLights = lightsOf("accent");
    const nightLights = lightsOf("night");
    const overrideMinutes = values.override_duration as number;
    // The automation sets the length itself each time it starts the timer; this
    // is the one the helper shows. Without a fixed override time it is a placeholder.
    const overrideSeconds = overrideMinutes > 0 ? overrideMinutes * 60 : OVERRIDE_PLACEHOLDER_SECONDS;
    const motionInput: Record<string, unknown> = {
      occupied_entity: ids.occupied,
      light_target: lightsId,
      main_lights: mainLights,
      accent_lights: accentLights,
      night_lights: nightLights,
      bed_entities: bedSensors,
      ...(lux ? { lux_entity: lux } : {}),
      lux_threshold: values.lux_threshold,
      night_start: withSeconds(values.night_start as string),
      night_end: withSeconds(values.night_end as string),
      day_brightness: values.day_brightness,
      day_kelvin: values.day_kelvin,
      night_brightness: values.night_brightness,
      night_kelvin: values.night_kelvin,
      transition: values.transition,
      dim_before_off: values.dim_before_off,
      dim_level: values.dim_level,
      extended_after: values.extended_after,
      override_timer: ids.override,
      override_minutes: overrideMinutes,
      pause_switch: ids.switch,
    };

    const lightMissing: string[] = needsOccupancy();
    if (!lights) {
      if (!lightsPending) lightMissing.push("A light group (make it on the Helpers tab)");
    } else if (lights.domain !== "light" || lights.platform !== "group") {
      lightMissing.push(`${lightsId} is already used by “${lights.name}”`);
    }
    const overrideTaken = usable ? taken(ids.override, overrideTimer) : null;
    if (overrideTaken) lightMissing.push(overrideTaken);

    const motionReasons = automationReasons("motion_lights", motionId, motionInput);
    const motionInstalled = Boolean(installed.automations[motionId]);
    if (motionInstalled) {
      motionReasons.push(...blueprintReason("motion_lights"));
      if (overrideTimer.state === "absent" && !pendingHelper(changes, ids.override)) motionReasons.push(`${ids.override} is missing`);
    }
    const overrideDiffers = durationDiffers(ids.override, overrideTimer, overrideSeconds);
    if (motionInstalled && overrideDiffers) motionReasons.push(`The override timer is ${timerNow(ids.override)! / 60} min, the override setting says ${overrideSeconds / 60}`);
    const motionStatus = statusOf(motionId, lightMissing, motionReasons);
    const motionInputs: ChangeInput[] = [];
    if (motionStatus === "ready" || motionStatus === "out-of-date") {
      motionInputs.push(...blueprintInput("motion_lights"));
      if (overrideTimer.state === "absent" && !pendingHelper(changes, ids.override)) {
        motionInputs.push(timerCreate(`${area.name} override`, ids.override, overrideSeconds));
      } else if (overrideDiffers) {
        motionInputs.push(timerUpdate(ids.override, overrideSeconds));
      }
      motionInputs.push(automationInput("motion_lights", motionId, motionInput));
    }
    const notes: string[] = [];
    if (!lux) notes.push("No light level helper yet, so the lights go on at any light level");
    if (mainLights.length === 0 && inv.lights.some((r) => r.counts)) {
      notes.push(nightLights.length > 0 ? "No main lights, so only the night lights go on" : "No main lights, so no light goes on by day (set a light's role on the area's Capabilities tab)");
    }
    if (bedSensors.length > 0 && nightLights.length === 0) notes.push("No night lights, so no light goes on while someone is in bed");
    out.push({
      areaId: area.id,
      areaName: area.name,
      recipe: "motion_lights",
      status: motionStatus,
      missing: motionStatus === "missing" ? lightMissing : [],
      reasons: motionStatus === "out-of-date" ? motionReasons : [],
      notes: motionStatus === "missing" ? [] : notes,
      controlledBy: motionStatus === "missing" ? [] : installed.controllers[lightsId] ?? [],
      inputs: motionInputs,
      actionable: motionInputs.length > 0,
    });

    // ---- Media off --------------------------------------------------------
    const speakers = inv.speaker.filter((r) => r.counts).map((r) => r.entityId).sort();
    const tvs = inv.tv.filter((r) => r.counts).map((r) => r.entityId).sort();
    const mediaId = canonicalId("media_player", code, suffix.media);
    const media = h.entities[mediaId];
    const mediaThere = (media?.domain === "media_player" && media.platform === "group") || (!media && (pendingHelper(changes, mediaId) || pendingRename(changes, mediaId)));
    // The media group takes the place of the players when the area has one kind
    // only: with speakers and TVs the two need their own times.
    const oneKind = speakers.length + tvs.length >= 2 && (speakers.length === 0 || tvs.length === 0);
    const viaGroup = mediaThere && oneKind;
    const mediaInput: Record<string, unknown> = {
      occupied_entity: ids.occupied,
      speaker_entities: viaGroup && speakers.length > 0 ? [mediaId] : speakers,
      tv_entities: viaGroup && tvs.length > 0 ? [mediaId] : tvs,
      speaker_minutes: values.media_off_after,
      tv_minutes: values.tv_off_after,
      pause_switch: ids.switch,
    };
    const mediaMissing: string[] = needsOccupancy();
    if (speakers.length + tvs.length === 0) mediaMissing.push("A speaker or a TV that counts (Capabilities)");
    const mediaReasons = automationReasons("media_off", mediaOffId, mediaInput);
    if (installed.automations[mediaOffId]) mediaReasons.push(...blueprintReason("media_off"));
    const mediaStatus = statusOf(mediaOffId, mediaMissing, mediaReasons);
    const mediaInputs: ChangeInput[] = [];
    if (mediaStatus === "ready" || mediaStatus === "out-of-date") mediaInputs.push(...blueprintInput("media_off"), automationInput("media_off", mediaOffId, mediaInput));
    out.push({
      areaId: area.id,
      areaName: area.name,
      recipe: "media_off",
      status: mediaStatus,
      missing: mediaStatus === "missing" ? mediaMissing : [],
      reasons: mediaStatus === "out-of-date" ? mediaReasons : [],
      notes: [],
      controlledBy: [],
      inputs: mediaInputs,
      actionable: mediaInputs.length > 0,
    });
  }
  return out;
}

// The changes for the chosen cells, in order, each blueprint once.
export function recipeChangeInputs(cells: readonly RecipeCell[]): ChangeInput[] {
  const seen = new Set<string>();
  const out: ChangeInput[] = [];
  for (const cell of cells) {
    for (const input of cell.inputs) {
      const key = input.kind === "blueprint" ? `blueprint:${String(input.fields?.path)}` : null;
      if (key) {
        if (seen.has(key)) continue;
        seen.add(key);
      }
      out.push(input);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Timer durations: Home Assistant writes them "0:05:00".
// ---------------------------------------------------------------------------

// Seconds, from "H:MM:SS" (or "HH:MM:SS"), or null when it isn't one.
export function parseDuration(v: unknown): number | null {
  const m = typeof v === "string" ? /^(\d{1,3}):([0-5]\d):([0-5]\d)(?:\.\d+)?$/.exec(v.trim()) : null;
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : null;
}

export function formatDuration(seconds: number): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(Math.floor(seconds / 3600))}:${pad(Math.floor((seconds % 3600) / 60))}:${pad(seconds % 60)}`;
}

// The canonical light group of every area that has one in Home Assistant: the
// lights a recipe controls, and the ones to ask what else controls them.
export function canonicalLightGroups(h: Hierarchy, naming: NamingSettings): string[] {
  const codes = areaCodes(h, naming);
  const suffix = effectiveSuffixes(naming.helperNames).lights;
  return Object.values(h.areas)
    .map((a) => canonicalId("light", codes[a.id].code, suffix))
    .filter((id) => h.entities[id]?.platform === "group");
}
