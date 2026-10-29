import { areaChoice, areaInventory, CAPABILITIES, type AreaType, type Capability, type InventorySettings } from "./inventory.ts";
import { helperExclusions } from "./helpers.ts";
import type { NamingSettings } from "./naming.ts";
import type { AreaRecipeKey } from "./blueprints.ts";
import type { RecipeCell, RecipeStatus } from "./recipes.ts";
import type { Hierarchy } from "./types.ts";

// Which recipes make sense for which area. The Recipes page lists every recipe
// for every area, so "Missing requirements" sat in every cell of a room that
// could never use the recipe ("Bathroom → Exterior lights"). A recipe FITS an
// area when the area has the kind of thing the recipe is about, or the area is
// the kind of place the recipe is for. What is still missing then means
// something: the sensor is there but not counted, a helper is not made yet.
//
// "Has" counts candidate entities of a capability whether or not they are
// counted in Capabilities; fitting is about what the room is, not about whether
// the person has finished setting it up. The rules:
//
//   occupancy        a motion or presence sensor, or the area is marked a bedroom
//   motion_lights    interior, and lights with a motion or presence sensor (or a bedroom)
//   media_off        a speaker or a TV
//   area_climate     interior, and a thermostat (or a bedroom)
//   bathroom_fan     interior, and a fan; or a humidity sensor in a bathroom-like
//                    area (bath, toilet, WC, shower, washroom, ensuite…)
//   exterior_lights  only an area marked Exterior (Capabilities, Type)
//   left_open        a door or a window sensor
//   appliance_done   a power sensor
//
// A recipe that is installed, out of date or already in the changes is always
// shown, whatever the rules say: what exists is never hidden.

export type AreaFacts = {
  name: string;
  type: AreaType;
  bedroom: boolean;
  // How many candidate entities the area has of each capability.
  has: Record<Capability, number>;
};

const BATHROOM_NAME = /\b(bath|bathroom|toilet|wc|shower|washroom|restroom|powder|ensuite|en-suite|lavatory)\b/i;
export const isBathroomLike = (name: string): boolean => BATHROOM_NAME.test(name);

export function areaFacts(h: Hierarchy, inventory: InventorySettings, naming: NamingSettings, areaId: string): AreaFacts {
  const inv = areaInventory(h, inventory, areaId, helperExclusions(h, naming)(areaId));
  const choice = areaChoice(inventory, areaId);
  const has = Object.fromEntries(CAPABILITIES.map((c) => [c.key, inv[c.key].length])) as Record<Capability, number>;
  return { name: h.areas[areaId]?.name ?? areaId, type: choice.type, bedroom: choice.bedroom, has };
}

// The rule alone, before the status exception.
export function recipeSuitsArea(f: AreaFacts, recipe: AreaRecipeKey): boolean {
  const interior = f.type === "interior";
  switch (recipe) {
    case "occupancy":
      return f.has.motion + f.has.presence > 0 || f.bedroom;
    case "motion_lights":
      return interior && f.has.lights > 0 && (f.has.motion + f.has.presence > 0 || f.bedroom);
    case "media_off":
      return f.has.speaker + f.has.tv > 0;
    case "area_climate":
      return interior && (f.has.thermostat > 0 || f.bedroom);
    case "bathroom_fan":
      return interior && (f.has.fan > 0 || (f.has.humidity > 0 && isBathroomLike(f.name)));
    case "exterior_lights":
      return f.type === "exterior";
    case "left_open":
      return f.has.door + f.has.window > 0;
    case "appliance_done":
      return f.has.power > 0;
  }
}

export function recipeFits(f: AreaFacts, recipe: AreaRecipeKey, status: RecipeStatus): boolean {
  if (status === "installed" || status === "out-of-date" || status === "in-changes") return true;
  return recipeSuitsArea(f, recipe);
}

// The cells of a plan split into the ones that fit their area and the ones that
// do not. Announce is the house's one script and always fits.
export function splitByFit(
  h: Hierarchy,
  inventory: InventorySettings,
  naming: NamingSettings,
  cells: readonly RecipeCell[],
): { fits: RecipeCell[]; hidden: RecipeCell[] } {
  const byArea = new Map<string, AreaFacts>();
  const fits: RecipeCell[] = [];
  const hidden: RecipeCell[] = [];
  for (const cell of cells) {
    if (cell.recipe === "announce") {
      fits.push(cell);
      continue;
    }
    let f = byArea.get(cell.areaId);
    if (!f) {
      f = areaFacts(h, inventory, naming, cell.areaId);
      byArea.set(cell.areaId, f);
    }
    (recipeFits(f, cell.recipe, cell.status) ? fits : hidden).push(cell);
  }
  return { fits, hidden };
}
