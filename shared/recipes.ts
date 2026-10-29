import { ANNOUNCE_PATH, ANNOUNCE_SCRIPT_ID, blueprintForRecipe, type AreaRecipeKey, type HouseRecipeKey, type RecipeKey } from "./blueprints.ts";
import { ENTITY_ID_RE, sameValue } from "./changes.ts";
import { HOUSE_AWAY_ID, HOUSE_SLEEP_ID, kindRunsIn, type Season } from "./climate.ts";
import { RECIPE_HELPER_SUFFIX, areaCodeConflicts, canonicalId, helperSuffixes, helperExclusions } from "./helpers.ts";
import { CLIMATE_KIND_LABEL, areaChoice, areaInventory, type InventorySettings, type LightRole } from "./inventory.ts";
import { areaCodes, type NamingSettings } from "./naming.ts";
import { entryLights, resolve, resolveAll, resolveIn, withSeconds, type ParameterSettings } from "./parameters.ts";
import { canonicalPeriods, DEFAULT_COMFORT_PERIODS } from "./periods.ts";
import { planHouseModes, recipeHouseModes } from "./house-modes.ts";
import type { Change, ChangeInput, Hierarchy } from "./types.ts";

// Recipes: for each area, whether Taxis can install a recipe (an automation made
// from a Taxis blueprint, with the helpers it needs), what is missing when it
// can't, and whether an installed one still matches the sensors and parameters.
// Pure functions; nothing here changes anything. Applying lives in
// server/changes/helpers.ts and server/changes/recipes.ts.

// The recipes that are an automation for one area, one column each in the Recipes
// table. Announce, the script for the whole house, is planned apart (planAnnounce).
export const RECIPES: readonly { key: AreaRecipeKey; label: string }[] = [
  { key: "occupancy", label: "Occupancy" },
  { key: "motion_lights", label: "Motion lights" },
  { key: "media_off", label: "Media off" },
  { key: "area_climate", label: "Area climate" },
  { key: "bathroom_fan", label: "Bathroom fan" },
  { key: "exterior_lights", label: "Exterior lights" },
  { key: "left_open", label: "Left open" },
  { key: "appliance_done", label: "Appliance done" },
  { key: "leak_alert", label: "Leak alert" },
  { key: "covers_sun", label: "Covers and sun" },
];

// The recipes of the house, one cell each (shared/recipes-house.ts), with the label they show.
export const HOUSE_RECIPE_LABEL: Record<HouseRecipeKey, string> = {
  announce: "Announce",
  goodbye: "Goodbye",
  house_presence: "House presence",
  battery_low: "Low batteries",
  unavailable_watch: "Not reporting",
};

export const RECIPE_LABEL = { ...Object.fromEntries(RECIPES.map((r) => [r.key, r.label])), ...HOUSE_RECIPE_LABEL } as Record<RecipeKey, string>;

export const ANNOUNCE_ALIAS = "Announce (Taxis)";

export const automationIdFor = (recipe: RecipeKey, code: string) => `taxis_${recipe}_${code}`;

export const automationAlias = (areaName: string, recipe: RecipeKey) => `${areaName} – ${RECIPE_LABEL[recipe]} (Taxis)`;

// The helpers the recipes of an area need, by entity id: the hold timer, the
// occupied sensor and the pause switch (Occupancy makes them, the others use
// them), the manual override timer (Motion lights, Exterior lights), the comfort
// schedule (Area climate) and the humidity rate sensor (Bathroom fan).
export function runtimeIds(code: string) {
  return {
    timer: `timer.${code}_${RECIPE_HELPER_SUFFIX.hold}`,
    occupied: `binary_sensor.${code}_${RECIPE_HELPER_SUFFIX.occupied}`,
    switch: `input_boolean.${code}_${RECIPE_HELPER_SUFFIX.switch}`,
    override: `timer.${code}_${RECIPE_HELPER_SUFFIX.override}`,
    schedule: `schedule.${code}_${RECIPE_HELPER_SUFFIX.climate}`,
    rate: `sensor.${code}_${RECIPE_HELPER_SUFFIX.humidityRate}`,
  };
}

// The rate below which the humidity counts as flat, in % per second. The Bathroom
// fan blueprint has it as an input but it is not a parameter.
export const FAN_FLAT_RATE = 0.001;

// What the derivative sensor of the humidity smooths over: two minutes, so a
// sensor that reports every few seconds doesn't make the rate jump about.
export const RATE_WINDOW = { hours: 0, minutes: 2, seconds: 0 } as const;

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
  // Script id -> its stored config (taxis_announce), null when there is none.
  scripts: Record<string, InstalledAutomation | null>;
  // Timer entity id -> its duration in seconds, when Home Assistant says.
  timers: Record<string, number | null>;
  // Canonical light group, or a thermostat -> other automations that use it.
  controllers: Record<string, { entityId: string; name: string }[]>;
};

export const NOTHING_INSTALLED: RecipeInstalled = { blueprints: {}, automations: {}, scripts: {}, timers: {}, controllers: {} };

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
  // Other automations that already control this area's light group (Motion
  // lights) or thermostats (Area climate).
  controlledBy: { entityId: string; name: string }[];
  // What controlledBy is about.
  controls: "lights" | "thermostats";
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
  guest_entity: "Guest mode switch",
  guest_entities: "Guest mode switches",
  guest_pause_lighting: "Guest mode pauses automatic lighting",
  guest_pause_media: "Guest mode keeps media on",
  entry_lights: "Entry lights",
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
  rate_entities: "Humidity rate sensor",
  rate_hold: "Shower holds occupied at (%/s)",
  humidity_entity: "Humidity sensor",
  rate_entity: "Humidity rate sensor",
  reference_entity: "Reference humidity sensor",
  fan_entities: "Fan",
  rate_on: "Fan on: rise rate (%/s)",
  delta_on: "Fan on: above the reference (%)",
  abs_on: "Fan on: humidity (%)",
  delta_off: "Fan off: within the reference (%)",
  flat_rate: "Flat rate (%/s)",
  flat_minutes: "Fan off: flat for (min)",
  max_minutes: "Fan off: after at most (min)",
  suppress_in_sleep: "Not while the house sleeps",
  motion_entities: "Motion sensors",
  person_entities: "People",
  sunset_offset: "Sunset offset (s)",
  clock_minutes: "Stay on for (min)",
  door_entities: "Doors",
  window_entities: "Windows",
  door_minutes: "Door open for (min)",
  window_minutes: "Window open for (min)",
  repeat_minutes: "Repeat every (min)",
  notify_targets: "Notify services",
  area_name: "Area name",
  power_entities: "Appliances",
  run_watts: "Running above (W)",
  run_minutes: "Running for (min)",
  idle_watts: "Done below (W)",
  idle_minutes: "Done for (min)",
  tts_entity: "Text-to-speech",
  default_volume: "Default volume (%)",
  climate_entities: "Thermostats",
  opening_entities: "Windows and doors",
  occupied_entities: "Occupied sensor",
  is_bedroom: "Bedroom",
  away_entity: "Away switch",
  sleep_entity: "Sleep switch",
  schedule_entity: "Comfort schedule",
  temperature_entity: "Temperature sensor",
  comfort_periods: "Comfort periods",
  comfort_needs_occupancy: "Comfort needs occupancy",
  season: "Season",
  auto_hvac_on: "Switch thermostats on and off",
  comfort_temp: "Comfort temperature",
  eco_temp: "Eco temperature",
  night_temp: "Night temperature",
  sleep_temp: "Sleep temperature",
  away_temp: "Away temperature",
  cool_comfort_temp: "Cooling comfort temperature",
  cool_eco_temp: "Cooling eco temperature",
  cool_night_temp: "Cooling night temperature",
  cool_away_temp: "Cooling away temperature",
  frost_temp: "Frost protection temperature",
  min_temp: "Lowest temperature",
  max_temp: "Highest temperature",
  window_delay: "Window open for (min)",
  restore_delay: "Restore after close (min)",
  eco_after_clear: "Eco when clear for (min)",
  preset_comfort: "Comfort preset",
  preset_eco: "Eco preset",
  preset_away: "Away preset",
  preset_sleep: "Sleep preset",
  leak_entities: "Leak sensors",
  valve_entity: "Water valve",
  cover_entities: "Covers",
  sun_elevation: "Close when the sun is above (°)",
  facing_from: "Window faces from (°)",
  facing_to: "Window faces to (°)",
  temperature_above: "and it is warmer than (°)",
  window_start: "Close from",
  window_end: "Close until",
  open_time: "Open at",
  open_at_sunrise: "Open at sunrise",
  sunrise_offset: "Sunrise offset (s)",
  threshold: "Battery low below (%)",
  report_time: "Report at",
  watch_entities: "Watched entities",
  unavailable_minutes: "Not reporting for (min)",
  away_after_minutes: "Away after (min)",
  end_on_return: "Away ends when someone returns",
  media_entities: "Media players",
};

export const show = (v: unknown): string =>
  v === undefined || v === null || v === "" ? "none" : Array.isArray(v) ? (v.length ? v.join(", ") : "none") : String(v);

// Nothing, an empty list and an empty string are all "none": a blueprint takes
// the same default for each.
const none = (v: unknown) => v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);

// What differs between the inputs an automation has and the ones Taxis would
// send, in words.
export function inputDifferences(was: Record<string, unknown>, now: Record<string, unknown>): string[] {
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

export const pendingHelper = (changes: readonly Change[], id: string) =>
  changes.some((c) => c.kind === "helper" && (c.targetId === id || c.after.entity_id === id));
export const pendingRename = (changes: readonly Change[], id: string) => changes.some((c) => c.kind === "entity" && c.after.new_entity_id === id);
const pendingDuration = (changes: readonly Change[], id: string) =>
  changes.some((c) => c.kind === "helper" && c.op === "update" && c.targetId === id && "duration" in c.after);
const pendingPeriods = (changes: readonly Change[], id: string) =>
  changes.some((c) => c.kind === "helper" && c.op === "update" && c.targetId === id && "periods" in c.after);
export const pendingAutomation = (changes: readonly Change[], id: string) => changes.some((c) => c.kind === "automation" && c.targetId === id);
export const pendingScript = (changes: readonly Change[], id: string) => changes.some((c) => c.kind === "script" && c.targetId === id);
export const pendingBlueprint = (changes: readonly Change[], path: string, version: number) =>
  changes.some((c) => c.kind === "blueprint" && c.targetId === path && c.after.version === version);

// A helper of the recipes in Home Assistant: absent, as it should be, or the
// id is held by something Taxis can't use.
export type Held = { state: "absent" } | { state: "ok" } | { state: "taken"; name: string };

export function heldBy(h: Hierarchy, id: string, domain: string, platform?: string): Held {
  const e = h.entities[id];
  if (!e) return { state: "absent" };
  // A timer or a toggle has to be set up in the UI to be edited; a template
  // sensor has to be one made by a config entry.
  const mine = e.domain === domain && e.inRegistry && (platform ? e.platform === platform && e.configEntryId !== null : e.platform === domain);
  return mine ? { state: "ok" } : { state: "taken", name: e.name };
}

export const taken = (id: string, held: Held) => (held.state === "taken" ? `${id} is already used by “${held.name}”` : null);

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
  const conflicts = areaCodeConflicts(h, naming);
  const exclusions = helperExclusions(h, naming);
  const suffix = helperSuffixes(naming);
  const out: RecipeCell[] = [];

  for (const area of Object.values(h.areas)) {
    const code = codes[area.id].code;
    const ids = runtimeIds(code);
    const values = resolveAll(params, h, inventory, area.id);
    const houseModes = planHouseModes(h, params, inventory, changes, area.id);
    const modes = recipeHouseModes(houseModes);
    const modeProblems = (keys: string[]) =>
      houseModes.filter((row) => keys.includes(row.key) && row.status === "review").map((row) => `${row.label} mode: ${row.detail} (${row.id})`);
    const guestInput = modes.guest ? { guest_entity: modes.guest } : {};
    const inv = areaInventory(h, inventory, area.id, exclusions(area.id));
    const usable = [ids.timer, ids.occupied, ids.switch, ids.override, ids.schedule, ids.rate].every((id) => ENTITY_ID_RE.test(id));

    // Optional helpers: used when they are in place or already in the change list.
    const groupThere = (id: string, platform: string) =>
      h.entities[id]?.platform === platform || (!h.entities[id] && (pendingHelper(changes, id) || pendingRename(changes, id)));

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
      fields: {
        automation_id: id,
        recipe,
        area_id: area.id,
        alias: automationAlias(area.name, recipe),
        use_blueprint: { path: blueprintForRecipe(recipe).path, input },
      },
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
      const conflict = conflicts.get(area.id);
      if (conflict) {
        missing.push(conflict);
        return "missing";
      }
      if (pendingAutomation(changes, id)) return "in-changes";
      if (missing.length > 0) return "missing";
      if (installed.automations[id]) return reasons.length === 0 ? "installed" : "out-of-date";
      return "ready";
    };

    // A timer that exists but is not as long as it should be.
    const timerNow = (id: string) => installed.timers[id] ?? null;
    const durationDiffers = (id: string, held: Held, seconds: number) =>
      held.state === "ok" && timerNow(id) !== null && timerNow(id) !== seconds && !pendingDuration(changes, id);

    const timerCreate = (name: string, id: string, seconds: number): ChangeInput => ({
      kind: "helper",
      op: "create",
      fields: { helper: "timer", name, entity_id: id, area_id: area.id, duration: seconds },
    });
    const timerUpdate = (id: string, seconds: number): ChangeInput => ({ kind: "helper", op: "update", targetId: id, fields: { duration: seconds } });

    // The sensors of the area that sleep is read from: bed sensors, in a bedroom.
    const bedSensors = areaChoice(inventory, area.id).bedroom
      ? inv.presence
          .filter((r) => r.counts && r.bed)
          .map((r) => r.entityId)
          .sort()
      : [];

    // ---- Occupancy --------------------------------------------------------
    const sources = [...inv.motion, ...inv.presence].filter((r) => r.counts);
    const starts = sources
      .filter((r) => r.role === "starts")
      .map((r) => r.entityId)
      .sort();
    const holds = sources
      .filter((r) => r.role === "holds")
      .map((r) => r.entityId)
      .sort();
    const holdMinutes = values.hold_timeout as number;
    const holdSeconds = holdMinutes * 60;
    const occupancyInput = {
      starts_entities: starts,
      holds_entities: holds,
      bed_entities: bedSensors,
      rate_entities: groupThere(ids.rate, "derivative") ? [ids.rate] : [],
      rate_hold: values.humidity_hold_rate,
      occupied_entity: ids.occupied,
      hold_timer: ids.timer,
      hold_minutes: holdMinutes,
      extended_after: values.extended_after,
      extended_hold: values.extended_hold,
      sleep_hold: values.sleep_hold,
      pause_switch: ids.switch,
    };

    const occMissing: string[] = [];
    if (starts.length === 0)
      occMissing.push(sources.length === 0 ? "A motion or presence sensor" : "A sensor that starts occupancy (the counted ones are all set to hold)");
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
        occInputs.push({
          kind: "helper",
          op: "create",
          fields: {
            helper: "input_boolean",
            name: `${area.name} automations paused`,
            entity_id: ids.switch,
            area_id: area.id,
            icon: "mdi:pause-circle-outline",
          },
        });
      }
      if (occupied.state === "absent" && !pendingHelper(changes, ids.occupied)) {
        occInputs.push({
          kind: "helper",
          op: "create",
          fields: {
            helper: "template",
            name: `${area.name} occupied`,
            entity_id: ids.occupied,
            area_id: area.id,
            state_template: `{{ is_state('${ids.timer}','active') }}`,
            device_class: "occupancy",
          },
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
      controls: "lights",
      inputs: occInputs,
      actionable: occInputs.length > 0,
    });

    // What the recipes that follow Occupancy need of it: the automation, installed
    // or in the list, and the occupied sensor and pause switch it makes.
    const needsOccupancy = (): string[] => {
      if (!(occInstalled || pendingAutomation(changes, occupancyId))) return ["Occupancy (install it first)"];
      if (!usable) return ["An area code that makes valid entity ids (Settings)"];
      return (
        [
          [ids.occupied, occupied],
          [ids.switch, toggle],
        ] as const
      )
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
    const lightsOf = (role: LightRole) =>
      inv.lights
        .filter((r) => r.counts && r.light === role)
        .map((r) => r.entityId)
        .sort();
    const mainLights = lightsOf("main");
    // The lights that come on by day: the chosen entry lights, else the only light
    // of the area, else its main lights.
    const entry = entryLights(params, area.id, inv.lights);
    const accentLights = lightsOf("accent");
    const nightLights = lightsOf("night");
    const overrideMinutes = values.override_duration as number;
    // The automation sets the length itself each time it starts the timer; this
    // is the one the helper shows. Without a fixed override time it is a placeholder.
    const overrideSeconds = overrideMinutes > 0 ? overrideMinutes * 60 : OVERRIDE_PLACEHOLDER_SECONDS;
    const motionInput: Record<string, unknown> = {
      occupied_entity: ids.occupied,
      light_target: lightsId,
      entry_lights: entry.lights,
      main_lights: mainLights,
      accent_lights: accentLights,
      night_lights: nightLights,
      bed_entities: bedSensors,
      ...(areaChoice(inventory, area.id).bedroom ? { is_bedroom: true } : {}),
      ...(modes.away ? { away_entity: modes.away } : {}),
      ...(modes.sleep ? { sleep_entity: modes.sleep } : {}),
      ...guestInput,
      ...(modes.guest ? { guest_pause_lighting: values.guest_pause_lighting } : {}),
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

    const lightMissing: string[] = [...needsOccupancy(), ...modeProblems(["away", "sleep", "guest"])];
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
    if (motionInstalled && overrideDiffers)
      motionReasons.push(`The override timer is ${timerNow(ids.override)! / 60} min, the override setting says ${overrideSeconds / 60}`);
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
    if (entry.lights.length === 0 && inv.lights.some((r) => r.counts)) {
      notes.push(
        nightLights.length > 0
          ? "No entry or main lights, so only the night lights go on"
          : "No entry or main lights, so no light goes on by day (set an entry light, or a light's role, on the area's Capabilities tab)",
      );
    }
    if (entry.set && entry.source !== "set") notes.push("The entry lights set for this area don't count here any more, so the suggested ones are used");
    if (bedSensors.length > 0 && nightLights.length === 0) notes.push("No night lights, so no light goes on while someone is in bed");
    out.push({
      areaId: area.id,
      areaName: area.name,
      recipe: "motion_lights",
      status: motionStatus,
      missing: motionStatus === "missing" ? lightMissing : [],
      reasons: motionStatus === "out-of-date" ? motionReasons : [],
      notes: motionStatus === "missing" ? [] : notes,
      controlledBy: motionStatus === "missing" ? [] : (installed.controllers[lightsId] ?? []),
      controls: "lights",
      inputs: motionInputs,
      actionable: motionInputs.length > 0,
    });

    // ---- Media off --------------------------------------------------------
    const speakers = inv.speaker
      .filter((r) => r.counts)
      .map((r) => r.entityId)
      .sort();
    const tvs = inv.tv
      .filter((r) => r.counts)
      .map((r) => r.entityId)
      .sort();
    const mediaId = canonicalId("media_player", code, suffix.media);
    const media = h.entities[mediaId];
    const mediaThere =
      (media?.domain === "media_player" && media.platform === "group") || (!media && (pendingHelper(changes, mediaId) || pendingRename(changes, mediaId)));
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
      ...guestInput,
      ...(modes.guest ? { guest_pause_media: values.guest_pause_media } : {}),
      pause_switch: ids.switch,
    };
    const mediaMissing: string[] = [...needsOccupancy(), ...modeProblems(["guest"])];
    if (speakers.length + tvs.length === 0) mediaMissing.push("A speaker or a TV that counts (Capabilities)");
    const mediaReasons = automationReasons("media_off", mediaOffId, mediaInput);
    if (installed.automations[mediaOffId]) mediaReasons.push(...blueprintReason("media_off"));
    const mediaStatus = statusOf(mediaOffId, mediaMissing, mediaReasons);
    const mediaInputs: ChangeInput[] = [];
    if (mediaStatus === "ready" || mediaStatus === "out-of-date")
      mediaInputs.push(...blueprintInput("media_off"), automationInput("media_off", mediaOffId, mediaInput));
    out.push({
      areaId: area.id,
      areaName: area.name,
      recipe: "media_off",
      status: mediaStatus,
      missing: mediaStatus === "missing" ? mediaMissing : [],
      reasons: mediaStatus === "out-of-date" ? mediaReasons : [],
      notes: [],
      controlledBy: [],
      controls: "lights",
      inputs: mediaInputs,
      actionable: mediaInputs.length > 0,
    });

    // ---- Area climate -----------------------------------------------------
    const climateId = automationIdFor("area_climate", code);
    // An AC runs in both seasons, heating and radiator valves in the heating season only.
    const season = values.season as Season;
    const climateCounted = inv.thermostat.filter((r) => r.counts);
    const thermostats = climateCounted
      .filter((r) => kindRunsIn(r.climate ?? "heating", season))
      .map((r) => r.entityId)
      .sort();
    const climateSkipped = climateCounted.filter((r) => !thermostats.includes(r.entityId));
    const bedroom = areaChoice(inventory, area.id).bedroom;
    const text = (k: "away_mode_entity" | "sleep_mode_entity" | "preset_comfort" | "preset_eco" | "preset_away" | "preset_sleep") => String(values[k] ?? "");
    // The house switches: the ones the user picked, else the two Taxis makes.
    const awayPicked = text("away_mode_entity");
    const sleepPicked = text("sleep_mode_entity");
    const awayId = awayPicked || HOUSE_AWAY_ID;
    const sleepId = sleepPicked || HOUSE_SLEEP_ID;
    const climateMissing: string[] = [];
    // A house switch: the one the user picked (which has to exist), else the one Taxis makes.
    // What stops a recipe is put in `missing`.
    const houseSwitch = (missing: string[], id: string, picked: string, what: string, name: string, icon: string): ChangeInput[] => {
      if (picked) {
        const e = h.entities[picked];
        if (!e) missing.push(`The ${what} switch “${picked}” isn't in Home Assistant (Parameters, House)`);
        else if (e.domain !== "input_boolean") missing.push(`The ${what} switch “${picked}” isn't a toggle (an input boolean)`);
        else if (e.disabled || !["on", "off"].includes(e.state ?? "")) missing.push(`The ${what} switch “${picked}” is disabled or unavailable`);
        return [];
      }
      const held = heldBy(h, id, "input_boolean");
      if (held.state === "taken") {
        missing.push(`${id} is already used by “${held.name}”. Pick a switch of your own for ${what} (Parameters, House)`);
        return [];
      }
      if (held.state === "ok" && (h.entities[id].disabled || !["on", "off"].includes(h.entities[id].state ?? ""))) {
        missing.push(`The ${what} switch “${id}” is disabled or unavailable`);
        return [];
      }
      if (held.state === "ok" || pendingHelper(changes, id)) return [];
      return [{ kind: "helper", op: "create", fields: { helper: "input_boolean", name, entity_id: id, icon } }];
    };
    const houseInputs = [
      ...houseSwitch(climateMissing, awayId, awayPicked, "away mode", "Taxis away mode", "mdi:home-export-outline"),
      ...houseSwitch(climateMissing, sleepId, sleepPicked, "sleep mode", "Taxis sleep mode", "mdi:sleep"),
    ];

    climateMissing.push(...modeProblems(["guest"]));

    const windowId = canonicalId("binary_sensor", code, suffix.window);
    const doorId = canonicalId("binary_sensor", code, suffix.door);
    const tempId = canonicalId("sensor", code, suffix.temperature);
    const doorsCount = values.doors_open_count === true;
    const openings = [groupThere(windowId, "group") ? windowId : null, doorsCount && groupThere(doorId, "group") ? doorId : null].filter(
      (x): x is string => x !== null,
    );
    const tempThere = groupThere(tempId, "min_max");
    const occupiedThere = (occInstalled || pendingAutomation(changes, occupancyId)) && (occupied.state === "ok" || pendingHelper(changes, ids.occupied));
    // A bedroom that hasn't been given a choice doesn't need anyone in it for comfort.
    const needsResolved = resolve(params, h, inventory, area.id, "comfort_needs_occupancy");
    const comfortNeedsOccupancy = needsResolved.source.level === "default" && bedroom ? false : needsResolved.value === true;

    // The comfort schedule is made by Taxis unless the user's own is in place; the
    // periods Taxis wrote are kept in the automation, so a change in the parameter
    // is seen (Taxis cannot read a schedule's periods back).
    const schedule = heldBy(h, ids.schedule, "schedule");
    const periods = canonicalPeriods(values.comfort_periods) ?? DEFAULT_COMFORT_PERIODS;
    const climateThere = installed.automations[climateId];
    const wrote = typeof climateThere?.input.comfort_periods === "string" ? climateThere.input.comfort_periods : "";
    const scheduleCreate = schedule.state === "absent" && !pendingHelper(changes, ids.schedule);
    const managed = schedule.state === "absent" || pendingHelper(changes, ids.schedule) || (Boolean(climateThere) && wrote !== "");
    const climateInput: Record<string, unknown> = {
      climate_entities: thermostats,
      opening_entities: openings,
      occupied_entities: occupiedThere ? [ids.occupied] : [],
      bed_entities: bedSensors,
      is_bedroom: bedroom,
      away_entity: awayId,
      ...(modes.guest ? { guest_entities: [modes.guest] } : {}),
      sleep_entity: sleepId,
      schedule_entity: ids.schedule,
      ...(tempThere ? { temperature_entity: tempId } : {}),
      comfort_periods: managed ? periods : "",
      comfort_needs_occupancy: comfortNeedsOccupancy,
      season: values.season,
      auto_hvac_on: values.auto_hvac_on,
      comfort_temp: values.comfort_temp,
      eco_temp: values.eco_temp,
      night_temp: values.night_temp,
      sleep_temp: values.sleep_temp,
      away_temp: values.away_temp,
      cool_comfort_temp: values.cool_comfort_temp,
      cool_eco_temp: values.cool_eco_temp,
      cool_night_temp: values.cool_night_temp,
      cool_away_temp: values.cool_away_temp,
      frost_temp: values.frost_temp,
      min_temp: values.min_temp,
      max_temp: values.max_temp,
      window_delay: values.window_delay,
      restore_delay: values.restore_delay,
      eco_after_clear: values.eco_after_clear,
      night_start: withSeconds(values.night_start as string),
      night_end: withSeconds(values.night_end as string),
      preset_comfort: text("preset_comfort"),
      preset_eco: text("preset_eco"),
      preset_away: text("preset_away"),
      preset_sleep: text("preset_sleep"),
      pause_switch: ids.switch,
    };

    if (thermostats.length === 0) {
      climateMissing.push(
        climateSkipped.length > 0
          ? "An air conditioner that counts: heating and radiator valves are not run in the cooling season (Capabilities)"
          : "A thermostat that counts (Capabilities)",
      );
    }
    if (!usable) climateMissing.push("An area code that makes valid entity ids (Settings)");
    else for (const m of [taken(ids.switch, toggle), taken(ids.schedule, schedule)]) if (m) climateMissing.push(m);
    if ((values.min_temp as number) > (values.max_temp as number)) climateMissing.push("The lowest temperature is above the highest (Parameters, Climate)");

    const climateReasons = automationReasons("area_climate", climateId, climateInput);
    if (climateThere) {
      climateReasons.push(...blueprintReason("area_climate"));
      if (toggle.state === "absent" && !pendingHelper(changes, ids.switch)) climateReasons.push(`${ids.switch} is missing`);
      if (schedule.state === "absent" && !pendingHelper(changes, ids.schedule)) climateReasons.push(`${ids.schedule} is missing`);
    }
    const climateStatus = statusOf(climateId, climateMissing, climateReasons);
    const climateInputs: ChangeInput[] = [];
    if (climateStatus === "ready" || climateStatus === "out-of-date") {
      climateInputs.push(...blueprintInput("area_climate"), ...houseInputs);
      if (toggle.state === "absent" && !pendingHelper(changes, ids.switch)) {
        climateInputs.push({
          kind: "helper",
          op: "create",
          fields: {
            helper: "input_boolean",
            name: `${area.name} automations paused`,
            entity_id: ids.switch,
            area_id: area.id,
            icon: "mdi:pause-circle-outline",
          },
        });
      }
      if (scheduleCreate) {
        climateInputs.push({
          kind: "helper",
          op: "create",
          fields: { helper: "schedule", name: `${area.name} climate`, entity_id: ids.schedule, area_id: area.id, periods },
        });
      } else if (schedule.state === "ok" && managed && wrote !== "" && wrote !== periods && !pendingPeriods(changes, ids.schedule)) {
        climateInputs.push({ kind: "helper", op: "update", targetId: ids.schedule, fields: { periods } });
      }
      climateInputs.push(automationInput("area_climate", climateId, climateInput));
    }

    // Which thermostats, and whether each gets presets or temperatures.
    const mapped = [
      ["comfort", text("preset_comfort")],
      ["eco", text("preset_eco")],
      ["away", text("preset_away")],
      ["sleep", text("preset_sleep")],
    ] as const;
    const climateNotes: string[] = [];
    for (const id of thermostats) {
      const offered = h.entities[id]?.presetModes ?? [];
      const using = mapped.filter(([, p]) => p !== "" && offered.includes(p)).map(([k]) => k);
      const how =
        using.length === 0 ? "temperatures" : using.length === mapped.length ? "presets" : `presets for ${using.join(", ")}, temperatures for the rest`;
      climateNotes.push(`${h.entities[id]?.name ?? id}: ${how}`);
      const unknown = mapped.filter(([, p]) => p !== "" && !offered.includes(p));
      if (offered.length > 0 && unknown.length > 0)
        climateNotes.push(
          `${h.entities[id]?.name ?? id} doesn't offer ${unknown.map(([k, p]) => `“${p}” (${k})`).join(", ")}; it gets temperatures for ${unknown.length === 1 ? "that" : "those"}`,
        );
    }
    if (climateSkipped.length > 0)
      climateNotes.push(
        `Not run while cooling: ${climateSkipped.map((r) => `${r.name} (${CLIMATE_KIND_LABEL[r.climate ?? "heating"].toLowerCase()})`).join(", ")}`,
      );
    if (values.season === "off") climateNotes.push("The season is off, so the recipe does nothing");
    if (!occupiedThere) climateNotes.push("No Occupancy yet, so comfort follows the schedule alone");
    if (bedroom && needsResolved.source.level === "default") climateNotes.push("A bedroom: comfort doesn't need anyone in the room unless you set it to");
    if (inv.window.some((r) => r.counts) && !openings.includes(windowId))
      climateNotes.push("The window group isn't made yet, so open windows are not seen (Helpers tab)");
    if (doorsCount && inv.door.some((r) => r.counts) && !openings.includes(doorId))
      climateNotes.push("The door group isn't made yet, so open doors are not seen (Helpers tab)");
    if (!tempThere && values.auto_hvac_on === true)
      climateNotes.push("No temperature helper yet, so a thermostat is switched on without checking the room (Helpers tab)");
    const climateControlled = [...new Map(thermostats.flatMap((id) => installed.controllers[id] ?? []).map((c) => [c.entityId, c])).values()];
    out.push({
      areaId: area.id,
      areaName: area.name,
      recipe: "area_climate",
      status: climateStatus,
      missing: climateStatus === "missing" ? climateMissing : [],
      reasons: climateStatus === "out-of-date" ? climateReasons : [],
      notes: climateStatus === "missing" ? [] : climateNotes,
      controlledBy: climateStatus === "missing" ? [] : climateControlled,
      controls: "thermostats",
      inputs: climateInputs,
      actionable: climateInputs.length > 0,
    });

    // ---- The recipes that follow ----------------------------------------------
    // One cell from what a recipe found: its status, and the changes (built only
    // when it can be added) in the order they have to be applied.
    const finish = (
      recipe: AreaRecipeKey,
      id: string,
      missing: string[],
      reasons: string[],
      notes: string[],
      build: () => ChangeInput[],
      controlledBy: RecipeCell["controlledBy"] = [],
    ): void => {
      const status = statusOf(id, missing, reasons);
      const inputs = status === "ready" || status === "out-of-date" ? build() : [];
      out.push({
        areaId: area.id,
        areaName: area.name,
        recipe,
        status,
        missing: status === "missing" ? missing : [],
        reasons: status === "out-of-date" ? reasons : [],
        notes: status === "missing" ? [] : notes,
        controlledBy: status === "missing" ? [] : controlledBy,
        controls: "lights",
        inputs,
        actionable: inputs.length > 0,
      });
    };
    // The area's pause switch, when nothing has made it yet.
    const pauseSwitch = (): ChangeInput[] =>
      toggle.state === "absent" && !pendingHelper(changes, ids.switch)
        ? [
            {
              kind: "helper",
              op: "create",
              fields: {
                helper: "input_boolean",
                name: `${area.name} automations paused`,
                entity_id: ids.switch,
                area_id: area.id,
                icon: "mdi:pause-circle-outline",
              },
            },
          ]
        : [];
    const switchGone = (installedHere: boolean): string[] =>
      installedHere && toggle.state === "absent" && !pendingHelper(changes, ids.switch) ? [`${ids.switch} is missing`] : [];
    const notifyTargets = values.notify_targets as string[];
    const noTargets = "No notify services are set (Parameters, House), so the message appears in Home Assistant's notifications";

    // ---- Bathroom fan -----------------------------------------------------
    const fanId = automationIdFor("bathroom_fan", code);
    const fans = inv.fan
      .filter((r) => r.counts)
      .map((r) => r.entityId)
      .sort();
    const humidityId = canonicalId("sensor", code, suffix.humidity);
    const rate = heldBy(h, ids.rate, "sensor", "derivative");
    const suppress = values.fan_suppress_in_sleep === true;
    const reference = String(values.fan_reference ?? "");
    const fanMissing: string[] = [];
    if (!inv.humidity.some((r) => r.counts)) fanMissing.push("A humidity sensor that counts (Capabilities)");
    else if (!groupThere(humidityId, "min_max")) fanMissing.push("The humidity helper (Helpers tab)");
    if (fans.length === 0) fanMissing.push("A fan, or a switch marked as a fan (Capabilities)");
    if (!usable) fanMissing.push("An area code that makes valid entity ids (Settings)");
    else for (const m of [taken(ids.rate, rate), taken(ids.switch, toggle)]) if (m) fanMissing.push(m);
    if (reference && !h.entities[reference]) fanMissing.push(`The reference humidity sensor “${reference}” isn't in Home Assistant (Parameters, Bathroom fan)`);
    const fanSleepSwitch = suppress ? houseSwitch(fanMissing, sleepId, sleepPicked, "sleep mode", "Taxis sleep mode", "mdi:sleep") : [];
    const fanInput: Record<string, unknown> = {
      humidity_entity: humidityId,
      rate_entity: ids.rate,
      ...(reference ? { reference_entity: reference } : {}),
      fan_entities: fans,
      rate_on: values.fan_rate_on,
      delta_on: values.fan_delta_on,
      abs_on: values.fan_abs_on,
      delta_off: values.fan_delta_off,
      flat_rate: FAN_FLAT_RATE,
      flat_minutes: values.fan_flat_minutes,
      max_minutes: values.fan_max_minutes,
      suppress_in_sleep: suppress,
      ...(suppress ? { sleep_entity: sleepId } : {}),
      pause_switch: ids.switch,
    };
    const fanThere = Boolean(installed.automations[fanId]);
    const fanReasons = automationReasons("bathroom_fan", fanId, fanInput);
    if (fanThere) {
      fanReasons.push(...blueprintReason("bathroom_fan"), ...switchGone(true));
      if (rate.state === "absent" && !pendingHelper(changes, ids.rate)) fanReasons.push(`${ids.rate} is missing`);
    }
    const fanNotes: string[] = [];
    if (!reference)
      fanNotes.push(
        "No reference humidity sensor, so the fan starts on the rise rate and the humidity level only, and stops when the humidity is back near where it started (Parameters, Bathroom fan)",
      );
    if (values.humidity_hold_rate === 0) fanNotes.push("A shower doesn't hold the area occupied yet (Parameters, Occupancy)");
    finish("bathroom_fan", fanId, fanMissing, fanReasons, fanNotes, () => [
      ...blueprintInput("bathroom_fan"),
      ...pauseSwitch(),
      ...fanSleepSwitch,
      // The rate of the humidity helper, per second, smoothed over two minutes.
      ...(rate.state === "absent" && !pendingHelper(changes, ids.rate)
        ? [
            {
              kind: "helper" as const,
              op: "create" as const,
              fields: { helper: "derivative", name: `${area.name} humidity rate`, entity_id: ids.rate, entities: [humidityId], area_id: area.id },
            },
          ]
        : []),
      automationInput("bathroom_fan", fanId, fanInput),
    ]);

    // ---- Exterior lights --------------------------------------------------
    const exteriorId = automationIdFor("exterior_lights", code);
    const exteriorMissing: string[] = [];
    if (areaChoice(inventory, area.id).type !== "exterior") exteriorMissing.push("An exterior area (Capabilities, Type)");
    if (!lights) {
      if (!lightsPending) exteriorMissing.push("A light group (make it on the Helpers tab)");
    } else if (lights.domain !== "light" || lights.platform !== "group") {
      exteriorMissing.push(`${lightsId} is already used by “${lights.name}”`);
    }
    if (!usable) exteriorMissing.push("An area code that makes valid entity ids (Settings)");
    else for (const m of [taken(ids.switch, toggle), overrideTaken]) if (m) exteriorMissing.push(m);
    const watchers = [...inv.motion, ...inv.presence]
      .filter((r) => r.counts)
      .map((r) => r.entityId)
      .sort();
    const people = Object.values(h.entities)
      .filter((e) => e.domain === "person" && !e.disabled)
      .map((e) => e.entityId)
      .sort();
    const exteriorInput: Record<string, unknown> = {
      light_target: lightsId,
      motion_entities: watchers,
      person_entities: people,
      sunset_offset: (values.exterior_sunset_offset as number) * 60,
      clock_minutes: values.exterior_clock,
      override_timer: ids.override,
      override_minutes: overrideMinutes,
      pause_switch: ids.switch,
    };
    const exteriorThere = Boolean(installed.automations[exteriorId]);
    const exteriorReasons = automationReasons("exterior_lights", exteriorId, exteriorInput);
    if (exteriorThere) {
      exteriorReasons.push(...blueprintReason("exterior_lights"), ...switchGone(true));
      if (overrideTimer.state === "absent" && !pendingHelper(changes, ids.override)) exteriorReasons.push(`${ids.override} is missing`);
      if (overrideDiffers) exteriorReasons.push(`The override timer is ${timerNow(ids.override)! / 60} min, the override setting says ${overrideSeconds / 60}`);
    }
    const exteriorNotes: string[] = [];
    if (watchers.length === 0)
      exteriorNotes.push("No motion sensor counts here (a camera's counts when you say so), so only sunset and a person arriving keep the lights on");
    if (people.length === 0) exteriorNotes.push("Home Assistant has no person, so arriving home turns nothing on");
    if (motionInstalled || pendingAutomation(changes, motionId))
      exteriorNotes.push("Motion lights is installed for this area too, and both switch its lights: one of them is enough");
    finish(
      "exterior_lights",
      exteriorId,
      exteriorMissing,
      exteriorReasons,
      exteriorNotes,
      () => [
        ...blueprintInput("exterior_lights"),
        ...pauseSwitch(),
        ...(overrideTimer.state === "absent" && !pendingHelper(changes, ids.override)
          ? [timerCreate(`${area.name} override`, ids.override, overrideSeconds)]
          : overrideDiffers
            ? [timerUpdate(ids.override, overrideSeconds)]
            : []),
        automationInput("exterior_lights", exteriorId, exteriorInput),
      ],
      installed.controllers[lightsId] ?? [],
    );

    // ---- Left open --------------------------------------------------------
    const leftId = automationIdFor("left_open", code);
    const doors = inv.door
      .filter((r) => r.counts)
      .map((r) => r.entityId)
      .sort();
    const windows = inv.window
      .filter((r) => r.counts)
      .map((r) => r.entityId)
      .sort();
    const leftMissing: string[] = [];
    if (doors.length + windows.length === 0) leftMissing.push("A door or window that counts (Capabilities)");
    if (!usable) leftMissing.push("An area code that makes valid entity ids (Settings)");
    else {
      const m = taken(ids.switch, toggle);
      if (m) leftMissing.push(m);
    }
    const leftInput: Record<string, unknown> = {
      door_entities: doors,
      window_entities: windows,
      door_minutes: values.door_open_after,
      window_minutes: values.window_open_after,
      repeat_minutes: values.left_open_repeat,
      notify_targets: notifyTargets,
      area_name: area.name,
      pause_switch: ids.switch,
    };
    const leftReasons = automationReasons("left_open", leftId, leftInput);
    if (installed.automations[leftId]) leftReasons.push(...blueprintReason("left_open"), ...switchGone(true));
    finish("left_open", leftId, leftMissing, leftReasons, notifyTargets.length === 0 ? [noTargets] : [], () => [
      ...blueprintInput("left_open"),
      ...pauseSwitch(),
      automationInput("left_open", leftId, leftInput),
    ]);

    // ---- Appliance done ---------------------------------------------------
    const applianceId = automationIdFor("appliance_done", code);
    const appliances = inv.power
      .filter((r) => r.counts && r.appliance)
      .map((r) => r.entityId)
      .sort();
    const applianceMissing: string[] = [];
    if (appliances.length === 0) applianceMissing.push("A power sensor that counts and is marked as an appliance (Capabilities)");
    if (!usable) applianceMissing.push("An area code that makes valid entity ids (Settings)");
    else {
      const m = taken(ids.switch, toggle);
      if (m) applianceMissing.push(m);
    }
    if ((values.appliance_run_watts as number) <= (values.appliance_idle_watts as number))
      applianceMissing.push("Running above is not higher than Done below (Parameters, Safety)");
    const applianceInput: Record<string, unknown> = {
      power_entities: appliances,
      run_watts: values.appliance_run_watts,
      run_minutes: values.appliance_run_minutes,
      idle_watts: values.appliance_idle_watts,
      idle_minutes: values.appliance_idle_minutes,
      notify_targets: notifyTargets,
      area_name: area.name,
      pause_switch: ids.switch,
    };
    const applianceReasons = automationReasons("appliance_done", applianceId, applianceInput);
    if (installed.automations[applianceId]) applianceReasons.push(...blueprintReason("appliance_done"), ...switchGone(true));
    const applianceNotes = notifyTargets.length === 0 ? [noTargets] : [];
    if (appliances.some((id) => h.entities[id]?.unit === "kW"))
      applianceNotes.push("A sensor reports kW; the levels are in watts, so set them in kW or use a sensor in W");
    finish("appliance_done", applianceId, applianceMissing, applianceReasons, applianceNotes, () => [
      ...blueprintInput("appliance_done"),
      ...pauseSwitch(),
      automationInput("appliance_done", applianceId, applianceInput),
    ]);

    // ---- Leak alert -------------------------------------------------------
    const leakId = automationIdFor("leak_alert", code);
    const leaks = inv.leak
      .filter((r) => r.counts)
      .map((r) => r.entityId)
      .sort();
    const valve = String(resolveIn(params, [{ level: "house" }], "leak_valve_entity").value ?? "");
    const leakMissing: string[] = [];
    if (leaks.length === 0) leakMissing.push("A leak (moisture) sensor that counts (Capabilities)");
    if (!usable) leakMissing.push("An area code that makes valid entity ids (Settings)");
    else {
      const m = taken(ids.switch, toggle);
      if (m) leakMissing.push(m);
    }
    if (valve && !h.entities[valve]) leakMissing.push(`The water valve “${valve}” isn't in Home Assistant (Parameters, Safety)`);
    const leakInput: Record<string, unknown> = {
      leak_entities: leaks,
      notify_targets: notifyTargets,
      repeat_minutes: values.leak_repeat,
      ...(valve ? { valve_entity: valve } : {}),
      area_name: area.name,
      pause_switch: ids.switch,
    };
    const leakReasons = automationReasons("leak_alert", leakId, leakInput);
    if (installed.automations[leakId]) leakReasons.push(...blueprintReason("leak_alert"), ...switchGone(true));
    const leakNotes = notifyTargets.length === 0 ? [noTargets] : [];
    if (!valve) leakNotes.push("No water valve is set (Parameters, Safety), so nothing is shut off");
    leakNotes.push("Pausing this area's automations silences its leak alert too");
    finish("leak_alert", leakId, leakMissing, leakReasons, leakNotes, () => [
      ...blueprintInput("leak_alert"),
      ...pauseSwitch(),
      automationInput("leak_alert", leakId, leakInput),
    ]);

    // ---- Covers and sun ---------------------------------------------------
    const coversId = automationIdFor("covers_sun", code);
    const covers = inv.cover
      .filter((r) => r.counts)
      .map((r) => r.entityId)
      .sort();
    const coverWindows =
      values.covers_block_if_window_open === true
        ? inv.window
            .filter((r) => r.counts)
            .map((r) => r.entityId)
            .sort()
        : [];
    const outdoor = String(resolveIn(params, [{ level: "house" }], "outdoor_temperature_entity").value ?? "");
    const coversMissing: string[] = [];
    if (covers.length === 0) coversMissing.push("A cover that counts (Capabilities)");
    if (!usable) coversMissing.push("An area code that makes valid entity ids (Settings)");
    else {
      const m = taken(ids.switch, toggle);
      if (m) coversMissing.push(m);
    }
    if (outdoor && !h.entities[outdoor]) coversMissing.push(`The outdoor temperature sensor “${outdoor}” isn't in Home Assistant (Parameters, House)`);
    if ((values.covers_window_start as string) >= (values.covers_window_end as string))
      coversMissing.push("Close from is not before Close until (Parameters, Covers)");
    const coversInput: Record<string, unknown> = {
      cover_entities: covers,
      window_entities: coverWindows,
      ...(outdoor ? { temperature_entity: outdoor } : {}),
      sun_elevation: values.covers_sun_elevation,
      facing_from: values.covers_facing_from,
      facing_to: values.covers_facing_to,
      temperature_above: values.covers_temp_above,
      window_start: withSeconds(values.covers_window_start as string),
      window_end: withSeconds(values.covers_window_end as string),
      open_time: withSeconds(values.covers_open_time as string),
      open_at_sunrise: values.covers_open_at_sunrise,
      sunrise_offset: (values.covers_sunrise_offset as number) * 60,
      pause_switch: ids.switch,
    };
    const coversReasons = automationReasons("covers_sun", coversId, coversInput);
    if (installed.automations[coversId]) coversReasons.push(...blueprintReason("covers_sun"), ...switchGone(true));
    const coversNotes: string[] = [];
    if (!outdoor) coversNotes.push("No outdoor temperature sensor is set (Parameters, House), so the covers close on the sun alone");
    if (values.covers_block_if_window_open === true && inv.window.every((r) => !r.counts))
      coversNotes.push("No window counts here, so nothing stops the covers closing");
    finish("covers_sun", coversId, coversMissing, coversReasons, coversNotes, () => [
      ...blueprintInput("covers_sun"),
      ...pauseSwitch(),
      automationInput("covers_sun", coversId, coversInput),
    ]);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Announce: one script for the whole house, taxis_announce, which speaks a message
// on the speakers of the areas that are occupied, awake and not paused.
// ---------------------------------------------------------------------------

export type AnnounceArea = { occupied: string; paused: string; bed: string[]; speakers: string[] };

export function planAnnounce(
  h: Hierarchy,
  inventory: InventorySettings,
  naming: NamingSettings,
  params: ParameterSettings,
  installed: RecipeInstalled,
  changes: readonly Change[],
): RecipeCell {
  const codes = areaCodes(h, naming);
  const conflicts = areaCodeConflicts(h, naming);
  const exclusions = helperExclusions(h, naming);
  // The house settings: the same for every area.
  const house = (key: "tts_entity" | "announce_volume") => resolveIn(params, [{ level: "house" }], key).value;
  const missing: string[] = [];
  let hasConflictingSpeaker = false;
  const notes: string[] = [];

  // The areas that can be spoken to: counted speakers, and Occupancy (installed or
  // in the list) with the sensor and the switch it makes.
  const areas: AnnounceArea[] = [];
  const noOccupancy: string[] = [];
  for (const area of Object.values(h.areas).sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))) {
    const inv = areaInventory(h, inventory, area.id, exclusions(area.id));
    const speakers = inv.speaker
      .filter((r) => r.counts)
      .map((r) => r.entityId)
      .sort();
    if (speakers.length === 0) continue;
    const conflict = conflicts.get(area.id);
    if (conflict) {
      hasConflictingSpeaker = true;
      if (!missing.includes(conflict)) missing.push(conflict);
      continue;
    }
    const code = codes[area.id].code;
    const ids = runtimeIds(code);
    const occupancyId = automationIdFor("occupancy", code);
    const exists = (id: string, domain: string, platform?: string) => heldBy(h, id, domain, platform).state === "ok" || pendingHelper(changes, id);
    const occupied =
      ENTITY_ID_RE.test(ids.occupied) &&
      Boolean(installed.automations[occupancyId] || pendingAutomation(changes, occupancyId)) &&
      exists(ids.occupied, "binary_sensor", "template") &&
      exists(ids.switch, "input_boolean");
    if (!occupied) {
      noOccupancy.push(area.name);
      continue;
    }
    const beds = areaChoice(inventory, area.id).bedroom
      ? inv.presence
          .filter((r) => r.counts && r.bed)
          .map((r) => r.entityId)
          .sort()
      : [];
    areas.push({ occupied: ids.occupied, paused: ids.switch, bed: beds, speakers });
  }

  // The text-to-speech entity is a house setting.
  const tts = String(house("tts_entity") ?? "");
  if (!tts) missing.push("A text-to-speech entity (Parameters, House)");
  else if (!h.entities[tts]) missing.push(`The text-to-speech entity “${tts}” isn't in Home Assistant (Parameters, House)`);
  if (areas.length === 0) missing.push("A speaker that counts in an area that has Occupancy (Capabilities, Recipes)");
  const held = h.entities[`script.${ANNOUNCE_SCRIPT_ID}`];
  const there = installed.scripts[ANNOUNCE_SCRIPT_ID] ?? null;
  if (held && !there && !pendingScript(changes, ANNOUNCE_SCRIPT_ID))
    missing.push(`script.${ANNOUNCE_SCRIPT_ID} is already used by “${held.name}”, which Taxis didn't make or can't edit`);

  const input: Record<string, unknown> = { areas, tts_entity: tts, default_volume: house("announce_volume") };
  const alias = ANNOUNCE_ALIAS;

  const reasons: string[] = [];
  if (there) {
    if (there.path !== ANNOUNCE_PATH) reasons.push("It isn't made from the Taxis blueprint");
    else {
      const was = Array.isArray(there.input.areas) ? (there.input.areas as Partial<AnnounceArea>[]) : [];
      const key = (a: Partial<AnnounceArea>) => String(a.occupied);
      const nowKeys = areas.map(key);
      const wasKeys = was.map(key);
      const label = (occupied: string) => Object.values(h.areas).find((a) => runtimeIds(codes[a.id].code).occupied === occupied)?.name ?? occupied;
      for (const k of nowKeys) if (!wasKeys.includes(k)) reasons.push(`${label(k)}: not spoken to → spoken to`);
      for (const k of wasKeys) if (!nowKeys.includes(k)) reasons.push(`${label(k)}: spoken to → not spoken to`);
      for (const a of areas) {
        const w = was.find((x) => key(x) === a.occupied);
        if (w && !sameValue(w, a)) reasons.push(`${label(a.occupied)}: speakers or bed sensors changed`);
      }
      for (const k of ["tts_entity", "default_volume"] as const) {
        if (!sameValue(there.input[k] ?? null, input[k] ?? null)) reasons.push(`${INPUT_LABEL[k]}: ${show(there.input[k])} → ${show(input[k])}`);
      }
    }
    if (there.alias !== alias) reasons.push(`Name: ${show(there.alias)} → ${alias}`);
    const bp = blueprintForRecipe("announce");
    const version = installed.blueprints[bp.path] ?? null;
    if (version === null) reasons.push("The blueprint is missing");
    else if (version !== bp.version) reasons.push(`The blueprint is version ${version}, Taxis has ${bp.version}`);
  }

  if (noOccupancy.length > 0)
    notes.push(
      `${noOccupancy.join(", ")} ${noOccupancy.length === 1 ? "has" : "have"} speakers but no Occupancy yet, so ${noOccupancy.length === 1 ? "it is" : "they are"} left out`,
    );
  notes.push("The volume is set before speaking and is not put back");

  const status: RecipeStatus = hasConflictingSpeaker
    ? "missing"
    : pendingScript(changes, ANNOUNCE_SCRIPT_ID)
      ? "in-changes"
      : missing.length > 0
        ? "missing"
        : there
          ? reasons.length === 0
            ? "installed"
            : "out-of-date"
          : "ready";
  const inputs: ChangeInput[] = [];
  if (status === "ready" || status === "out-of-date") {
    const bp = blueprintForRecipe("announce");
    const version = installed.blueprints[bp.path] ?? null;
    if (version !== bp.version && !pendingBlueprint(changes, bp.path, bp.version)) {
      inputs.push({ kind: "blueprint", op: version === null ? "create" : "update", fields: { path: bp.path, version: bp.version } });
    }
    inputs.push({
      kind: "script",
      op: there ? "update" : "create",
      fields: { script_id: ANNOUNCE_SCRIPT_ID, alias, use_blueprint: { path: ANNOUNCE_PATH, input } },
    });
  }
  return {
    areaId: "",
    areaName: "House",
    recipe: "announce",
    status,
    missing: status === "missing" ? missing : [],
    reasons: status === "out-of-date" ? reasons : [],
    notes: status === "missing" ? [] : notes,
    controlledBy: [],
    controls: "lights",
    inputs,
    actionable: inputs.length > 0,
  };
}

// The changes for the chosen cells, in order, each blueprint once.
export function recipeChangeInputs(cells: readonly RecipeCell[]): ChangeInput[] {
  const seen = new Set<string>();
  const out: ChangeInput[] = [];
  for (const cell of cells) {
    for (const input of cell.inputs) {
      // Once per blueprint, and once per helper two areas both ask for (the house switches).
      const key =
        input.kind === "blueprint"
          ? `blueprint:${String(input.fields?.path)}`
          : input.kind === "helper" && input.op === "create"
            ? `helper:${String(input.fields?.entity_id)}`
            : null;
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

// Every thermostat that sits in an area: the ones Area climate controls, and the
// ones to ask what else controls them.
export const areaThermostats = (h: Hierarchy): string[] =>
  Object.values(h.entities)
    .filter((e) => e.domain === "climate" && e.areaId !== null && !e.disabled)
    .map((e) => e.entityId)
    .sort();

// The canonical light group of every area that has one in Home Assistant: the
// lights a recipe controls, and the ones to ask what else controls them.
export function canonicalLightGroups(h: Hierarchy, naming: NamingSettings): string[] {
  const codes = areaCodes(h, naming);
  const suffix = helperSuffixes(naming).lights;
  return Object.values(h.areas)
    .map((a) => canonicalId("light", codes[a.id].code, suffix))
    .filter((id) => h.entities[id]?.platform === "group");
}
