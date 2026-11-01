import { describe, expect, it } from "vitest";
import { buildHierarchy, type RawRegistry } from "../../server/model/hierarchy.ts";
import { RECIPE_KEYS } from "../../shared/blueprints.ts";
import { HOUSE_AREAS_OCCUPIED_ID, HOUSE_OCCUPIED_ID, HOUSE_PAUSE_ID } from "../../shared/climate.ts";
import { canonicalId, helperSuffixes } from "../../shared/helpers.ts";
import { CAPABILITIES, EMPTY_INVENTORY, setAppliance, setCounts } from "../../shared/inventory.ts";
import { DEFAULT_NAMING } from "../../shared/naming.ts";
import { EMPTY_PARAMETERS, PARAM_DEF, setParameter } from "../../shared/parameters.ts";
import { runtimeIds } from "../../shared/recipes.ts";
import { RECIPE_AVAILABILITY, recipeHelperSpecs, recipeHouseEntities, type RecipeHelperContext } from "./recipe-availability-spec.ts";

const raw: RawRegistry = {
  config: { location_name: "House" },
  floors: [],
  areas: [{ area_id: "kitchen", name: "Kitchen", floor_id: null }],
  devices: [],
  labels: [],
  entities: [
    { entity_id: "sensor.kitchen_washer", platform: "demo", area_id: "kitchen", unique_id: "washer" },
    { entity_id: "sensor.kitchen_other_power", platform: "demo", area_id: "kitchen", unique_id: "other" },
    { entity_id: "binary_sensor.kitchen_motion", platform: "demo", area_id: "kitchen", unique_id: "motion" },
    { entity_id: "media_player.kitchen_speaker", platform: "demo", area_id: "kitchen", unique_id: "speaker" },
    { entity_id: "sensor.remote_battery", platform: "demo", area_id: null, unique_id: "battery" },
    { entity_id: "binary_sensor.remote_battery", platform: "demo", area_id: null, unique_id: "battery2" },
  ],
  states: [
    { entity_id: "sensor.kitchen_washer", state: "3", attributes: { device_class: "power" } },
    { entity_id: "sensor.kitchen_other_power", state: "3", attributes: { device_class: "power" } },
    { entity_id: "binary_sensor.kitchen_motion", state: "off", attributes: { device_class: "motion" } },
    { entity_id: "media_player.kitchen_speaker", state: "idle", attributes: {} },
    { entity_id: "sensor.remote_battery", state: "30", attributes: { device_class: "battery" } },
    { entity_id: "binary_sensor.remote_battery", state: "off", attributes: { device_class: "battery" } },
  ],
};
const h = buildHierarchy(raw, "now");
const naming = {
  ...DEFAULT_NAMING,
  areaCodes: { kitchen: "kit" },
  helperNames: { lights: "custom_lights", humidity: "custom_humidity", illuminance: "custom_lux" },
  houseGroup: "whole_home",
};
const context: RecipeHelperContext = {
  recipe: "occupancy",
  h,
  areaId: "kitchen",
  inventory: EMPTY_INVENTORY,
  naming,
  parameters: EMPTY_PARAMETERS,
  changes: [],
};
const specs = (recipe: RecipeHelperContext["recipe"], overrides: Partial<RecipeHelperContext> = {}) => recipeHelperSpecs({ ...context, recipe, ...overrides });

describe("recipe availability metadata", () => {
  it("shows the same selected legacy timer as the planner", () => {
    const legacy = {
      ...raw,
      entities: [...raw.entities, { entity_id: "timer.old_kitchen_motion_hold", platform: "timer", area_id: "kitchen", unique_id: "hold" }],
      states: [...raw.states, { entity_id: "timer.old_kitchen_motion_hold", state: "idle", attributes: {} }],
    };
    const hierarchy = buildHierarchy(legacy, "now");
    expect(specs("occupancy", { h: hierarchy })).toContainEqual(expect.objectContaining({ id: "timer.old_kitchen_motion_hold", domain: "timer" }));
    expect(specs("occupancy", { h: hierarchy }).some((s) => s.id === "timer.kit_hold")).toBe(false);
  });
  it("covers exactly the fifteen recipes with known capabilities and valid scopes", () => {
    expect(Object.keys(RECIPE_AVAILABILITY).sort()).toEqual([...RECIPE_KEYS].sort());
    expect(RECIPE_KEYS).toHaveLength(15);
    const caps = new Set(CAPABILITIES.map((c) => c.key));
    for (const [recipe, spec] of Object.entries(RECIPE_AVAILABILITY)) {
      for (const cap of spec.capabilities) expect(caps.has(cap), `${recipe}: ${cap}`).toBe(true);
      for (const key of spec.areaParams) expect(PARAM_DEF[key] && !PARAM_DEF[key].houseOnly, `${recipe}: ${key}`).toBe(true);
      for (const key of spec.houseParams) expect(PARAM_DEF[key] && !PARAM_DEF[key].areaOnly, `${recipe}: ${key}`).toBe(true);
      expect(new Set(spec.areaParams).size).toBe(spec.areaParams.length);
      expect(new Set(spec.houseParams).size).toBe(spec.houseParams.length);
    }
    expect(RECIPE_AVAILABILITY.left_open.areaParams).not.toContain("appliance_idle_watts");
    expect(RECIPE_AVAILABILITY.leak_alert.houseParams).toContain("leak_valve_entity");
  });

  it("uses configured suffixes and planner runtime IDs, with distinct providers", () => {
    const ids = runtimeIds("kit");
    const suffix = helperSuffixes(naming);
    expect(specs("motion_lights")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: canonicalId("light", "kit", suffix.lights), type: "group", platform: "group", provider: "Helpers" }),
        expect.objectContaining({ id: canonicalId("sensor", "kit", suffix.illuminance), platform: "min_max", optional: true }),
        expect.objectContaining({ id: ids.occupied, provider: "Occupancy", platform: "template" }),
        expect.objectContaining({ id: ids.override, domain: "timer" }),
      ]),
    );
    expect(specs("bathroom_fan")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: canonicalId("sensor", "kit", suffix.humidity), type: "group" }),
        expect.objectContaining({ id: ids.rate, platform: "derivative" }),
      ]),
    );
    expect(specs("occupancy").find((s) => s.id === ids.rate)).toMatchObject({ optional: true, provider: "Bathroom fan" });
    expect(specs("left_open").map((s) => s.id)).toEqual([ids.switch]);
    expect(RECIPE_AVAILABILITY.goodbye.capabilities).toContain("lights");
  });

  it("lists Occupancy prerequisites for Announce speakers without treating helpers as proof of installation", () => {
    const ids = runtimeIds("kit");
    expect(specs("announce")).toEqual([
      expect.objectContaining({
        id: ids.occupied,
        role: "Area occupancy virtual sensor (Occupancy prerequisite for Kitchen)",
        provider: "Occupancy",
        platform: "template",
      }),
      expect.objectContaining({ id: ids.switch, role: "Pause switch (Occupancy prerequisite for Kitchen)", provider: "Occupancy" }),
    ]);
    const inventory = setCounts(h, EMPTY_INVENTORY, "media_player.kitchen_speaker", false);
    expect(specs("announce", { inventory })).toEqual([]);
    expect(specs("occupancy").find((s) => s.id === ids.occupied)?.role).toBe("Area occupancy virtual sensor");
    expect(specs("house_presence").find((s) => s.id === HOUSE_OCCUPIED_ID)?.role).toBe("House occupancy virtual sensor");
  });

  it("uses the house constants and selected external mode in its effective scope", () => {
    expect(specs("house_presence").map((s) => s.id)).toEqual(expect.arrayContaining([HOUSE_AREAS_OCCUPIED_ID, HOUSE_OCCUPIED_ID, HOUSE_PAUSE_ID]));
    expect(specs("goodbye")[0].id).toBe("light.whole_home");
    const parameters = setParameter(EMPTY_PARAMETERS, { level: "area", id: "kitchen" }, "away_mode_entity", "input_boolean.external_away");
    expect(specs("motion_lights", { parameters })).toContainEqual(
      expect.objectContaining({ id: "input_boolean.external_away", provider: "External selection", optional: true }),
    );
    expect(specs("area_climate", { parameters })).toContainEqual(
      expect.objectContaining({ id: "input_boolean.external_away", provider: "External selection" }),
    );
    expect(specs("bathroom_fan").some((s) => s.role.startsWith("Sleep mode"))).toBe(false);
    const suppress = setParameter(EMPTY_PARAMETERS, { level: "area", id: "kitchen" }, "fan_suppress_in_sleep", true);
    expect(specs("bathroom_fan", { parameters: suppress }).some((s) => s.role.startsWith("Sleep mode"))).toBe(true);
  });

  it("exposes only real group or managed helper identities for every recipe", () => {
    for (const recipe of RECIPE_KEYS) {
      const found = specs(recipe);
      expect(new Set(found.map((s) => s.id)).size, recipe).toBe(found.length);
      for (const item of found) {
        expect(item.id.startsWith(`${item.domain}.`), `${recipe}: ${item.id}`).toBe(true);
        expect(["managed", "group"]).toContain(item.type);
        if (item.type === "group") expect(["group", "min_max"]).toContain(item.platform);
        expect(item.name && item.role).toBeTruthy();
      }
    }
  });

  it("matches the house watcher's sources and finds batteries outside any area", () => {
    const inventory = setAppliance(EMPTY_INVENTORY, "sensor.kitchen_washer", true);
    expect(recipeHouseEntities("unavailable_watch", h, inventory, naming)).toEqual(["binary_sensor.kitchen_motion", "sensor.kitchen_washer"]);
    expect(recipeHouseEntities("battery_low", h, inventory, naming)).toEqual(["binary_sensor.remote_battery", "sensor.remote_battery"]);
  });
});
