import { describe, expect, it } from "vitest";

import { buildHierarchy, type RawRegistry } from "../server/model/hierarchy.ts";
import { GOODBYE_PATH, GOODBYE_SCRIPT_ID, blueprintForRecipe, checkBlueprintInput, isHouseRecipe } from "./blueprints.ts";
import { ENTITY_ID_RE, validateInput } from "./changes.ts";
import { HOUSE_AREAS_OCCUPIED_ID, HOUSE_AWAY_ID, HOUSE_OCCUPIED_ID, HOUSE_OCCUPIED_TEMPLATE, HOUSE_PAUSE_ID } from "./climate.ts";
import { EMPTY_INVENTORY, setCounts, type InventorySettings } from "./inventory.ts";
import { DEFAULT_NAMING, type NamingSettings } from "./naming.ts";
import { EMPTY_PARAMETERS, setParameter, type ParameterSettings } from "./parameters.ts";
import {
  NOTHING_INSTALLED,
  RECIPE_LABEL,
  automationAlias,
  automationIdFor,
  planRecipes,
  recipeChangeInputs,
  type RecipeCell,
  type RecipeInstalled,
} from "./recipes.ts";
import { HOUSE_AUTOMATION_CODE, planHouseRecipes } from "./recipes-house.ts";
import type { Change, ChangeInput } from "./types.ts";

type Spec = { id: string; state?: string; dc?: string; platform?: string; area?: string; entry?: string; name?: string; members?: string[] };

// A small invented house: a living room and a kitchen.
function house(specs: Spec[]) {
  const reg: RawRegistry = {
    config: { location_name: "Test house" },
    floors: [{ floor_id: "ground", name: "Ground floor", level: 0 }],
    areas: [
      { area_id: "living_room", name: "Living room", floor_id: "ground" },
      { area_id: "kitchen", name: "Kitchen", floor_id: "ground" },
    ],
    devices: [],
    entities: [],
    labels: [],
    states: [],
  };
  for (const s of specs) {
    reg.entities.push({
      entity_id: s.id,
      platform: s.platform ?? "demo",
      area_id: s.area === undefined ? "living_room" : s.area || undefined,
      config_entry_id: s.entry,
      original_name: s.name,
      unique_id: s.id.split(".")[1],
    });
    reg.states.push({
      entity_id: s.id,
      state: s.state ?? "off",
      attributes: { friendly_name: s.name ?? s.id.split(".")[1].replace(/_/g, " "), device_class: s.dc, entity_id: s.members },
    });
  }
  return buildHierarchy(reg, "now");
}

const naming: NamingSettings = { ...DEFAULT_NAMING, areaCodes: { living_room: "living", kitchen: "kitchen" } };

type Opts = { inv?: InventorySettings; params?: ParameterSettings; installed?: Partial<RecipeInstalled>; changes?: Change[] };
const planAreas = (specs: Spec[], o: Opts = {}) =>
  planRecipes(house(specs), o.inv ?? EMPTY_INVENTORY, naming, o.params ?? EMPTY_PARAMETERS, { ...NOTHING_INSTALLED, ...o.installed }, o.changes ?? []);
const planHouse = (specs: Spec[], o: Opts = {}) =>
  planHouseRecipes(house(specs), o.inv ?? EMPTY_INVENTORY, naming, o.params ?? EMPTY_PARAMETERS, { ...NOTHING_INSTALLED, ...o.installed }, o.changes ?? []);
const area = (cells: RecipeCell[], recipe: string, areaId = "living_room") => cells.find((c) => c.recipe === recipe && c.areaId === areaId)!;
const houseCell = (cells: RecipeCell[], recipe: string) => cells.find((c) => c.recipe === recipe)!;
const autoInput = (c: RecipeCell): Record<string, unknown> =>
  (c.inputs.find((i) => i.kind === "automation")!.fields!.use_blueprint as { input: Record<string, unknown> }).input;
const scriptInput = (c: RecipeCell): Record<string, unknown> =>
  (c.inputs.find((i) => i.kind === "script")!.fields!.use_blueprint as { input: Record<string, unknown> }).input;
const kinds = (c: RecipeCell) => c.inputs.map((i) => `${i.kind}:${i.op}${i.kind === "helper" ? `:${String(i.fields?.entity_id ?? i.targetId)}` : ""}`);

let nextId = 1;
const queued = (input: ChangeInput): Change => ({
  id: nextId++,
  kind: input.kind,
  op: input.op,
  targetId: input.targetId ?? String(input.fields?.entity_id ?? input.fields?.automation_id ?? input.fields?.script_id ?? ""),
  scope: null,
  before: {},
  after: input.fields ?? {},
  createdAt: "",
});

const leak = { id: "binary_sensor.living_water", dc: "moisture", name: "Living water" };
const toggle = { id: "input_boolean.living_paused", platform: "input_boolean", state: "off" };
const cover = { id: "cover.living_blind" };
const window = { id: "binary_sensor.living_window", dc: "window" };
const pir = { id: "binary_sensor.living_pir", dc: "motion" };
const occupied = { id: "binary_sensor.living_occupied", platform: "template", dc: "occupancy", entry: "OCC1" };
const kitchenOccupied = { id: "binary_sensor.kitchen_occupied", platform: "template", dc: "occupancy", entry: "OCC2", area: "kitchen" };

const BLUEPRINTS_THERE = (...recipes: Parameters<typeof blueprintForRecipe>[0][]) =>
  Object.fromEntries(recipes.map((r) => [blueprintForRecipe(r).path, blueprintForRecipe(r).version]));

describe("names of the house recipes", () => {
  it("lists the five house recipes with their labels, and nothing else is a house recipe", () => {
    expect(planHouse([]).map((c) => c.recipe)).toEqual(["announce", "goodbye", "house_presence", "battery_low", "unavailable_watch"]);
    expect(planHouse([]).map((c) => RECIPE_LABEL[c.recipe])).toEqual(["Announce", "Goodbye", "House presence", "Low batteries", "Not reporting"]);
    expect(["leak_alert", "covers_sun", "occupancy"].some(isHouseRecipe)).toBe(false);
    for (const c of planHouse([])) expect([c.areaId, c.areaName]).toEqual(["", "House"]);
    expect(automationIdFor("battery_low", HOUSE_AUTOMATION_CODE)).toBe("taxis_battery_low_house");
    expect(automationAlias("House", "battery_low")).toBe("House – Low batteries (Taxis)");
  });
});

describe("leak alert", () => {
  it("needs a counted leak sensor", () => {
    expect(area(planAreas([]), "leak_alert")).toMatchObject({
      status: "missing",
      missing: ["A leak (moisture) sensor that counts (Capabilities)"],
      actionable: false,
      inputs: [],
    });
  });

  it("is ready with a moisture sensor: blueprint, pause switch, automation, with the sensors, the repeat and the area name", () => {
    const c = area(planAreas([leak]), "leak_alert");
    expect(c.status).toBe("ready");
    expect(kinds(c)).toEqual(["blueprint:create", "helper:create:input_boolean.living_paused", "automation:create"]);
    expect(c.inputs[0].fields).toEqual({ path: "taxis/leak_alert.yaml", version: 1 });
    expect(autoInput(c)).toEqual({
      leak_entities: ["binary_sensor.living_water"],
      notify_targets: [],
      repeat_minutes: 10,
      area_name: "Living room",
      pause_switch: "input_boolean.living_paused",
    });
    expect(c.inputs.at(-1)!.fields).toMatchObject({
      automation_id: "taxis_leak_alert_living",
      recipe: "leak_alert",
      area_id: "living_room",
      alias: "Living room – Leak alert (Taxis)",
    });
    expect(c.notes.join(" ")).toMatch(/No notify services/);
    expect(c.notes.join(" ")).toMatch(/No water valve/);
  });

  it("counts a moisture sensor only while it counts, and never turns a light on (no light is in its inputs)", () => {
    const h = house([leak]);
    const off = setCounts(h, EMPTY_INVENTORY, "binary_sensor.living_water", false);
    expect(area(planAreas([leak], { inv: off }), "leak_alert").status).toBe("missing");
    expect(JSON.stringify(autoInput(area(planAreas([leak]), "leak_alert")))).not.toMatch(/light\./);
  });

  it("passes on the house valve and notify services, which are one value for the whole house", () => {
    const valve = { id: "valve.main_water", area: "" };
    let params = setParameter(EMPTY_PARAMETERS, { level: "house" }, "leak_valve_entity", "valve.main_water");
    params = setParameter(params, { level: "house" }, "notify_targets", ["notify.mobile_app_phone"]);
    params = setParameter(params, { level: "house" }, "leak_repeat", 0);
    const c = area(planAreas([leak, valve], { params }), "leak_alert");
    expect(c.status).toBe("ready");
    expect(autoInput(c)).toMatchObject({ valve_entity: "valve.main_water", notify_targets: ["notify.mobile_app_phone"], repeat_minutes: 0 });
    expect(c.notes.join(" ")).not.toMatch(/No water valve|No notify/);
    // A switch can shut the water too.
    const sw = setParameter(EMPTY_PARAMETERS, { level: "house" }, "leak_valve_entity", "switch.water_shutoff");
    expect(autoInput(area(planAreas([leak, { id: "switch.water_shutoff", area: "" }], { params: sw }), "leak_alert"))).toMatchObject({
      valve_entity: "switch.water_shutoff",
    });
  });

  it("is missing when the chosen valve isn't in Home Assistant", () => {
    const params = setParameter(EMPTY_PARAMETERS, { level: "house" }, "leak_valve_entity", "valve.gone");
    expect(area(planAreas([leak], { params }), "leak_alert").missing).toEqual(["The water valve “valve.gone” isn't in Home Assistant (Parameters, Safety)"]);
  });

  it("is installed when it matches, out of date when the repeat or the sensors changed, and in changes once queued", () => {
    const ready = area(planAreas([leak, toggle]), "leak_alert");
    expect(ready.status).toBe("ready");
    const input = autoInput(ready);
    const installed = {
      blueprints: BLUEPRINTS_THERE("leak_alert"),
      automations: { taxis_leak_alert_living: { alias: "Living room – Leak alert (Taxis)", path: "taxis/leak_alert.yaml", input } },
    };
    expect(area(planAreas([leak, toggle], { installed }), "leak_alert").status).toBe("installed");
    const params = setParameter(EMPTY_PARAMETERS, { level: "house" }, "leak_repeat", 5);
    const stale = area(planAreas([leak, toggle], { installed, params }), "leak_alert");
    expect(stale.status).toBe("out-of-date");
    expect(stale.reasons).toEqual(["Repeat every (min): 10 → 5"]);
    expect(stale.actionable).toBe(true);
    const inChanges = area(planAreas([leak, toggle], { installed, changes: [queued(stale.inputs.at(-1)!)] }), "leak_alert");
    expect(inChanges.status).toBe("in-changes");
  });
});

describe("covers and sun", () => {
  it("needs a counted cover", () => {
    expect(area(planAreas([]), "covers_sun")).toMatchObject({ status: "missing", missing: ["A cover that counts (Capabilities)"] });
  });

  it("is ready with a cover: defaults, windows block, sunrise offset in seconds, times with seconds", () => {
    const c = area(planAreas([cover, window]), "covers_sun");
    expect(c.status).toBe("ready");
    expect(kinds(c)).toEqual(["blueprint:create", "helper:create:input_boolean.living_paused", "automation:create"]);
    expect(autoInput(c)).toEqual({
      cover_entities: ["cover.living_blind"],
      window_entities: ["binary_sensor.living_window"],
      sun_elevation: 25,
      facing_from: 0,
      facing_to: 360,
      temperature_above: 24,
      window_start: "10:00:00",
      window_end: "20:00:00",
      open_time: "08:00:00",
      open_at_sunrise: false,
      sunrise_offset: 1800,
      pause_switch: "input_boolean.living_paused",
    });
    expect(c.notes.join(" ")).toMatch(/No outdoor temperature sensor/);
  });

  it("passes the outdoor temperature sensor of the house, and leaves windows out when they don't block", () => {
    let params = setParameter(EMPTY_PARAMETERS, { level: "house" }, "outdoor_temperature_entity", "sensor.garden_temp");
    params = setParameter(params, { level: "house" }, "covers_block_if_window_open", false);
    params = setParameter(params, { level: "area", id: "living_room" }, "covers_open_at_sunrise", true);
    params = setParameter(params, { level: "area", id: "living_room" }, "covers_sun_elevation", 40);
    params = setParameter(params, { level: "area", id: "living_room" }, "covers_facing_from", 135);
    params = setParameter(params, { level: "area", id: "living_room" }, "covers_facing_to", 225);
    const c = area(planAreas([cover, window, { id: "sensor.garden_temp", dc: "temperature", area: "" }], { params }), "covers_sun");
    expect(autoInput(c)).toMatchObject({
      temperature_entity: "sensor.garden_temp",
      window_entities: [],
      open_at_sunrise: true,
      sun_elevation: 40,
      facing_from: 135,
      facing_to: 225,
    });
    expect(c.notes.join(" ")).not.toMatch(/No outdoor temperature/);
    // The kitchen has no cover and keeps the default elevation.
    expect(area(planAreas([cover], { params }), "covers_sun", "kitchen").status).toBe("missing");
  });

  it("is missing when the window of time is backwards or the outdoor sensor is gone", () => {
    let params = setParameter(EMPTY_PARAMETERS, { level: "house" }, "covers_window_start", "21:00");
    expect(area(planAreas([cover], { params }), "covers_sun").missing).toEqual(["Close from is not before Close until (Parameters, Covers)"]);
    params = setParameter(EMPTY_PARAMETERS, { level: "house" }, "outdoor_temperature_entity", "sensor.gone");
    expect(area(planAreas([cover], { params }), "covers_sun").missing).toEqual([
      "The outdoor temperature sensor “sensor.gone” isn't in Home Assistant (Parameters, House)",
    ]);
  });
});

describe("low batteries", () => {
  it("is ready from the start: the blueprint, the house pause switch and the automation", () => {
    const c = houseCell(planHouse([]), "battery_low");
    expect(c.status).toBe("ready");
    expect(kinds(c)).toEqual(["blueprint:create", `helper:create:${HOUSE_PAUSE_ID}`, "automation:create"]);
    expect(c.inputs[1].fields).not.toHaveProperty("area_id");
    expect(autoInput(c)).toEqual({ threshold: 15, report_time: "09:00:00", notify_targets: [], pause_switch: HOUSE_PAUSE_ID });
    const last = c.inputs.at(-1)!;
    expect(last.fields).toMatchObject({ automation_id: "taxis_battery_low_house", recipe: "battery_low", alias: "House – Low batteries (Taxis)" });
    expect(last.fields).not.toHaveProperty("area_id");
    expect(c.notes.join(" ")).toMatch(/No notify services/);
  });

  it("takes the level, the time and the notify services of the house", () => {
    let params = setParameter(EMPTY_PARAMETERS, { level: "house" }, "battery_threshold", 20);
    params = setParameter(params, { level: "house" }, "battery_report_time", "07:30");
    params = setParameter(params, { level: "house" }, "notify_targets", ["notify.mobile_app_phone"]);
    expect(autoInput(houseCell(planHouse([], { params }), "battery_low"))).toEqual({
      threshold: 20,
      report_time: "07:30:00",
      notify_targets: ["notify.mobile_app_phone"],
      pause_switch: HOUSE_PAUSE_ID,
    });
  });

  it("is missing when something else holds the pause switch, and doesn't make the switch twice once it is there or queued", () => {
    const taken = houseCell(planHouse([{ id: HOUSE_PAUSE_ID, platform: "demo", area: "" }]), "battery_low");
    expect(taken.status).toBe("missing");
    expect(taken.missing[0]).toMatch(/input_boolean.taxis_paused is already used/);
    const there = houseCell(planHouse([{ id: HOUSE_PAUSE_ID, platform: "input_boolean", state: "off", area: "" }]), "battery_low");
    expect(kinds(there)).toEqual(["blueprint:create", "automation:create"]);
    const first = houseCell(planHouse([]), "battery_low").inputs[1];
    expect(kinds(houseCell(planHouse([], { changes: [queued(first)] }), "battery_low"))).toEqual(["blueprint:create", "automation:create"]);
  });

  it("is installed when it matches and out of date when the level changed or the blueprint is older", () => {
    const base = houseCell(planHouse([{ id: HOUSE_PAUSE_ID, platform: "input_boolean", state: "off", area: "" }]), "battery_low");
    const installed = {
      blueprints: BLUEPRINTS_THERE("battery_low"),
      automations: { taxis_battery_low_house: { alias: "House – Low batteries (Taxis)", path: "taxis/battery_low.yaml", input: autoInput(base) } },
    };
    const pause = { id: HOUSE_PAUSE_ID, platform: "input_boolean", state: "off", area: "" };
    expect(houseCell(planHouse([pause], { installed }), "battery_low").status).toBe("installed");
    const params = setParameter(EMPTY_PARAMETERS, { level: "house" }, "battery_threshold", 10);
    const stale = houseCell(planHouse([pause], { installed, params }), "battery_low");
    expect(stale).toMatchObject({ status: "out-of-date", reasons: ["Battery low below (%): 15 → 10"] });
    const older = houseCell(planHouse([pause], { installed: { ...installed, blueprints: { "taxis/battery_low.yaml": 0 } } }), "battery_low");
    expect(older.reasons).toEqual(["The blueprint is version 0, Taxis has 1"]);
    // The pause switch gone while the automation is there is reported.
    expect(houseCell(planHouse([], { installed }), "battery_low").reasons).toEqual([`${HOUSE_PAUSE_ID} is missing`]);
  });
});

describe("not reporting", () => {
  it("is missing with no counted sensor", () => {
    expect(houseCell(planHouse([]), "unavailable_watch")).toMatchObject({ status: "missing", missing: ["A sensor that counts in an area (Capabilities)"] });
  });

  it("watches the counted sensors of every area, once, sorted: motion, doors, windows, leaks, thermostats, appliances, but not lights or the sensors that don't count", () => {
    const specs = [
      pir,
      window,
      leak,
      { id: "climate.kitchen_trv", area: "kitchen" },
      { id: "sensor.kitchen_oven_power", dc: "power", area: "kitchen", state: "0" },
      { id: "sensor.kitchen_fridge_power", dc: "power", area: "kitchen", state: "80" },
      { id: "light.living_spots" },
      { id: "binary_sensor.kitchen_door", dc: "door", area: "kitchen" },
    ];
    const h = house(specs);
    // Only a power sensor marked as an appliance counts for this.
    const inv: InventorySettings = {
      entities: { "sensor.kitchen_oven_power": { appliance: true }, "binary_sensor.kitchen_door": { counts: false } },
      areas: {},
    };
    void h;
    const c = houseCell(planHouse(specs, { inv }), "unavailable_watch");
    expect(c.status).toBe("ready");
    expect(autoInput(c).watch_entities).toEqual([
      "binary_sensor.living_pir",
      "binary_sensor.living_water",
      "binary_sensor.living_window",
      "climate.kitchen_trv",
      "sensor.kitchen_oven_power",
    ]);
    expect(autoInput(c)).toMatchObject({ unavailable_minutes: 60, notify_targets: [], pause_switch: HOUSE_PAUSE_ID });
    expect(checkBlueprintInput("taxis/unavailable_watch.yaml", autoInput(c), (v) => typeof v === "string" && ENTITY_ID_RE.test(v))).toBeNull();
  });

  it("says what changed in the list instead of printing it", () => {
    const pause = { id: HOUSE_PAUSE_ID, platform: "input_boolean", state: "off", area: "" };
    const before = houseCell(planHouse([pir, pause]), "unavailable_watch");
    const installed = {
      blueprints: BLUEPRINTS_THERE("unavailable_watch"),
      automations: {
        taxis_unavailable_watch_house: { alias: "House – Not reporting (Taxis)", path: "taxis/unavailable_watch.yaml", input: autoInput(before) },
      },
    };
    expect(houseCell(planHouse([pir, pause], { installed }), "unavailable_watch").status).toBe("installed");
    const more = houseCell(planHouse([pir, window, pause], { installed }), "unavailable_watch");
    expect(more).toMatchObject({ status: "out-of-date", reasons: ["Watched entities: 1 added, 0 no longer counted"] });
    const fewer = houseCell(planHouse([pause], { installed }), "unavailable_watch");
    expect(fewer.status).toBe("missing");
  });
});

describe("house presence", () => {
  const installedOccupancy = (code: string) => ({ [`taxis_occupancy_${code}`]: { alias: "x", path: "taxis/occupancy.yaml", input: {} } });

  it("needs a room with Occupancy", () => {
    const c = houseCell(planHouse([pir]), "house_presence");
    expect(c.status).toBe("missing");
    expect(c.missing).toEqual(["An area with Occupancy installed (Recipes)"]);
  });

  it("makes the group of the occupied sensors, the occupied sensor, the pause and away switches, and the automation", () => {
    const c = houseCell(
      planHouse([pir, occupied, kitchenOccupied], { installed: { automations: { ...installedOccupancy("living"), ...installedOccupancy("kitchen") } } }),
      "house_presence",
    );
    expect(c.status).toBe("ready");
    expect(kinds(c)).toEqual([
      "blueprint:create",
      `helper:create:${HOUSE_PAUSE_ID}`,
      `helper:create:${HOUSE_AWAY_ID}`,
      `helper:create:${HOUSE_AREAS_OCCUPIED_ID}`,
      `helper:create:${HOUSE_OCCUPIED_ID}`,
      "automation:create",
    ]);
    const [, , away, group, sensor] = c.inputs;
    expect(away.fields).not.toHaveProperty("area_id");
    expect(group.fields).toEqual({
      helper: "group",
      group_type: "binary_sensor",
      name: "Taxis areas occupied",
      entity_id: HOUSE_AREAS_OCCUPIED_ID,
      entities: ["binary_sensor.kitchen_occupied", "binary_sensor.living_occupied"],
    });
    expect(sensor.fields).toEqual({
      helper: "template",
      name: "Taxis occupied",
      entity_id: HOUSE_OCCUPIED_ID,
      state_template: HOUSE_OCCUPIED_TEMPLATE,
      device_class: "occupancy",
    });
    expect(autoInput(c)).toEqual({
      occupied_entity: HOUSE_OCCUPIED_ID,
      away_entity: HOUSE_AWAY_ID,
      away_after_minutes: 30,
      end_on_return: false,
      pause_switch: HOUSE_PAUSE_ID,
    });
    expect(c.notes.join(" ")).toMatch(/No guest mode switch/);
    expect(c.notes.join(" ")).toMatch(/no person/);
    // Every change it sends is one Taxis accepts.
    for (const input of c.inputs) expect(validateInput(input), JSON.stringify(input)).toBeNull();
  });

  it("uses the guest switch when one is in place, and the away switch the user picked", () => {
    const guest = { id: "input_boolean.taxis_guest", platform: "input_boolean", state: "off", area: "" };
    const mine = { id: "input_boolean.holiday", platform: "input_boolean", state: "off", area: "" };
    const params = setParameter(EMPTY_PARAMETERS, { level: "house" }, "away_mode_entity", "input_boolean.holiday");
    const c = houseCell(
      planHouse([pir, occupied, guest, mine, { id: "person.ana", area: "", state: "home" }], {
        params,
        installed: { automations: installedOccupancy("living") },
      }),
      "house_presence",
    );
    expect(autoInput(c)).toMatchObject({ away_entity: "input_boolean.holiday", guest_entity: "input_boolean.taxis_guest" });
    expect(c.notes.join(" ")).not.toMatch(/No guest mode switch|no person/);
    expect(kinds(c)).not.toContain(`helper:create:${HOUSE_AWAY_ID}`);
  });

  it("is missing when the away switch the user picked isn't there", () => {
    const params = setParameter(EMPTY_PARAMETERS, { level: "house" }, "away_mode_entity", "input_boolean.gone");
    const c = houseCell(planHouse([pir, occupied], { params, installed: { automations: installedOccupancy("living") } }), "house_presence");
    expect(c.status).toBe("missing");
    expect(c.missing.join(" ")).toMatch(/Away mode/);
  });

  it("updates the members of the group when a room gained Occupancy, and only then", () => {
    const pause = { id: HOUSE_PAUSE_ID, platform: "input_boolean", state: "off", area: "" };
    const away = { id: HOUSE_AWAY_ID, platform: "input_boolean", state: "off", area: "" };
    const sensor = { id: HOUSE_OCCUPIED_ID, platform: "template", dc: "occupancy", entry: "H2", area: "" };
    const group = (members: string[]) => ({ id: HOUSE_AREAS_OCCUPIED_ID, platform: "group", dc: "occupancy", entry: "H1", area: "", members });
    const first = houseCell(
      planHouse([pir, occupied, pause, away, group(["binary_sensor.living_occupied"]), sensor], { installed: { automations: installedOccupancy("living") } }),
      "house_presence",
    );
    expect(first.status).toBe("ready");
    expect(kinds(first)).toEqual(["blueprint:create", "automation:create"]);
    const installed = {
      blueprints: BLUEPRINTS_THERE("house_presence"),
      automations: {
        ...installedOccupancy("living"),
        taxis_house_presence_house: { alias: "House – House presence (Taxis)", path: "taxis/house_presence.yaml", input: autoInput(first) },
      },
    };
    const same = houseCell(planHouse([pir, occupied, pause, away, group(["binary_sensor.living_occupied"]), sensor], { installed }), "house_presence");
    expect(same.status).toBe("installed");
    const grown = houseCell(
      planHouse([pir, occupied, kitchenOccupied, pause, away, group(["binary_sensor.living_occupied"]), sensor], {
        installed: { ...installed, automations: { ...installed.automations, ...installedOccupancy("kitchen") } },
      }),
      "house_presence",
    );
    expect(grown.status).toBe("out-of-date");
    expect(grown.reasons).toEqual(["The areas occupied group has 1 sensors, 2 areas have Occupancy"]);
    const update = grown.inputs.find((i) => i.kind === "helper")!;
    expect(update).toMatchObject({
      op: "update",
      targetId: HOUSE_AREAS_OCCUPIED_ID,
      fields: { entities: ["binary_sensor.kitchen_occupied", "binary_sensor.living_occupied"] },
    });
    expect(validateInput(update)).toBeNull();
  });

  it("takes the time and whether it ends on return from the parameters of the house", () => {
    let params = setParameter(EMPTY_PARAMETERS, { level: "house" }, "everyone_left_minutes", 90);
    params = setParameter(params, { level: "house" }, "away_ends_on_return", true);
    const c = houseCell(planHouse([pir, occupied], { params, installed: { automations: installedOccupancy("living") } }), "house_presence");
    expect(autoInput(c)).toMatchObject({ away_after_minutes: 90, end_on_return: true });
  });
});

describe("goodbye", () => {
  const lightsAll = { id: "light.all", platform: "group", members: ["light.living_spots"], area: "" };

  it("needs the house light group", () => {
    const c = houseCell(planHouse([]), "goodbye");
    expect(c.status).toBe("missing");
    expect(c.missing).toEqual(["The house light group (Helpers tab)"]);
  });

  it("is ready with the house group: the blueprint, the away switch and the script, with the media of every area", () => {
    const specs = [
      lightsAll,
      { id: "light.living_spots" },
      { id: "media_player.living_tv", dc: "tv" },
      { id: "media_player.kitchen_speaker", area: "kitchen" },
    ];
    const c = houseCell(planHouse(specs), "goodbye");
    expect(c.status).toBe("ready");
    expect(kinds(c)).toEqual(["blueprint:create", `helper:create:${HOUSE_AWAY_ID}`, "script:create"]);
    expect(c.inputs[0].fields).toEqual({ path: GOODBYE_PATH, version: 1 });
    expect(scriptInput(c)).toEqual({
      light_target: "light.all",
      media_entities: ["media_player.kitchen_speaker", "media_player.living_tv"],
      away_entity: HOUSE_AWAY_ID,
    });
    expect(c.inputs.at(-1)!.fields).toMatchObject({ script_id: GOODBYE_SCRIPT_ID, alias: "Goodbye (Taxis)", use_blueprint: { path: GOODBYE_PATH } });
    expect(c.notes.join(" ")).toContain("script.taxis_goodbye");
    for (const input of c.inputs) expect(validateInput(input), JSON.stringify(input)).toBeNull();
  });

  it("goes ahead with no media and says so, and accepts a house group that is only queued", () => {
    const c = houseCell(planHouse([]), "goodbye");
    expect(c.status).toBe("missing");
    const queuedGroup = queued({
      kind: "helper",
      op: "create",
      fields: { helper: "group", group_type: "light", name: "House lights", entity_id: "light.all", entities: ["light.living_all"] },
    });
    const ready = houseCell(planHouse([], { changes: [queuedGroup] }), "goodbye");
    expect(ready.status).toBe("ready");
    expect(ready.notes.join(" ")).toMatch(/only the lights go off/);
  });

  it("is missing when the id of the house group or the script is held by something else", () => {
    expect(houseCell(planHouse([{ id: "light.all", platform: "demo", area: "", name: "Lamp" }]), "goodbye").missing).toEqual([
      "light.all is already used by “Lamp”",
    ]);
    const c = houseCell(planHouse([lightsAll, { id: "script.taxis_goodbye", platform: "script", area: "", name: "My goodbye" }]), "goodbye");
    expect(c.missing).toEqual(["script.taxis_goodbye is already used by “My goodbye”, which Taxis didn't make or can't edit"]);
  });

  it("is installed when it matches, out of date when a media player is added", () => {
    const specs = [lightsAll, { id: "light.living_spots" }, { id: "input_boolean.taxis_away", platform: "input_boolean", state: "off", area: "" }];
    const ready = houseCell(planHouse(specs), "goodbye");
    const installed = {
      blueprints: BLUEPRINTS_THERE("goodbye"),
      scripts: { [GOODBYE_SCRIPT_ID]: { alias: "Goodbye (Taxis)", path: GOODBYE_PATH, input: scriptInput(ready) } },
    };
    expect(houseCell(planHouse(specs, { installed }), "goodbye").status).toBe("installed");
    const more = houseCell(planHouse([...specs, { id: "media_player.living_tv", dc: "tv" }], { installed }), "goodbye");
    expect(more.status).toBe("out-of-date");
    expect(more.reasons).toEqual(["Media players: none → media_player.living_tv"]);
    const queuedScript = houseCell(planHouse(specs, { installed, changes: [queued(ready.inputs.at(-1)!)] }), "goodbye");
    expect(queuedScript.status).toBe("in-changes");
  });
});

describe("every change a house or new area recipe sends is one Taxis accepts", () => {
  it("passes the validation of the change list and the blueprint input check", () => {
    const specs = [
      pir,
      occupied,
      leak,
      cover,
      window,
      toggle,
      { id: "light.all", platform: "group", members: ["light.living_spots"], area: "" },
      { id: "light.living_spots" },
      { id: "person.ana", area: "", state: "home" },
    ];
    const installed = { automations: { taxis_occupancy_living: { alias: "x", path: "taxis/occupancy.yaml", input: {} } } };
    const cells = [...planAreas(specs, { installed }), ...planHouse(specs, { installed })];
    const sent = recipeChangeInputs(
      cells.filter((c) => c.actionable && ["leak_alert", "covers_sun", "goodbye", "house_presence", "battery_low", "unavailable_watch"].includes(c.recipe)),
    );
    expect(sent.length).toBeGreaterThan(10);
    for (const input of sent) expect(validateInput(input), JSON.stringify(input)).toBeNull();
    // The shared pieces are sent once: one pause switch, one away switch, one house group.
    const ids = sent.filter((i) => i.kind === "helper" && i.op === "create").map((i) => String(i.fields!.entity_id));
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain(HOUSE_PAUSE_ID);
  });

  it("refuses a house recipe with an area, a script as an automation, and the wrong blueprint for a script", () => {
    const fields = {
      automation_id: "taxis_battery_low_house",
      recipe: "battery_low",
      alias: "x",
      use_blueprint: { path: "taxis/battery_low.yaml", input: { threshold: 15, report_time: "09:00:00", notify_targets: [], pause_switch: HOUSE_PAUSE_ID } },
    };
    expect(validateInput({ kind: "automation", op: "create", fields })).toBeNull();
    expect(validateInput({ kind: "automation", op: "create", fields: { ...fields, area_id: "kitchen" } })).toBe("A house recipe belongs to no area.");
    expect(validateInput({ kind: "automation", op: "create", fields: { ...fields, automation_id: "taxis_battery_low" } })).toMatch(
      /taxis_<recipe>_<area code>/,
    );
    expect(validateInput({ kind: "automation", op: "create", fields: { ...fields, recipe: "goodbye", automation_id: "taxis_goodbye_house" } })).toMatch(
      /a script, not an automation/,
    );
    // A cover recipe is still for an area.
    const { area_id: _none, ...noArea } = {
      ...fields,
      recipe: "leak_alert",
      automation_id: "taxis_leak_alert_kitchen",
      use_blueprint: { path: "taxis/leak_alert.yaml", input: { leak_entities: ["binary_sensor.kitchen_water"], pause_switch: "input_boolean.kitchen_paused" } },
    } as Record<string, unknown>;
    expect(validateInput({ kind: "automation", op: "create", fields: noArea })).toMatch(/needs area id/);
    // The two scripts: each with its own blueprint.
    const script = {
      script_id: "taxis_goodbye",
      alias: "Goodbye (Taxis)",
      use_blueprint: { path: GOODBYE_PATH, input: { light_target: "light.all", media_entities: [], away_entity: HOUSE_AWAY_ID } },
    };
    expect(validateInput({ kind: "script", op: "create", fields: script })).toBeNull();
    expect(
      validateInput({
        kind: "script",
        op: "create",
        fields: { ...script, use_blueprint: { path: "taxis/announce.yaml", input: { areas: [], tts_entity: "tts.home" } } },
      }),
    ).toBe("That script uses another blueprint.");
    expect(validateInput({ kind: "script", op: "create", fields: { ...script, script_id: "taxis_other" } })).toMatch(/script_id/);
  });

  it("lets the house occupied group and sensor have no area, and only with their own template", () => {
    const group = {
      helper: "group",
      group_type: "binary_sensor",
      name: "Taxis areas occupied",
      entity_id: HOUSE_AREAS_OCCUPIED_ID,
      entities: ["binary_sensor.living_occupied"],
    };
    expect(validateInput({ kind: "helper", op: "create", fields: group })).toBeNull();
    expect(validateInput({ kind: "helper", op: "create", fields: { ...group, area_id: "kitchen" } })).toMatch(/have no area/);
    // A group of binary sensors for any other id still needs an area.
    expect(validateInput({ kind: "helper", op: "create", fields: { ...group, entity_id: "binary_sensor.other_all" } })).toBe("A new helper needs an area.");
    const sensor = {
      helper: "template",
      name: "Taxis occupied",
      entity_id: HOUSE_OCCUPIED_ID,
      state_template: HOUSE_OCCUPIED_TEMPLATE,
      device_class: "occupancy",
    };
    expect(validateInput({ kind: "helper", op: "create", fields: sensor })).toBeNull();
    expect(validateInput({ kind: "helper", op: "create", fields: { ...sensor, state_template: "{{ true }}" } })).toMatch(/wouldn't accept/);
    expect(validateInput({ kind: "helper", op: "create", fields: { ...sensor, entity_id: "binary_sensor.living_occupied", area_id: "living_room" } })).toBe(
      "The house occupied sensor and its template go together.",
    );
    expect(validateInput({ kind: "helper", op: "create", fields: { ...sensor, area_id: "kitchen" } })).toMatch(/have no area/);
    // The pause switch has no area either.
    const pause = { helper: "input_boolean", name: "Taxis house automations paused", entity_id: HOUSE_PAUSE_ID, icon: "mdi:pause-circle-outline" };
    expect(validateInput({ kind: "helper", op: "create", fields: pause })).toBeNull();
    expect(validateInput({ kind: "helper", op: "create", fields: { ...pause, area_id: "kitchen" } })).toMatch(/have no area/);
  });

  it("checks every house blueprint input in the registry's own words", () => {
    const ok = (v: unknown) => typeof v === "string" && ENTITY_ID_RE.test(v);
    expect(checkBlueprintInput("taxis/goodbye.yaml", { light_target: "light.all", media_entities: [], away_entity: HOUSE_AWAY_ID }, ok)).toBeNull();
    expect(checkBlueprintInput("taxis/goodbye.yaml", { light_target: "switch.all", media_entities: [], away_entity: HOUSE_AWAY_ID }, ok)).toMatch(
      /light_target/,
    );
  });
});
