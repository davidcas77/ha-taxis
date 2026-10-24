import type { CategoryScope, EntityRole } from "./types.ts";

// What an entity does in a room, from its domain and device class. Read from
// Home Assistant, never guessed from a name.

const BINARY_SENSOR_ROLES: Record<string, EntityRole> = {
  motion: "motion",
  moving: "motion",
  occupancy: "presence",
  presence: "presence",
  door: "opening",
  window: "opening",
  garage_door: "opening",
  opening: "opening",
};

const SENSOR_ROLES: Record<string, EntityRole> = {
  temperature: "temperature",
  humidity: "humidity",
  illuminance: "illuminance",
  power: "power",
  energy: "power",
  current: "power",
  voltage: "power",
  battery: "battery",
};

const DOMAIN_ROLES: Record<string, EntityRole> = {
  light: "light",
  switch: "switch",
  siren: "switch",
  climate: "climate",
  fan: "climate",
  humidifier: "climate",
  water_heater: "climate",
  media_player: "media",
  remote: "media",
  cover: "cover",
  valve: "cover",
  lock: "lock",
  button: "button",
  event: "button",
  input_button: "button",
  automation: "automation",
  script: "automation",
  scene: "automation",
  input_boolean: "helper",
  input_number: "helper",
  input_select: "helper",
  input_text: "helper",
  input_datetime: "helper",
  counter: "helper",
  timer: "helper",
  schedule: "helper",
  camera: "camera",
  image: "camera",
};

export function entityRole(domain: string, deviceClass: string | null): EntityRole {
  if (domain === "binary_sensor") return (deviceClass && BINARY_SENSOR_ROLES[deviceClass]) || "sensor";
  if (domain === "sensor") return (deviceClass && SENSOR_ROLES[deviceClass]) || "sensor";
  return DOMAIN_ROLES[domain] ?? "other";
}

// Display order and labels for role groups in a room.
export const ROLE_ORDER: { role: EntityRole; label: string }[] = [
  { role: "light", label: "Lights" },
  { role: "switch", label: "Switches" },
  { role: "motion", label: "Motion" },
  { role: "presence", label: "Presence" },
  { role: "opening", label: "Doors and windows" },
  { role: "climate", label: "Climate" },
  { role: "temperature", label: "Temperature" },
  { role: "humidity", label: "Humidity" },
  { role: "illuminance", label: "Light level" },
  { role: "cover", label: "Covers" },
  { role: "lock", label: "Locks" },
  { role: "media", label: "Media" },
  { role: "camera", label: "Cameras" },
  { role: "power", label: "Power and energy" },
  { role: "battery", label: "Batteries" },
  { role: "button", label: "Buttons and events" },
  { role: "sensor", label: "Other sensors" },
  { role: "automation", label: "Automations and scenes" },
  { role: "helper", label: "Helpers" },
  { role: "other", label: "Other" },
];

// Helpers made in Settings → Helpers. Some are their own domain (input_*,
// timer…); others are config-entry helpers whose platform names them.
const HELPER_DOMAINS = new Set(["input_boolean", "input_number", "input_select", "input_text", "input_datetime", "input_button", "counter", "timer", "schedule"]);
const HELPER_PLATFORMS = new Set(["template", "group", "min_max", "derivative", "utility_meter", "threshold", "trend", "integration", "statistics", "switch_as_x", "tod", "filter", "history_stats", "random", "mold_indicator"]);

// Which of Home Assistant's category lists an entity can be filed in, if any.
export function categoryScopeFor(domain: string, platform: string): CategoryScope | null {
  if (domain === "automation") return "automation";
  if (domain === "script") return "script";
  if (domain === "scene") return "scene";
  if (HELPER_DOMAINS.has(domain) || HELPER_PLATFORMS.has(platform)) return "helpers";
  return null;
}
