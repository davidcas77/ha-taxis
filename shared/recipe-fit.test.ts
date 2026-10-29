import { describe, expect, it } from "vitest";

import { buildHierarchy, type RawRegistry } from "../server/model/hierarchy.ts";
import { CAPABILITIES, EMPTY_INVENTORY, setAreaType, setBedroom, type Capability } from "./inventory.ts";
import { DEFAULT_NAMING } from "./naming.ts";
import { areaFacts, isBathroomLike, recipeFits, recipeSuitsArea, splitByFit, type AreaFacts } from "./recipe-fit.ts";
import { NOTHING_INSTALLED, planRecipes } from "./recipes.ts";
import { planHouseRecipes } from "./recipes-house.ts";
import { EMPTY_PARAMETERS } from "./parameters.ts";

const facts = (has: Partial<Record<Capability, number>> = {}, rest: Partial<AreaFacts> = {}): AreaFacts => ({
  name: "Room",
  type: "interior",
  bedroom: false,
  ...rest,
  has: { ...Object.fromEntries(CAPABILITIES.map((c) => [c.key, 0])), ...has } as Record<Capability, number>,
});

describe("recipeSuitsArea", () => {
  it("occupancy needs a motion or presence sensor, or a bedroom", () => {
    expect(recipeSuitsArea(facts(), "occupancy")).toBe(false);
    expect(recipeSuitsArea(facts({ motion: 1 }), "occupancy")).toBe(true);
    expect(recipeSuitsArea(facts({ presence: 1 }), "occupancy")).toBe(true);
    expect(recipeSuitsArea(facts({}, { bedroom: true }), "occupancy")).toBe(true);
  });

  it("motion lights need lights and a sensor in an interior area", () => {
    expect(recipeSuitsArea(facts({ lights: 2 }), "motion_lights")).toBe(false);
    expect(recipeSuitsArea(facts({ lights: 2, motion: 1 }), "motion_lights")).toBe(true);
    expect(recipeSuitsArea(facts({ lights: 2 }, { bedroom: true }), "motion_lights")).toBe(true);
    expect(recipeSuitsArea(facts({ lights: 2, motion: 1 }, { type: "exterior" }), "motion_lights")).toBe(false);
  });

  it("media off needs a speaker or a TV", () => {
    expect(recipeSuitsArea(facts(), "media_off")).toBe(false);
    expect(recipeSuitsArea(facts({ speaker: 1 }), "media_off")).toBe(true);
    expect(recipeSuitsArea(facts({ tv: 1 }), "media_off")).toBe(true);
  });

  it("area climate needs a thermostat, or a bedroom, indoors", () => {
    expect(recipeSuitsArea(facts(), "area_climate")).toBe(false);
    expect(recipeSuitsArea(facts({ thermostat: 1 }), "area_climate")).toBe(true);
    expect(recipeSuitsArea(facts({}, { bedroom: true }), "area_climate")).toBe(true);
    expect(recipeSuitsArea(facts({ thermostat: 1 }, { type: "exterior" }), "area_climate")).toBe(false);
  });

  it("bathroom fan needs a fan, or humidity in a bathroom-like area", () => {
    expect(recipeSuitsArea(facts({ humidity: 1 }, { name: "Living room" }), "bathroom_fan")).toBe(false);
    expect(recipeSuitsArea(facts({ humidity: 1 }, { name: "Guest bathroom" }), "bathroom_fan")).toBe(true);
    expect(recipeSuitsArea(facts({ fan: 1 }, { name: "Loft" }), "bathroom_fan")).toBe(true);
    expect(recipeSuitsArea(facts({ fan: 1 }, { type: "exterior" }), "bathroom_fan")).toBe(false);
    expect(recipeSuitsArea(facts({}, { name: "Bathroom" }), "bathroom_fan")).toBe(false);
  });

  it("exterior lights fit only an exterior area", () => {
    expect(recipeSuitsArea(facts({ lights: 3 }), "exterior_lights")).toBe(false);
    expect(recipeSuitsArea(facts({}, { type: "exterior" }), "exterior_lights")).toBe(true);
  });

  it("left open needs a door or a window sensor", () => {
    expect(recipeSuitsArea(facts(), "left_open")).toBe(false);
    expect(recipeSuitsArea(facts({ window: 1 }), "left_open")).toBe(true);
    expect(recipeSuitsArea(facts({ door: 1 }), "left_open")).toBe(true);
  });

  it("appliance done needs a power sensor", () => {
    expect(recipeSuitsArea(facts(), "appliance_done")).toBe(false);
    expect(recipeSuitsArea(facts({ power: 1 }), "appliance_done")).toBe(true);
  });

  it("leak alert needs a leak sensor, indoors or out", () => {
    expect(recipeSuitsArea(facts({ lights: 2, door: 1 }), "leak_alert")).toBe(false);
    expect(recipeSuitsArea(facts({ leak: 1 }), "leak_alert")).toBe(true);
    expect(recipeSuitsArea(facts({ leak: 1 }, { type: "exterior" }), "leak_alert")).toBe(true);
  });

  it("covers and sun need a cover", () => {
    expect(recipeSuitsArea(facts({ lights: 2, window: 1 }), "covers_sun")).toBe(false);
    expect(recipeSuitsArea(facts({ cover: 1 }), "covers_sun")).toBe(true);
    expect(recipeSuitsArea(facts({}, { bedroom: true }), "covers_sun")).toBe(false);
  });
});

describe("recipeFits", () => {
  it("never hides what is installed, out of date or already in the changes", () => {
    for (const status of ["installed", "out-of-date", "in-changes"] as const) expect(recipeFits(facts(), "exterior_lights", status)).toBe(true);
  });

  it("follows the rule for a recipe that is missing or ready", () => {
    expect(recipeFits(facts(), "exterior_lights", "missing")).toBe(false);
    expect(recipeFits(facts({}, { type: "exterior" }), "exterior_lights", "ready")).toBe(true);
    expect(recipeFits(facts(), "leak_alert", "missing")).toBe(false);
    expect(recipeFits(facts({ leak: 1 }), "leak_alert", "ready")).toBe(true);
    expect(recipeFits(facts(), "covers_sun", "missing")).toBe(false);
    expect(recipeFits(facts({ cover: 1 }), "covers_sun", "ready")).toBe(true);
  });

  it("keeps an installed leak alert or covers recipe whatever the room has", () => {
    expect(recipeFits(facts(), "leak_alert", "installed")).toBe(true);
    expect(recipeFits(facts(), "covers_sun", "out-of-date")).toBe(true);
  });
});

describe("isBathroomLike", () => {
  it("reads common names", () => {
    for (const n of ["Bathroom", "Guest bath", "WC", "Toilet", "Master ensuite", "Shower room"]) expect(isBathroomLike(n), n).toBe(true);
    for (const n of ["Kitchen", "Lounge"]) expect(isBathroomLike(n), n).toBe(false);
  });
});

describe("areaFacts", () => {
  const reg: RawRegistry = {
    config: { location_name: "Test" },
    floors: [{ floor_id: "ground", name: "Ground", level: 0 }],
    areas: [
      { area_id: "bathroom", name: "Bathroom", floor_id: "ground" },
      { area_id: "garden", name: "Garden", floor_id: "ground" },
    ],
    devices: [],
    entities: [
      { entity_id: "sensor.bath_humidity", platform: "demo", area_id: "bathroom", unique_id: "a" },
      { entity_id: "fan.bath_fan", platform: "demo", area_id: "bathroom", unique_id: "b" },
      { entity_id: "light.garden_wall", platform: "demo", area_id: "garden", unique_id: "c" },
      { entity_id: "binary_sensor.bath_leak", platform: "demo", area_id: "bathroom", unique_id: "d" },
      { entity_id: "cover.garden_shutter", platform: "demo", area_id: "garden", unique_id: "e" },
    ],
    labels: [],
    states: [
      { entity_id: "sensor.bath_humidity", state: "50", attributes: { device_class: "humidity", friendly_name: "Bath humidity" } },
      { entity_id: "fan.bath_fan", state: "off", attributes: { friendly_name: "Bath fan" } },
      { entity_id: "light.garden_wall", state: "off", attributes: { friendly_name: "Garden wall" } },
      { entity_id: "binary_sensor.bath_leak", state: "off", attributes: { device_class: "moisture", friendly_name: "Bath leak" } },
      { entity_id: "cover.garden_shutter", state: "open", attributes: { friendly_name: "Garden shutter" } },
    ],
  };
  const h = buildHierarchy(reg, "now");

  it("counts the candidates of each capability, counted or not", () => {
    const f = areaFacts(h, EMPTY_INVENTORY, DEFAULT_NAMING, "bathroom");
    expect(f).toMatchObject({ name: "Bathroom", type: "interior", bedroom: false });
    expect(f.has.humidity).toBe(1);
    expect(f.has.fan).toBe(1);
    expect(f.has.lights).toBe(0);
    expect(f.has.leak).toBe(1);
    expect(f.has.cover).toBe(0);
    expect(areaFacts(h, EMPTY_INVENTORY, DEFAULT_NAMING, "garden").has.cover).toBe(1);
  });

  it("fits leak alert to the room with the leak sensor and covers and sun to the one with the cover", () => {
    const bath = areaFacts(h, EMPTY_INVENTORY, DEFAULT_NAMING, "bathroom");
    const garden = areaFacts(h, EMPTY_INVENTORY, DEFAULT_NAMING, "garden");
    expect(recipeSuitsArea(bath, "leak_alert")).toBe(true);
    expect(recipeSuitsArea(garden, "leak_alert")).toBe(false);
    expect(recipeSuitsArea(bath, "covers_sun")).toBe(false);
    expect(recipeSuitsArea(garden, "covers_sun")).toBe(true);
  });

  it("reads the area type and the bedroom flag from the inventory", () => {
    const inv = setBedroom(setAreaType(EMPTY_INVENTORY, "garden", "exterior"), "bathroom", true);
    expect(areaFacts(h, inv, DEFAULT_NAMING, "garden")).toMatchObject({ type: "exterior", bedroom: false });
    expect(areaFacts(h, inv, DEFAULT_NAMING, "bathroom").bedroom).toBe(true);
    expect(recipeSuitsArea(areaFacts(h, EMPTY_INVENTORY, DEFAULT_NAMING, "garden"), "exterior_lights")).toBe(false);
    expect(recipeSuitsArea(areaFacts(h, inv, DEFAULT_NAMING, "garden"), "exterior_lights")).toBe(true);
  });
});

describe("splitByFit", () => {
  const reg: RawRegistry = {
    config: { location_name: "Test" },
    floors: [{ floor_id: "ground", name: "Ground", level: 0 }],
    areas: [
      { area_id: "bathroom", name: "Bathroom", floor_id: "ground" },
      { area_id: "garden", name: "Garden", floor_id: "ground" },
    ],
    devices: [],
    entities: [
      { entity_id: "binary_sensor.bath_pir", platform: "demo", area_id: "bathroom", unique_id: "a" },
      { entity_id: "binary_sensor.bath_leak", platform: "demo", area_id: "bathroom", unique_id: "b" },
    ],
    labels: [],
    states: [
      { entity_id: "binary_sensor.bath_pir", state: "off", attributes: { device_class: "motion", friendly_name: "Bath PIR" } },
      { entity_id: "binary_sensor.bath_leak", state: "off", attributes: { device_class: "moisture", friendly_name: "Bath leak" } },
    ],
  };
  const h = buildHierarchy(reg, "now");
  const cells = [
    ...planRecipes(h, EMPTY_INVENTORY, DEFAULT_NAMING, EMPTY_PARAMETERS, NOTHING_INSTALLED, []),
    ...planHouseRecipes(h, EMPTY_INVENTORY, DEFAULT_NAMING, EMPTY_PARAMETERS, NOTHING_INSTALLED, []),
  ];

  it("keeps only the recipes the room can use, and every house recipe", () => {
    const { fits, hidden } = splitByFit(h, EMPTY_INVENTORY, DEFAULT_NAMING, cells);
    expect(fits.map((c) => c.recipe).sort()).toEqual(["announce", "battery_low", "goodbye", "house_presence", "leak_alert", "occupancy", "unavailable_watch"]);
    expect(fits.find((c) => c.recipe === "leak_alert")!.areaId).toBe("bathroom");
    expect(hidden.some((c) => c.areaId === "garden" && c.recipe === "covers_sun")).toBe(true);
    expect(fits.find((c) => c.recipe === "occupancy")!.areaId).toBe("bathroom");
    expect(hidden).toHaveLength(cells.length - fits.length);
    expect(hidden.some((c) => c.areaId === "garden" && c.recipe === "exterior_lights")).toBe(true);
  });
});
