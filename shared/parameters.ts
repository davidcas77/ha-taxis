import { areaChoice, AREA_TYPES, INVENTORY_AREA_ID, INVENTORY_ENTITY_ID, type AreaType, type InventoryRow, type InventorySettings } from "./inventory.ts";
import { checkPeriods, DEFAULT_COMFORT_PERIODS } from "./periods.ts";
import type { Hierarchy } from "./types.ts";

// Parameters: the numbers and times recipes are filled in with. Each has a
// built-in default and can be set for the whole house, for interior or exterior
// areas, for a floor and for one area. The most specific value wins, and a value
// that isn't set is inherited from the next level up. Choices live in Taxis
// only; nothing is written to Home Assistant until a recipe is installed. Pure
// functions, no side effects.

export const PARAM_TABS = ["house", "occupancy", "lighting", "media", "climate", "fan", "exterior", "covers", "safety"] as const;
export type ParamTab = (typeof PARAM_TABS)[number];

export const PARAM_TAB_LABEL: Record<ParamTab, string> = {
  house: "House",
  occupancy: "Occupancy",
  lighting: "Lighting",
  media: "Media",
  climate: "Climate",
  fan: "Bathroom fan",
  exterior: "Exterior",
  covers: "Covers",
  safety: "Safety",
};

// number: a number in a range. time: HH:MM. enum: one of a few words. bool: yes or
// no. text: a short name (a thermostat preset); empty means not set. entity: the
// id of an entity of one domain; empty means not set. entities: a list of entity
// ids of one domain (at least one; clear it to not set it). services: a list of
// notify services such as notify.mobile_app_phone (they are service names, not
// entities). periods: comfort periods (shared/periods.ts).
export type ParamKind = "number" | "time" | "enum" | "bool" | "text" | "entity" | "entities" | "services" | "periods";
export type ParamValue = number | string | boolean | string[];

export type ParamDef = {
  key: ParamKey;
  tab: ParamTab;
  label: string;
  unit: string | null;
  kind: ParamKind;
  // number: the range, and the steps inside it (counted from min).
  min?: number;
  max?: number;
  step?: number;
  // enum: the values it can take.
  options?: readonly string[];
  // entity and entities: the domain its entity ids have to be in.
  domain?: string;
  // entity: more than one domain is accepted (domain is the first of them).
  domains?: readonly string[];
  // Set for one area only: it is not inherited from a floor, the interior or
  // exterior areas or the house, and the other levels can't set it.
  areaOnly?: boolean;
  // Set for the house only: the recipes that read it are not per area (the
  // notification targets, the announce script), so it has one value everywhere.
  houseOnly?: boolean;
  default: ParamValue;
};

export const PARAM_KEYS = [
  "night_start",
  "night_end",
  "away_mode_entity",
  "sleep_mode_entity",
  "guest_mode_entity",
  "guest_pause_lighting",
  "guest_pause_media",
  "notify_targets",
  "tts_entity",
  "outdoor_temperature_entity",
  "everyone_left_minutes",
  "away_ends_on_return",
  "hold_timeout",
  "extended_after",
  "extended_hold",
  "sleep_hold",
  "humidity_hold_rate",
  "lux_threshold",
  "day_brightness",
  "day_kelvin",
  "night_brightness",
  "night_kelvin",
  "transition",
  "dim_before_off",
  "dim_level",
  "override_duration",
  "entry_lights",
  "media_off_after",
  "tv_off_after",
  "announce_volume",
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
  "preset_comfort",
  "preset_eco",
  "preset_away",
  "preset_sleep",
  "fan_rate_on",
  "fan_delta_on",
  "fan_abs_on",
  "fan_delta_off",
  "fan_flat_minutes",
  "fan_max_minutes",
  "fan_reference",
  "fan_suppress_in_sleep",
  "exterior_sunset_offset",
  "exterior_clock",
  "door_open_after",
  "window_open_after",
  "left_open_repeat",
  "appliance_run_watts",
  "appliance_run_minutes",
  "appliance_idle_watts",
  "appliance_idle_minutes",
  "leak_repeat",
  "leak_valve_entity",
  "battery_threshold",
  "battery_report_time",
  "unavailable_watch_minutes",
  "covers_sun_elevation",
  "covers_temp_above",
  "covers_window_start",
  "covers_window_end",
  "covers_open_time",
  "covers_open_at_sunrise",
  "covers_sunrise_offset",
  "covers_block_if_window_open",
] as const;
export type ParamKey = (typeof PARAM_KEYS)[number];

export const PARAMS: readonly ParamDef[] = [
  { key: "night_start", tab: "house", label: "Night starts", unit: null, kind: "time", default: "23:00" },
  { key: "night_end", tab: "house", label: "Night ends", unit: null, kind: "time", default: "07:00" },
  // "": Taxis makes input_boolean.taxis_away / taxis_sleep when Area climate is installed.
  { key: "away_mode_entity", tab: "house", label: "Away mode switch", unit: null, kind: "entity", domain: "input_boolean", default: "" },
  { key: "sleep_mode_entity", tab: "house", label: "Sleep mode switch", unit: null, kind: "entity", domain: "input_boolean", default: "" },
  { key: "guest_mode_entity", tab: "house", label: "Guest mode switch", unit: null, kind: "entity", domain: "input_boolean", default: "" },
  { key: "guest_pause_lighting", tab: "lighting", label: "Guest mode pauses automatic lighting", unit: null, kind: "bool", default: true },
  { key: "guest_pause_media", tab: "media", label: "Guest mode keeps media on", unit: null, kind: "bool", default: true },
  // Where the notifications of Left open and Appliance done go: notify services, one
  // value for the house. Empty: Home Assistant's own notifications.
  { key: "notify_targets", tab: "house", label: "Notify services", unit: null, kind: "services", domain: "notify", houseOnly: true, default: [] },
  // The text-to-speech entity the announce script speaks with.
  { key: "tts_entity", tab: "house", label: "Text-to-speech", unit: null, kind: "entity", domain: "tts", houseOnly: true, default: "" },
  // The outdoor temperature sensor Covers and sun reads. Empty: covers close on the sun alone.
  {
    key: "outdoor_temperature_entity",
    tab: "house",
    label: "Outdoor temperature sensor",
    unit: null,
    kind: "entity",
    domain: "sensor",
    houseOnly: true,
    default: "",
  },
  // House presence: how long nobody is home or in any area before away mode is switched on.
  {
    key: "everyone_left_minutes",
    tab: "house",
    label: "Away after everyone left for",
    unit: "min",
    kind: "number",
    min: 1,
    max: 1440,
    step: 1,
    houseOnly: true,
    default: 30,
  },
  // Whether away mode is switched off again when somebody comes back.
  { key: "away_ends_on_return", tab: "house", label: "Away ends when someone returns", unit: null, kind: "bool", houseOnly: true, default: false },
  { key: "hold_timeout", tab: "occupancy", label: "Hold timeout", unit: "min", kind: "number", min: 1, max: 240, step: 1, default: 5 },
  { key: "extended_after", tab: "occupancy", label: "Extended after", unit: "min", kind: "number", min: 1, max: 720, step: 1, default: 30 },
  { key: "extended_hold", tab: "occupancy", label: "Extended hold timeout", unit: "min", kind: "number", min: 1, max: 240, step: 1, default: 15 },
  { key: "sleep_hold", tab: "occupancy", label: "Sleep hold timeout", unit: "min", kind: "number", min: 1, max: 480, step: 1, default: 60 },
  // A humidity rate (in % per second) at or above this holds the area occupied, as a
  // shower does. 0: off. It needs the area's humidity rate sensor (the Bathroom fan recipe makes it).
  { key: "humidity_hold_rate", tab: "occupancy", label: "Shower holds occupied at", unit: "%/s", kind: "number", min: 0, max: 1, step: 0.001, default: 0 },
  { key: "lux_threshold", tab: "lighting", label: "Dark below", unit: "lx", kind: "number", min: 0, max: 5000, step: 1, default: 50 },
  { key: "day_brightness", tab: "lighting", label: "Day brightness", unit: "%", kind: "number", min: 1, max: 100, step: 1, default: 100 },
  { key: "day_kelvin", tab: "lighting", label: "Day colour", unit: "K", kind: "number", min: 1500, max: 6500, step: 50, default: 3000 },
  { key: "night_brightness", tab: "lighting", label: "Night brightness", unit: "%", kind: "number", min: 1, max: 100, step: 1, default: 10 },
  { key: "night_kelvin", tab: "lighting", label: "Night colour", unit: "K", kind: "number", min: 1500, max: 6500, step: 50, default: 2200 },
  { key: "transition", tab: "lighting", label: "Transition", unit: "s", kind: "number", min: 0, max: 60, step: 1, default: 1 },
  { key: "dim_before_off", tab: "lighting", label: "Dim before off", unit: "s", kind: "number", min: 0, max: 300, step: 1, default: 15 },
  { key: "dim_level", tab: "lighting", label: "Dim level", unit: "%", kind: "number", min: 1, max: 100, step: 1, default: 30 },
  // 0: until the area next clears (or, for a change made while it is clear, is occupied again).
  { key: "override_duration", tab: "lighting", label: "Manual override lasts", unit: "min", kind: "number", min: 0, max: 240, step: 1, default: 0 },
  // The lights that come on by day when the area becomes occupied. Unset: the only
  // light of the area, else its main lights (entryLights below). Area level only.
  { key: "entry_lights", tab: "lighting", label: "Entry lights", unit: null, kind: "entities", domain: "light", areaOnly: true, default: [] },
  { key: "media_off_after", tab: "media", label: "Speakers off when clear for", unit: "min", kind: "number", min: 1, max: 720, step: 1, default: 15 },
  { key: "tv_off_after", tab: "media", label: "TVs off when clear for", unit: "min", kind: "number", min: 1, max: 720, step: 1, default: 30 },
  // The volume the announce script speaks at when it is not given one. 0: leave it.
  { key: "announce_volume", tab: "media", label: "Announcement volume", unit: "%", kind: "number", min: 0, max: 100, step: 1, houseOnly: true, default: 40 },
  // Climate. Temperatures are in the unit Home Assistant is set to; the defaults are °C.
  { key: "comfort_temp", tab: "climate", label: "Comfort", unit: "°", kind: "number", min: 5, max: 35, step: 0.5, default: 21 },
  { key: "eco_temp", tab: "climate", label: "Eco", unit: "°", kind: "number", min: 5, max: 35, step: 0.5, default: 19 },
  { key: "night_temp", tab: "climate", label: "Night", unit: "°", kind: "number", min: 5, max: 35, step: 0.5, default: 18 },
  { key: "sleep_temp", tab: "climate", label: "Sleep", unit: "°", kind: "number", min: 5, max: 35, step: 0.5, default: 17.5 },
  { key: "away_temp", tab: "climate", label: "Away", unit: "°", kind: "number", min: 5, max: 35, step: 0.5, default: 16 },
  // The cooling season's temperatures. Sleep uses the night one; the lowest and highest don't limit them.
  { key: "cool_comfort_temp", tab: "climate", label: "Cool: comfort", unit: "°", kind: "number", min: 5, max: 35, step: 0.5, default: 24 },
  { key: "cool_eco_temp", tab: "climate", label: "Cool: eco", unit: "°", kind: "number", min: 5, max: 35, step: 0.5, default: 27 },
  { key: "cool_night_temp", tab: "climate", label: "Cool: night and sleep", unit: "°", kind: "number", min: 5, max: 35, step: 0.5, default: 25 },
  { key: "cool_away_temp", tab: "climate", label: "Cool: away", unit: "°", kind: "number", min: 5, max: 35, step: 0.5, default: 29 },
  { key: "frost_temp", tab: "climate", label: "Frost protection", unit: "°", kind: "number", min: 0, max: 15, step: 0.5, default: 7 },
  { key: "min_temp", tab: "climate", label: "Lowest", unit: "°", kind: "number", min: 5, max: 35, step: 0.5, default: 16 },
  { key: "max_temp", tab: "climate", label: "Highest", unit: "°", kind: "number", min: 5, max: 35, step: 0.5, default: 24 },
  { key: "window_delay", tab: "climate", label: "Window open for", unit: "min", kind: "number", min: 0, max: 60, step: 1, default: 2 },
  { key: "restore_delay", tab: "climate", label: "Restore after close", unit: "min", kind: "number", min: 0, max: 60, step: 1, default: 1 },
  { key: "eco_after_clear", tab: "climate", label: "Eco when clear for", unit: "min", kind: "number", min: 1, max: 720, step: 1, default: 30 },
  // Bedrooms that haven't been given a choice don't need anyone in them (shared/recipes.ts).
  { key: "comfort_needs_occupancy", tab: "climate", label: "Comfort needs occupancy", unit: null, kind: "bool", default: true },
  { key: "season", tab: "climate", label: "Season", unit: null, kind: "enum", options: ["heating", "cooling", "off"], default: "heating" },
  { key: "auto_hvac_on", tab: "climate", label: "Switch on and off itself", unit: null, kind: "bool", default: false },
  { key: "doors_open_count", tab: "climate", label: "Open doors count", unit: null, kind: "bool", default: false },
  { key: "comfort_periods", tab: "climate", label: "Comfort periods", unit: null, kind: "periods", default: DEFAULT_COMFORT_PERIODS },
  { key: "preset_comfort", tab: "climate", label: "Preset: comfort", unit: null, kind: "text", default: "" },
  { key: "preset_eco", tab: "climate", label: "Preset: eco", unit: null, kind: "text", default: "" },
  { key: "preset_away", tab: "climate", label: "Preset: away", unit: null, kind: "text", default: "" },
  { key: "preset_sleep", tab: "climate", label: "Preset: sleep and night", unit: null, kind: "text", default: "" },
  // Bathroom fan. Rates are in % of humidity per second.
  { key: "fan_rate_on", tab: "fan", label: "On: rise rate", unit: "%/s", kind: "number", min: 0.001, max: 1, step: 0.001, default: 0.03 },
  { key: "fan_delta_on", tab: "fan", label: "On: above the reference", unit: "%", kind: "number", min: 1, max: 50, step: 1, default: 10 },
  { key: "fan_abs_on", tab: "fan", label: "On: humidity", unit: "%", kind: "number", min: 30, max: 100, step: 1, default: 80 },
  { key: "fan_delta_off", tab: "fan", label: "Off: within the reference", unit: "%", kind: "number", min: 0, max: 30, step: 1, default: 3 },
  { key: "fan_flat_minutes", tab: "fan", label: "Off: flat for", unit: "min", kind: "number", min: 1, max: 240, step: 1, default: 20 },
  { key: "fan_max_minutes", tab: "fan", label: "Off: after at most", unit: "min", kind: "number", min: 1, max: 480, step: 1, default: 60 },
  // Another area's humidity sensor, or the house average. Empty: the fan starts on the rise rate and the humidity level only.
  { key: "fan_reference", tab: "fan", label: "Reference humidity sensor", unit: null, kind: "entity", domain: "sensor", default: "" },
  { key: "fan_suppress_in_sleep", tab: "fan", label: "Not while the house sleeps", unit: null, kind: "bool", default: false },
  // Exterior lights.
  { key: "exterior_sunset_offset", tab: "exterior", label: "Lights on from sunset", unit: "min", kind: "number", min: -120, max: 120, step: 5, default: 0 },
  { key: "exterior_clock", tab: "exterior", label: "Stay on for", unit: "min", kind: "number", min: 1, max: 720, step: 1, default: 120 },
  // Left open, and Appliance done.
  { key: "door_open_after", tab: "safety", label: "Door open for", unit: "min", kind: "number", min: 1, max: 1440, step: 1, default: 10 },
  { key: "window_open_after", tab: "safety", label: "Window open for", unit: "min", kind: "number", min: 1, max: 1440, step: 1, default: 30 },
  // 0: the message is sent once.
  { key: "left_open_repeat", tab: "safety", label: "Repeat every", unit: "min", kind: "number", min: 0, max: 1440, step: 1, default: 0 },
  { key: "appliance_run_watts", tab: "safety", label: "Running above", unit: "W", kind: "number", min: 1, max: 10000, step: 1, default: 10 },
  { key: "appliance_run_minutes", tab: "safety", label: "Running for", unit: "min", kind: "number", min: 1, max: 120, step: 1, default: 2 },
  { key: "appliance_idle_watts", tab: "safety", label: "Done below", unit: "W", kind: "number", min: 0, max: 10000, step: 1, default: 5 },
  { key: "appliance_idle_minutes", tab: "safety", label: "Done for", unit: "min", kind: "number", min: 1, max: 120, step: 1, default: 3 },
  // Leak alert. 0: the message is sent once.
  { key: "leak_repeat", tab: "safety", label: "Leak: repeat every", unit: "min", kind: "number", min: 0, max: 1440, step: 1, default: 10 },
  // A water valve (or a switch that shuts the water) closed when a leak is found. Empty: nothing is closed.
  {
    key: "leak_valve_entity",
    tab: "safety",
    label: "Leak: water valve",
    unit: null,
    kind: "entity",
    domain: "valve",
    domains: ["valve", "switch"],
    houseOnly: true,
    default: "",
  },
  // Low batteries: one summary a day.
  { key: "battery_threshold", tab: "safety", label: "Battery low below", unit: "%", kind: "number", min: 1, max: 99, step: 1, houseOnly: true, default: 15 },
  { key: "battery_report_time", tab: "safety", label: "Battery report at", unit: null, kind: "time", houseOnly: true, default: "09:00" },
  // Entities Taxis relies on that stayed unavailable or unknown this long are reported.
  {
    key: "unavailable_watch_minutes",
    tab: "safety",
    label: "Not reporting for",
    unit: "min",
    kind: "number",
    min: 1,
    max: 1440,
    step: 1,
    houseOnly: true,
    default: 60,
  },
  // Covers and sun.
  { key: "covers_sun_elevation", tab: "covers", label: "Close when the sun is above", unit: "°", kind: "number", min: 0, max: 90, step: 1, default: 25 },
  { key: "covers_temp_above", tab: "covers", label: "and it is warmer outside than", unit: "°", kind: "number", min: -20, max: 60, step: 0.5, default: 24 },
  { key: "covers_window_start", tab: "covers", label: "Close from", unit: null, kind: "time", default: "10:00" },
  { key: "covers_window_end", tab: "covers", label: "Close until", unit: null, kind: "time", default: "20:00" },
  { key: "covers_open_time", tab: "covers", label: "Open at", unit: null, kind: "time", default: "08:00" },
  { key: "covers_open_at_sunrise", tab: "covers", label: "Open at sunrise instead", unit: null, kind: "bool", default: false },
  { key: "covers_sunrise_offset", tab: "covers", label: "Sunrise offset", unit: "min", kind: "number", min: -120, max: 120, step: 5, default: 30 },
  { key: "covers_block_if_window_open", tab: "covers", label: "Not while a window is open", unit: null, kind: "bool", default: true },
];

export const PARAM_DEF = Object.fromEntries(PARAMS.map((p) => [p.key, p])) as Record<ParamKey, ParamDef>;

export const isParamKey = (k: string): k is ParamKey => Object.hasOwn(PARAM_DEF, k);

export const paramsOf = (tab: ParamTab): ParamDef[] => PARAMS.filter((p) => p.tab === tab);

export const MAX_ENTITY_LIST = 20;

// A notify service: notify.mobile_app_phone.
export const NOTIFY_SERVICE_RE = /^notify\.[a-z0-9_]{1,100}$/;

export const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

// A thermostat's preset name: letters, digits and a few marks, up to 40. No dot: a lower-case word.word would read as an entity id.
export const PRESET_NAME_RE = /^[\p{L}\p{N} _+/-]{1,40}$/u;

// Null when `value` is allowed for `def`; otherwise what's wrong, in words.
export function checkValue(def: ParamDef, value: unknown): string | null {
  switch (def.kind) {
    case "bool":
      return typeof value === "boolean" ? null : `${def.label} must be yes or no.`;
    case "text":
      return typeof value === "string" && (value === "" || PRESET_NAME_RE.test(value))
        ? null
        : `${def.label} must be a name of up to 40 letters, digits and spaces.`;
    case "entity": {
      const domains = def.domains ?? [def.domain];
      return typeof value === "string" &&
        (value === "" || (value.length <= 255 && INVENTORY_ENTITY_ID.test(value) && domains.some((d) => value.startsWith(`${d}.`))))
        ? null
        : `${def.label} must be ${domains.length > 1 ? `a ${domains.slice(0, -1).join(", ")} or ${domains[domains.length - 1]}` : `an ${domains[0]}`} entity id.`;
    }
    case "entities":
      return Array.isArray(value) &&
        value.length >= 1 &&
        value.length <= MAX_ENTITY_LIST &&
        new Set(value).size === value.length &&
        value.every((v) => typeof v === "string" && v.length <= 255 && INVENTORY_ENTITY_ID.test(v) && v.startsWith(`${def.domain}.`))
        ? null
        : `${def.label} must be a list of 1 to ${MAX_ENTITY_LIST} ${def.domain} entity ids.`;
    case "services":
      return Array.isArray(value) &&
        value.length >= 1 &&
        value.length <= MAX_ENTITY_LIST &&
        new Set(value).size === value.length &&
        value.every((v) => typeof v === "string" && NOTIFY_SERVICE_RE.test(v))
        ? null
        : `${def.label} must be a list of 1 to ${MAX_ENTITY_LIST} notify services, like notify.mobile_app_phone.`;
    case "periods": {
      const problem = checkPeriods(value);
      return problem ? `${def.label}: ${problem}` : null;
    }
    case "time":
      return typeof value === "string" && TIME_RE.test(value) ? null : `${def.label} must be a time like 23:00.`;
    case "enum":
      return typeof value === "string" && (def.options ?? []).includes(value) ? null : `${def.label} must be one of ${(def.options ?? []).join(", ")}.`;
    case "number": {
      const { min = -Infinity, max = Infinity, step } = def;
      const range = `${def.label} must be between ${min} and ${max}${def.unit ? ` ${def.unit}` : ""}.`;
      if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) return range;
      if (step) {
        const n = (value - (Number.isFinite(min) ? min : 0)) / step;
        if (Math.abs(n - Math.round(n)) > 1e-9) return `${def.label} goes in steps of ${step}.`;
      }
      return null;
    }
  }
}

// ---------------------------------------------------------------------------
// The settings: only the values that were set.
// ---------------------------------------------------------------------------

export type ParamValues = Partial<Record<ParamKey, ParamValue>>;

export type ParameterSettings = {
  house: ParamValues;
  types: Partial<Record<AreaType, ParamValues>>;
  areas: Record<string, ParamValues>;
};

export const EMPTY_PARAMETERS: ParameterSettings = { house: {}, types: {}, areas: {} };

export const MAX_PARAMETER_AREAS = 500;
export const PARAMETER_AREA_ID = INVENTORY_AREA_ID;

// A floor has no values of its own: an area inherits from its type, then the house.
// Settings saved by an older version may hold some for floors; they are ignored on
// the way in and gone with the next save (server/settings.ts).
export type ParamScope = { level: "house" } | { level: "type"; id: AreaType } | { level: "area"; id: string };

// Own keys only: an area called "constructor" mustn't find Object's.
function valuesOf(p: ParameterSettings, scope: ParamScope): ParamValues | undefined {
  switch (scope.level) {
    case "house":
      return p.house;
    case "type":
      return Object.hasOwn(p.types, scope.id) ? p.types[scope.id] : undefined;
    case "area":
      return Object.hasOwn(p.areas, scope.id) ? p.areas[scope.id] : undefined;
  }
}

// The value set at exactly this level, if any.
export const ownValue = (p: ParameterSettings, scope: ParamScope, key: ParamKey): ParamValue | undefined => valuesOf(p, scope)?.[key];

// ---------------------------------------------------------------------------
// Inheritance: house default → interior / exterior → area.
// ---------------------------------------------------------------------------

export type ParamSource = { level: "area" | "type" | "house"; id: string | null } | { level: "default"; id: null };

export type Resolved = { value: ParamValue; source: ParamSource };

const sourceOf = (s: ParamScope): ParamSource => ({ level: s.level, id: s.level === "house" ? null : s.id }) as ParamSource;

// The first scope that sets `key`, else the built-in default.
export function resolveIn(p: ParameterSettings, scopes: readonly ParamScope[], key: ParamKey): Resolved {
  const areaOnly = PARAM_DEF[key].areaOnly === true;
  const houseOnly = PARAM_DEF[key].houseOnly === true;
  for (const s of scopes) {
    // A parameter of one area is not inherited.
    if (areaOnly && s.level !== "area") continue;
    // A parameter of the house is read from the house, wherever it is asked.
    if (houseOnly && s.level !== "house") continue;
    const v = valuesOf(p, s)?.[key];
    if (v !== undefined) return { value: v, source: sourceOf(s) };
  }
  return { value: PARAM_DEF[key].default, source: { level: "default", id: null } };
}

// Most specific first: the area, its type, the house.
export function scopesForArea(_h: Hierarchy, inventory: InventorySettings, areaId: string): ParamScope[] {
  return [{ level: "area", id: areaId }, { level: "type", id: areaChoice(inventory, areaId).type }, { level: "house" }];
}

export const resolve = (p: ParameterSettings, h: Hierarchy, inventory: InventorySettings, areaId: string, key: ParamKey): Resolved =>
  resolveIn(p, scopesForArea(h, inventory, areaId), key);

export function resolveAll(p: ParameterSettings, h: Hierarchy, inventory: InventorySettings, areaId: string): Record<ParamKey, ParamValue> {
  const scopes = scopesForArea(h, inventory, areaId);
  return Object.fromEntries(PARAM_KEYS.map((k) => [k, resolveIn(p, scopes, k).value])) as Record<ParamKey, ParamValue>;
}

// Where a value comes from, for a tooltip: "interior areas", "Kitchen"…
export function sourceName(h: Hierarchy, s: ParamSource): string {
  switch (s.level) {
    case "default":
      return "the built-in default";
    case "house":
      return "the house default";
    case "type":
      return s.id === "exterior" ? "exterior areas" : "interior areas";
    case "area":
      return h.areas[s.id!]?.name ?? s.id!;
  }
}

// "23:00" → "23:00:00", the form a blueprint's time input takes.
export const withSeconds = (t: string) => `${t}:00`;

// ---------------------------------------------------------------------------
// Edits. Each returns new settings, or the same object when nothing changes.
// A value of null clears it (the level inherits again) and an emptied level goes.
// ---------------------------------------------------------------------------

const sameParam = (a: ParamValue | null, b: ParamValue | null): boolean =>
  Array.isArray(a) && Array.isArray(b) ? a.length === b.length && a.every((x, i) => x === b[i]) : a === b;

export function setParameter(p: ParameterSettings, scope: ParamScope, key: ParamKey, value: ParamValue | null): ParameterSettings {
  // Only an area has a parameter of one area, and only the house one of the house.
  if (PARAM_DEF[key].areaOnly && scope.level !== "area") return p;
  if (PARAM_DEF[key].houseOnly && scope.level !== "house") return p;
  // An empty list is no value.
  if (Array.isArray(value) && value.length === 0) value = null;
  const cur = valuesOf(p, scope);
  if (sameParam(cur?.[key] ?? null, value)) return p;
  const next: ParamValues = { ...cur };
  if (value === null) delete next[key];
  else next[key] = value;
  const empty = Object.keys(next).length === 0;
  switch (scope.level) {
    case "house":
      return { ...p, house: next };
    case "type": {
      const types = { ...p.types };
      if (empty) delete types[scope.id];
      else types[scope.id] = next;
      return { ...p, types };
    }
    case "area": {
      const areas = { ...p.areas };
      if (empty) delete areas[scope.id];
      else areas[scope.id] = next;
      return { ...p, areas };
    }
  }
}

// ---------------------------------------------------------------------------
// The rows of a parameters table: the house, interior and exterior, then the
// areas, grouped under the floor they are on. A floor has no values: it is only a
// heading.
// ---------------------------------------------------------------------------

export type ParamRow = {
  scope: ParamScope;
  label: string;
  // The scopes it inherits from, most specific first, starting with its own.
  chain: ParamScope[];
  // Areas: the floor an area is on (null: none), for grouping.
  floorId: string | null;
  floorName: string | null;
  // Position in the default order: floors by level, their areas by name.
  order: number;
};

// A floor in the table: a heading over its areas, with nothing to set.
export type FloorHeading = { floorId: string; name: string };

export function paramRows(h: Hierarchy, inventory: InventorySettings): { fixed: ParamRow[]; rest: ParamRow[]; floors: FloorHeading[] } {
  const house: ParamScope = { level: "house" };
  const fixed: ParamRow[] = [
    { scope: house, label: "House default", chain: [house], floorId: null, floorName: null, order: 0 },
    ...AREA_TYPES.map((t, i): ParamRow => {
      const scope: ParamScope = { level: "type", id: t };
      return { scope, label: t === "interior" ? "Interior" : "Exterior", chain: [scope, house], floorId: null, floorName: null, order: i + 1 };
    }),
  ];
  const rest: ParamRow[] = [];
  let order = 0;
  const addAreas = (ids: readonly string[], floorId: string | null, floorName: string | null) => {
    for (const id of ids) {
      if (!h.areas[id]) continue;
      rest.push({ scope: { level: "area", id }, label: h.areas[id].name, chain: scopesForArea(h, inventory, id), floorId, floorName, order: order++ });
    }
  };
  for (const f of h.floors) addAreas(f.areaIds, f.id, f.name);
  addAreas(h.looseAreaIds, null, null);
  return { fixed, rest, floors: h.floors.filter((f) => f.areaIds.length > 0).map((f) => ({ floorId: f.id, name: f.name })) };
}

// ---------------------------------------------------------------------------
// Entry lights: the lights that come on by day when an area becomes occupied.
// ---------------------------------------------------------------------------

export type EntryLightsSource =
  // The user's choice.
  | "set"
  // Nothing chosen, and the area has one counted light.
  | "only"
  // Nothing chosen: the main lights of the area.
  | "main"
  // Nothing chosen and nothing to suggest.
  | "none";

export type EntryLights = {
  // The lights that go on: the choice when it names a counted light of the area,
  // else the default.
  lights: string[];
  source: EntryLightsSource;
  // What the user chose, whether or not it still applies (null: nothing).
  set: string[] | null;
  // The default, which `lights` is when nothing applies. It is what the Lighting
  // tab shows muted as "suggested".
  suggested: string[];
};

// `rows`: the lights of the area's inventory (areaInventory(...).lights). The
// choice is kept only for lights that still count in the area, so a light that
// was removed or excluded can't leave the automation switching something that
// isn't there.
export function entryLights(p: ParameterSettings, areaId: string, rows: readonly Pick<InventoryRow, "entityId" | "counts" | "light">[]): EntryLights {
  const counted = rows.filter((r) => r.counts);
  const only = counted.length === 1;
  const suggested = only
    ? [counted[0].entityId]
    : counted
        .filter((r) => r.light === "main")
        .map((r) => r.entityId)
        .sort();
  const stored = ownValue(p, { level: "area", id: areaId }, "entry_lights");
  const set = Array.isArray(stored) ? stored : null;
  const valid = set ? set.filter((id) => counted.some((r) => r.entityId === id)).sort() : [];
  if (valid.length > 0) return { lights: valid, source: "set", set, suggested };
  return { lights: suggested, source: suggested.length === 0 ? "none" : only ? "only" : "main", set, suggested };
}
