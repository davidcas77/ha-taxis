import type { RecipeKey } from "../../shared/blueprints.ts";
import { HOUSE_AREAS_OCCUPIED_ID, HOUSE_OCCUPIED_ID, HOUSE_PAUSE_ID } from "../../shared/climate.ts";
import { canonicalId, helperExclusions, helperSuffixes } from "../../shared/helpers.ts";
import { planHouseModes, type HouseModeKey } from "../../shared/house-modes.ts";
import { areaInventory, type Capability, type InventorySettings } from "../../shared/inventory.ts";
import { areaCodes, houseGroupId, type NamingSettings } from "../../shared/naming.ts";
import { resolve, resolveIn, type ParameterSettings, type ParamKey } from "../../shared/parameters.ts";
import { runtimeIds } from "../../shared/recipes.ts";
import type { Change, Hierarchy } from "../../shared/types.ts";

export type RecipeAvailability = { capabilities: readonly Capability[]; areaParams: readonly ParamKey[]; houseParams: readonly ParamKey[] };

// These are the sources and parameter scopes used by the planners, not whole
// parameter tabs. Entity selectors stored only at House are kept in houseParams.
export const RECIPE_AVAILABILITY: Record<RecipeKey, RecipeAvailability> = {
  occupancy: {
    capabilities: ["motion", "presence", "tv"],
    areaParams: ["hold_timeout", "extended_after", "extended_hold", "sleep_hold", "humidity_hold_rate"],
    houseParams: [],
  },
  motion_lights: {
    capabilities: ["lights", "presence", "illuminance"],
    areaParams: [
      "entry_lights",
      "ambient_lights",
      "night_lights",
      "away_mode_entity",
      "sleep_mode_entity",
      "guest_mode_entity",
      "guest_pause_lighting",
      "lux_threshold",
      "night_start",
      "night_end",
      "day_brightness",
      "day_kelvin",
      "night_brightness",
      "night_kelvin",
      "transition",
      "dim_before_off",
      "dim_level",
      "extended_after",
      "override_duration",
    ],
    houseParams: [],
  },
  media_off: { capabilities: ["speaker", "tv"], areaParams: ["media_off_after", "tv_off_after", "guest_mode_entity", "guest_pause_media"], houseParams: [] },
  area_climate: {
    capabilities: ["thermostat", "window", "door", "temperature", "presence"],
    areaParams: [
      "away_mode_entity",
      "sleep_mode_entity",
      "guest_mode_entity",
      "comfort_temp",
      "eco_temp",
      "night_temp",
      "sleep_temp",
      "away_temp",
      "cool_comfort_temp",
      "cool_eco_temp",
      "cool_night_temp",
      "cool_away_temp",
      "frost_temp",
      "min_temp",
      "max_temp",
      "window_delay",
      "restore_delay",
      "eco_after_clear",
      "comfort_needs_occupancy",
      "season",
      "auto_hvac_on",
      "doors_open_count",
      "comfort_periods",
      "night_start",
      "night_end",
      "preset_comfort",
      "preset_eco",
      "preset_away",
      "preset_sleep",
    ],
    houseParams: [],
  },
  bathroom_fan: {
    capabilities: ["humidity", "fan"],
    areaParams: [
      "fan_rate_on",
      "fan_delta_on",
      "fan_abs_on",
      "fan_delta_off",
      "fan_flat_minutes",
      "fan_max_minutes",
      "fan_reference",
      "fan_suppress_in_sleep",
      "sleep_mode_entity",
    ],
    houseParams: [],
  },
  exterior_lights: {
    capabilities: ["lights", "motion", "presence"],
    areaParams: ["exterior_sunset_offset", "exterior_clock", "override_duration"],
    houseParams: [],
  },
  left_open: { capabilities: ["door", "window"], areaParams: ["door_open_after", "window_open_after", "left_open_repeat"], houseParams: ["notify_targets"] },
  appliance_done: {
    capabilities: ["power"],
    areaParams: ["appliance_run_watts", "appliance_run_minutes", "appliance_idle_watts", "appliance_idle_minutes"],
    houseParams: ["notify_targets"],
  },
  leak_alert: { capabilities: ["leak"], areaParams: ["leak_repeat"], houseParams: ["notify_targets", "leak_valve_entity"] },
  covers_sun: {
    capabilities: ["cover", "window"],
    areaParams: [
      "covers_sun_elevation",
      "covers_facing_from",
      "covers_facing_to",
      "covers_temp_above",
      "covers_window_start",
      "covers_window_end",
      "covers_open_time",
      "covers_open_at_sunrise",
      "covers_sunrise_offset",
      "covers_block_if_window_open",
    ],
    houseParams: ["outdoor_temperature_entity"],
  },
  announce: { capabilities: ["speaker", "presence"], areaParams: [], houseParams: ["tts_entity", "announce_volume"] },
  goodbye: { capabilities: ["lights", "speaker", "tv"], areaParams: [], houseParams: ["away_mode_entity"] },
  house_presence: { capabilities: [], areaParams: [], houseParams: ["away_mode_entity", "guest_mode_entity", "everyone_left_minutes", "away_ends_on_return"] },
  battery_low: { capabilities: [], areaParams: [], houseParams: ["battery_threshold", "battery_report_time", "notify_targets"] },
  unavailable_watch: {
    capabilities: ["motion", "presence", "door", "window", "temperature", "humidity", "illuminance", "thermostat", "leak", "power"],
    areaParams: [],
    houseParams: ["unavailable_watch_minutes", "notify_targets"],
  },
};

export type HelperAvailabilitySpec = {
  id: string;
  name: string;
  role: string;
  domain: string;
  platform?: string;
  type: "group" | "managed";
  optional?: boolean;
  provider?: string;
};
export type RecipeHelperContext = {
  recipe: RecipeKey;
  h: Hierarchy;
  areaId?: string | null;
  inventory: InventorySettings;
  naming: NamingSettings;
  parameters: ParameterSettings;
  changes: readonly Change[];
};

export function recipeHelperSpecs({ recipe, h, areaId, inventory, naming, parameters, changes }: RecipeHelperContext): HelperAvailabilitySpec[] {
  const out: HelperAvailabilitySpec[] = [];
  const add = (
    id: string,
    name: string,
    role: string,
    domain: string,
    platform: string | undefined,
    type: "group" | "managed",
    optional = false,
    provider?: string,
  ) =>
    out.push({ id, name, role, domain, ...(platform ? { platform } : {}), type, ...(optional ? { optional: true } : {}), ...(provider ? { provider } : {}) });
  const mode = (key: HouseModeKey, optional: boolean) => {
    const row = planHouseModes(h, parameters, inventory, changes, areaId ?? null).find((item) => item.key === key)!;
    const param = key === "away" ? "away_mode_entity" : key === "sleep" ? "sleep_mode_entity" : "guest_mode_entity";
    const selected = areaId ? resolve(parameters, h, inventory, areaId, param).value : resolveIn(parameters, [{ level: "house" }], param).value;
    const provider = selected ? "External selection" : "Taxis";
    add(
      row.id,
      selected ? row.id : `Taxis ${key} mode`,
      `${row.label} mode${optional ? " (optional)" : ""}`,
      "input_boolean",
      undefined,
      "managed",
      optional,
      provider,
    );
  };
  if (recipe === "goodbye") {
    add(houseGroupId(naming), "All lights", "House light group (Helpers prerequisite)", "light", "group", "group", false, "Helpers");
    mode("away", false);
    return out;
  }
  if (recipe === "house_presence") {
    add(HOUSE_AREAS_OCCUPIED_ID, "Taxis areas occupied", "Areas occupied group", "binary_sensor", "group", "managed", false, "House presence");
    add(HOUSE_OCCUPIED_ID, "Taxis occupied", "House occupancy virtual sensor", "binary_sensor", "template", "managed", false, "House presence");
    add(HOUSE_PAUSE_ID, "Taxis house automations paused", "House pause switch", "input_boolean", undefined, "managed");
    mode("away", false);
    mode("guest", true);
    return out;
  }
  if (recipe === "battery_low" || recipe === "unavailable_watch") {
    add(HOUSE_PAUSE_ID, "Taxis house automations paused", "House pause switch", "input_boolean", undefined, "managed");
    return out;
  }
  if (recipe === "announce") {
    const codes = areaCodes(h, naming);
    const exclusions = helperExclusions(h, naming);
    for (const area of Object.values(h.areas).sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))) {
      const inv = areaInventory(h, inventory, area.id, exclusions(area.id));
      if (!inv.speaker.some((row) => row.counts)) continue;
      const ids = runtimeIds(codes[area.id].code);
      add(
        ids.occupied,
        `${area.name} occupied`,
        `Area occupancy virtual sensor (Occupancy prerequisite for ${area.name})`,
        "binary_sensor",
        "template",
        "managed",
        false,
        "Occupancy",
      );
      add(
        ids.switch,
        `${area.name} automations paused`,
        `Pause switch (Occupancy prerequisite for ${area.name})`,
        "input_boolean",
        undefined,
        "managed",
        false,
        "Occupancy",
      );
    }
    return out;
  }
  if (!areaId || !h.areas[areaId]) return out;
  const area = h.areas[areaId];
  const code = areaCodes(h, naming)[areaId]?.code;
  if (!code) return out;
  const ids = runtimeIds(code, h, areaId, changes);
  const suffix = helperSuffixes(naming);
  const managed = (id: string, word: string, role: string, domain: string, platform?: string, optional = false, provider?: string) =>
    add(id, `${area.name} ${word}`, role, domain, platform, "managed", optional, provider);
  const group = (id: string, word: string, role: string, domain: string, platform: string, optional = false) =>
    add(id, `${area.name} ${word}`, role, domain, platform, "group", optional, "Helpers");
  const pause = (provider?: string) =>
    managed(ids.switch, "automations paused", provider ? "Pause switch (Occupancy prerequisite)" : "Pause switch", "input_boolean", undefined, false, provider);
  const occupied = (optional = false) =>
    managed(
      ids.occupied,
      "occupied",
      optional ? "Area occupancy virtual sensor (optional; Occupancy)" : "Area occupancy virtual sensor (Occupancy prerequisite)",
      "binary_sensor",
      "template",
      optional,
      "Occupancy",
    );
  const lights = () => group(canonicalId("light", code, suffix.lights), "lights", "Light group (Helpers prerequisite)", "light", "group");
  const override = () => managed(ids.override, "override", "Override timer", "timer");
  switch (recipe) {
    case "occupancy":
      managed(ids.timer, "hold", "Hold timer", "timer");
      managed(ids.occupied, "occupied", "Area occupancy virtual sensor", "binary_sensor", "template");
      pause();
      managed(ids.rate, "humidity rate", "Humidity rate (optional; Bathroom fan)", "sensor", "derivative", true, "Bathroom fan");
      break;
    case "motion_lights":
      lights();
      occupied();
      pause("Occupancy");
      override();
      group(canonicalId("sensor", code, suffix.illuminance), "illuminance", "Light level (optional)", "sensor", "min_max", true);
      mode("away", true);
      mode("sleep", true);
      mode("guest", true);
      break;
    case "media_off":
      occupied();
      pause("Occupancy");
      group(canonicalId("media_player", code, suffix.media), "media", "Media group (optional)", "media_player", "group", true);
      mode("guest", true);
      break;
    case "area_climate":
      pause();
      managed(ids.schedule, "climate", "Comfort schedule", "schedule");
      occupied(true);
      group(canonicalId("binary_sensor", code, suffix.window), "windows", "Window group (optional)", "binary_sensor", "group", true);
      group(canonicalId("binary_sensor", code, suffix.door), "doors", "Door group (optional)", "binary_sensor", "group", true);
      group(canonicalId("sensor", code, suffix.temperature), "temperature", "Temperature helper (optional)", "sensor", "min_max", true);
      mode("away", false);
      mode("sleep", false);
      mode("guest", true);
      break;
    case "bathroom_fan":
      group(canonicalId("sensor", code, suffix.humidity), "humidity", "Humidity helper (Helpers prerequisite)", "sensor", "min_max");
      managed(ids.rate, "humidity rate", "Humidity rate", "sensor", "derivative");
      pause();
      if (resolve(parameters, h, inventory, areaId, "fan_suppress_in_sleep").value === true) mode("sleep", false);
      break;
    case "exterior_lights":
      lights();
      override();
      pause();
      break;
    case "left_open":
    case "appliance_done":
    case "leak_alert":
    case "covers_sun":
      pause();
      break;
  }
  return out;
}

// The unavailable-watch planner takes counted supported inputs, appliance power
// only, sorted and capped at 500. Battery reports inspect HA state at run time;
// the hierarchy is only the current snapshot, including entities outside areas.
export function recipeHouseEntities(recipe: "battery_low" | "unavailable_watch", h: Hierarchy, inventory: InventorySettings, naming: NamingSettings): string[] {
  if (recipe === "battery_low")
    return Object.values(h.entities)
      .filter((e) => (e.domain === "sensor" || e.domain === "binary_sensor") && e.deviceClass === "battery")
      .map((e) => e.entityId)
      .sort();
  const exclusions = helperExclusions(h, naming);
  const ids = new Set<string>();
  for (const area of Object.values(h.areas)) {
    const inv = areaInventory(h, inventory, area.id, exclusions(area.id));
    for (const cap of RECIPE_AVAILABILITY.unavailable_watch.capabilities)
      for (const row of inv[cap]) if (row.counts && (cap !== "power" || row.appliance)) ids.add(row.entityId);
  }
  return [...ids].sort().slice(0, 500);
}
