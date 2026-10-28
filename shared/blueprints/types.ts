// The blueprints Taxis writes into Home Assistant (blueprints/automation/taxis/).
// Each recipe is one blueprint, written once and shared by every area that uses
// it; an area's automation only says which blueprint and fills in its inputs.
// The text lives here, in code, so the same input always gives the same
// automation and a fix reaches every area when the blueprint is rewritten.
//
// A blueprint is written only when Home Assistant has none at its path or has
// an older one: the description carries "Taxis blueprint version N.", which
// Home Assistant lists back. Raise `version` and the line in the text together
// when the text changes (a test checks they agree).
//
// Nothing here is read from the user: the change list names a path and a
// version, and Apply writes the text of that path from this file.

export const RECIPE_KEYS = [
  "occupancy",
  "motion_lights",
  "media_off",
  "area_climate",
  "bathroom_fan",
  "exterior_lights",
  "left_open",
  "appliance_done",
  "announce",
  "leak_alert",
  "covers_sun",
  "battery_low",
  "unavailable_watch",
  "house_presence",
  "goodbye",
] as const;
export type RecipeKey = (typeof RECIPE_KEYS)[number];

// The recipes that are for the whole house, not for one area: the announce and
// goodbye scripts, and the automations that look at the house (batteries, entities
// that stopped reporting, everyone being away). They have one automation or script
// each, with no area, and are planned apart (shared/recipes-house.ts).
export const HOUSE_RECIPE_KEYS = ["announce", "goodbye", "house_presence", "battery_low", "unavailable_watch"] as const;
export type HouseRecipeKey = (typeof HOUSE_RECIPE_KEYS)[number];
export const isHouseRecipe = (k: unknown): k is HouseRecipeKey => (HOUSE_RECIPE_KEYS as readonly unknown[]).includes(k);

// The recipes that are an automation for one area.
export type AreaRecipeKey = Exclude<RecipeKey, HouseRecipeKey>;

// Where blueprints may be written: taxis/<name>.yaml, nowhere else.
export const BLUEPRINT_PATH_RE = /^taxis\/[a-z0-9_]+\.yaml$/;

// The script blueprints, and the id of the script made from each (script.taxis_announce,
// script.taxis_goodbye). These are the only scripts Taxis makes.
export const ANNOUNCE_PATH = "taxis/announce.yaml";
export const ANNOUNCE_SCRIPT_ID = "taxis_announce";
export const GOODBYE_PATH = "taxis/goodbye.yaml";
export const GOODBYE_SCRIPT_ID = "taxis_goodbye";
export const SCRIPT_BLUEPRINTS: Readonly<Record<string, string>> = { [ANNOUNCE_SCRIPT_ID]: ANNOUNCE_PATH, [GOODBYE_SCRIPT_ID]: GOODBYE_PATH };
export const SCRIPT_IDS: readonly string[] = Object.keys(SCRIPT_BLUEPRINTS);
export const SCRIPT_PATHS: readonly string[] = Object.values(SCRIPT_BLUEPRINTS);

// domain: for an entity input, the domain (or domains) its entity ids are in.
// options: for a select, the words it takes. A text is a short line (a preset
// name, the comfort periods). services: a list of notify services
// ("notify.mobile_app_x"), which are service names, not entities. objects: a list
// of plain objects whose fields (`item`) are entity ids or lists of them.
export type ObjectField = { kind: "entity" | "entities"; domain: string };
export type BlueprintInput = {
  kind: "entity" | "entities" | "number" | "time" | "boolean" | "text" | "select" | "services" | "objects";
  required: boolean;
  domain?: string | readonly string[];
  options?: readonly string[];
  item?: Readonly<Record<string, ObjectField>>;
};

// The domains an input's entities may be in.
export const domainsOf = (spec: Pick<BlueprintInput, "domain">): readonly string[] =>
  spec.domain === undefined ? [] : typeof spec.domain === "string" ? [spec.domain] : spec.domain;

export type BlueprintInfo = {
  path: string;
  recipe: RecipeKey;
  // The kind of Home Assistant object it is the blueprint of.
  domain: "automation" | "script";
  version: number;
  yaml: string;
  // The inputs the blueprint declares. A test keeps this list and the text the same.
  inputs: Record<string, BlueprintInput>;
};

// The version a blueprint's description states, or null.
export function blueprintVersion(description: unknown): number | null {
  const m = typeof description === "string" ? /Taxis blueprint version (\d+)\./.exec(description) : null;
  return m ? Number(m[1]) : null;
}
