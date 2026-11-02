import { describe, expect, it } from "vitest";
import { buildHierarchy, type RawRegistry } from "../server/model/hierarchy.ts";
import { validateInventory } from "../server/settings.ts";
import { setAreaRoomTypes } from "./area-room-types.ts";
import { EMPTY_INVENTORY, recipePreferenceInfo, recipeWanted, setCounts, setRecipeWanted } from "./inventory.ts";
import { recipeDefault, type RecipeDefaultFacts } from "./recipe-defaults.ts";
import { DEFAULT_NAMING } from "./naming.ts";
import { EMPTY_PARAMETERS } from "./parameters.ts";
import { splitByFit } from "./recipe-fit.ts";
import { NOTHING_INSTALLED, planRecipes } from "./recipes.ts";
import type { AreaRecipeKey } from "./blueprints.ts";

const empty: RecipeDefaultFacts = {
  location: "interior",
  staircase: false,
  bedroom: false,
  bathroom: false,
  motionOrPresence: false,
  tvStarts: false,
  light: false,
  media: false,
  climate: false,
  opening: false,
  power: false,
  leak: false,
  cover: false,
};
const cases: [AreaRecipeKey, Partial<RecipeDefaultFacts>][] = [
  ["occupancy", { motionOrPresence: true }],
  ["motion_lights", { motionOrPresence: true, light: true }],
  ["media_off", { media: true }],
  ["area_climate", { climate: true }],
  ["bathroom_fan", { bathroom: true }],
  ["exterior_lights", { location: "exterior", light: true }],
  ["left_open", { opening: true }],
  ["appliance_done", { power: true }],
  ["leak_alert", { leak: true }],
  ["covers_sun", { cover: true }],
];

const raw: RawRegistry = {
  config: { location_name: "Test" },
  floors: [],
  areas: [{ area_id: "room", name: "Bathroom" }],
  devices: [{ id: "cam", name: "Camera", area_id: "room" }],
  entities: [
    { entity_id: "binary_sensor.camera_motion", platform: "mqtt", area_id: "room", device_id: "cam" },
    { entity_id: "camera.camera", platform: "mqtt", area_id: "room", device_id: "cam" },
    { entity_id: "light.lamp", platform: "mqtt", area_id: "room" },
    { entity_id: "climate.heat", platform: "mqtt", area_id: "room" },
    { entity_id: "media_player.tv", platform: "mqtt", area_id: "room" },
    { entity_id: "binary_sensor.generated", platform: "group", area_id: "room" },
  ],
  states: [
    { entity_id: "binary_sensor.camera_motion", state: "off", attributes: { device_class: "motion" } },
    { entity_id: "camera.camera", state: "idle", attributes: {} },
    { entity_id: "light.lamp", state: "on", attributes: {} },
    { entity_id: "climate.heat", state: "heat", attributes: {} },
    { entity_id: "media_player.tv", state: "on", attributes: { device_class: "tv" } },
    { entity_id: "binary_sensor.generated", state: "off", attributes: { device_class: "motion" } },
  ],
  labels: [],
};

describe("area recipe defaults", () => {
  it("defines all ten recipe defaults and their classification constraints", () => {
    for (const [key, facts] of cases) {
      expect(recipeDefault(empty, key).active, key).toBe(false);
      expect(recipeDefault({ ...empty, ...facts }, key).active, key).toBe(true);
      expect(recipeDefault({ ...empty, ...facts }, key).reason, key).toBeTruthy();
    }
    expect(recipeDefault({ ...empty, bedroom: true }, "occupancy").active).toBe(true);
    expect(recipeDefault({ ...empty, tvStarts: true }, "occupancy").active).toBe(true);
    expect(recipeDefault({ ...empty, media: true, staircase: true }, "media_off").active).toBe(false);
    expect(recipeDefault({ ...empty, location: "exterior", light: true, motionOrPresence: true }, "motion_lights").active).toBe(false);
    expect(recipeDefault({ ...empty, location: "exterior", climate: true }, "area_climate").active).toBe(false);
    expect(recipeDefault({ ...empty, light: true }, "exterior_lights").active).toBe(false);
    expect(recipeDefault({ ...empty, location: "exterior", bathroom: true }, "bathroom_fan").active).toBe(true);
  });

  it("uses unselected physical/camera candidates but not generated-only helpers", () => {
    const h = buildHierarchy(structuredClone(raw), "now");
    let s = setCounts(h, EMPTY_INVENTORY, "light.lamp", false);
    expect(recipeWanted(s, "room", "occupancy", h)).toBe(true); // unselected camera sensor
    expect(recipeWanted(s, "room", "motion_lights", h)).toBe(true); // unselected light
    expect(recipeWanted(s, "room", "area_climate", h)).toBe(true);
    expect(recipeWanted(s, "room", "media_off", h)).toBe(true);
    h.areas.room.entityIds = ["binary_sensor.generated"];
    expect(recipeWanted(s, "room", "occupancy", h)).toBe(false);
    s = setCounts(h, s, "binary_sensor.generated", true);
    expect(recipeWanted(s, "room", "occupancy", h)).toBe(true);
  });

  it("responds to assigned labels and explicit bathroom types, not the name alone", () => {
    const h = buildHierarchy(structuredClone(raw), "now");
    expect(recipeWanted(EMPTY_INVENTORY, "room", "bathroom_fan", h)).toBe(false);
    expect(recipeWanted(setAreaRoomTypes(EMPTY_INVENTORY, "room", ["bathroom"]), "room", "bathroom_fan", h)).toBe(true);
    for (const [id, name] of [
      ["outside", "Exterior"],
      ["stairs", "Staircase"],
      ["bath", "Bathroom"],
      ["other", "Other"],
    ])
      h.labels[id] = { id, name, color: null, icon: null, description: null };
    h.areas.room.labels = ["outside", "stairs", "bath"];
    expect(recipeWanted(EMPTY_INVENTORY, "room", "area_climate", h)).toBe(false);
    expect(recipeWanted(EMPTY_INVENTORY, "room", "exterior_lights", h)).toBe(true);
    expect(recipeWanted(EMPTY_INVENTORY, "room", "media_off", h)).toBe(false);
    expect(recipeWanted(EMPTY_INVENTORY, "room", "bathroom_fan", h)).toBe(true);
    h.areas.room.labels = ["other"];
    expect(recipeWanted(setAreaRoomTypes(EMPTY_INVENTORY, "room", ["bathroom"]), "room", "bathroom_fan", h)).toBe(false);
  });

  it("persists explicit true and false for every recipe and shows explicitly enabled rows regardless of fit", () => {
    const h = buildHierarchy(structuredClone(raw), "now");
    let s = EMPTY_INVENTORY;
    for (const [key] of cases) s = setRecipeWanted(s, "room", key, true, h);
    const checked = validateInventory(s);
    expect(checked.ok).toBe(true);
    if (!checked.ok) return;
    for (const [key] of cases) expect(recipePreferenceInfo(checked.value, "room", key, h)).toMatchObject({ active: true, manual: true });
    const cells = planRecipes(h, checked.value, DEFAULT_NAMING, EMPTY_PARAMETERS, NOTHING_INSTALLED, []);
    const fits = splitByFit(h, checked.value, DEFAULT_NAMING, cells).fits.map((cell) => cell.recipe);
    for (const [key] of cases) expect(fits).toContain(key);
    for (const [key] of cases) s = setRecipeWanted(s, "room", key, false, h);
    const off = validateInventory(s);
    expect(off.ok).toBe(true);
    if (!off.ok) return;
    for (const [key] of cases) expect(recipePreferenceInfo(off.value, "room", key, h)).toMatchObject({ active: false, manual: true });
  });
});
