import type { RecipeKey } from "../../shared/blueprints.ts";

export const PARAMETER_TAB: Record<RecipeKey, string> = {
  occupancy: "occupancy",
  motion_lights: "lighting",
  media_off: "media",
  area_climate: "climate",
  bathroom_fan: "fan",
  exterior_lights: "exterior",
  left_open: "safety",
  appliance_done: "safety",
  announce: "house",
  leak_alert: "safety",
  covers_sun: "covers",
  goodbye: "house",
  house_presence: "house",
  battery_low: "safety",
  unavailable_watch: "safety",
};
