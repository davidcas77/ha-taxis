import type { AreaRecipeKey } from "./blueprints.ts";
import type { AreaType } from "./inventory.ts";

export type RecipeDefaultFacts = {
  location: AreaType;
  staircase: boolean;
  bedroom: boolean;
  bathroom: boolean;
  motionOrPresence: boolean;
  tvStarts: boolean;
  light: boolean;
  media: boolean;
  climate: boolean;
  opening: boolean;
  power: boolean;
  leak: boolean;
  cover: boolean;
};

/** Defaults are about candidate equipment, never helper installation or counted selections. */
export function recipeDefault(facts: RecipeDefaultFacts, recipe: AreaRecipeKey): { active: boolean; reason: string } {
  const occupancy = facts.motionOrPresence || facts.tvStarts || facts.bedroom;
  switch (recipe) {
    case "occupancy":
      return { active: occupancy, reason: "Needs a motion or presence candidate, a TV set to start occupancy, or a Bedroom." };
    case "motion_lights":
      return { active: facts.location === "interior" && facts.light && occupancy, reason: "Needs an Interior area, a light and occupancy potential." };
    case "media_off":
      return { active: !facts.staircase && facts.media, reason: "Needs a speaker or TV in an area without the Staircase label." };
    case "area_climate":
      return { active: facts.location === "interior" && facts.climate, reason: "Needs an Interior area and a climate device." };
    case "bathroom_fan":
      return { active: facts.bathroom, reason: "Active by default for an area explicitly marked Bathroom." };
    case "exterior_lights":
      return { active: facts.location === "exterior" && facts.light, reason: "Needs an Exterior area and a light." };
    case "left_open":
      return { active: facts.opening, reason: "Needs a door or window sensor." };
    case "appliance_done":
      return { active: facts.power, reason: "Needs a power sensor." };
    case "leak_alert":
      return { active: facts.leak, reason: "Needs a leak sensor." };
    case "covers_sun":
      return { active: facts.cover, reason: "Needs a cover." };
  }
}
