import { describe, expect, it } from "vitest";

import { buildHierarchy, type RawRegistry } from "../server/model/hierarchy.ts";
import { BLUEPRINTS, blueprintForRecipe } from "./blueprints.ts";
import { validateInput } from "./changes.ts";
import { RECIPE_HELPER_SUFFIX, helperExclusions, helperNameErrors } from "./helpers.ts";
import { EMPTY_INVENTORY, setBed, setBedroom, setCounts, setLightRole, setRole, type InventorySettings } from "./inventory.ts";
import { DEFAULT_NAMING, type NamingSettings } from "./naming.ts";
import { EMPTY_PARAMETERS, setParameter, type ParameterSettings } from "./parameters.ts";
import {
  NOTHING_INSTALLED,
  automationAlias,
  automationIdFor,
  planRecipes,
  recipeChangeInputs,
  runtimeIds,
  type RecipeCell,
  type RecipeInstalled,
} from "./recipes.ts";
import type { Change, ChangeInput } from "./types.ts";

type Spec = { id: string; state?: string; dc?: string; platform?: string; area?: string; entry?: string; name?: string; members?: string[] };

// A small invented house: a living room and a kitchen, with the codes their
// entity ids use.
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
    reg.entities.push({ entity_id: s.id, platform: s.platform ?? "demo", area_id: s.area ?? "living_room", config_entry_id: s.entry, original_name: s.name, unique_id: s.id.split(".")[1] });
    reg.states.push({ entity_id: s.id, state: s.state ?? "off", attributes: { friendly_name: s.name ?? s.id.split(".")[1].replace(/_/g, " "), device_class: s.dc, entity_id: s.members } });
  }
  return buildHierarchy(reg, "now");
}

const naming: NamingSettings = { ...DEFAULT_NAMING, areaCodes: { living_room: "living", kitchen: "kitchen" } };

const motion = { id: "binary_sensor.living_pir", dc: "motion" };
const presence = { id: "binary_sensor.living_mmwave", dc: "occupancy" };
const lights = { id: "light.living_all", platform: "group", members: ["light.living_spots"], name: "Living room lights" };
const spots = { id: "light.living_spots" };
const luxMean = { id: "sensor.living_illuminance", platform: "min_max", dc: "illuminance", state: "80", entry: "LUX1" };
const timer = { id: "timer.living_hold", platform: "timer", state: "idle" };
const toggle = { id: "input_boolean.living_paused", platform: "input_boolean", state: "off" };
const occupied = { id: "binary_sensor.living_occupied", platform: "template", dc: "occupancy", entry: "OCC1" };
const overrideTimer = { id: "timer.living_override", platform: "timer", state: "idle" };
const runtime = [timer, toggle, occupied, overrideTimer];
const tv = { id: "media_player.living_tv", dc: "tv", state: "playing" };
const speaker = { id: "media_player.living_speaker", state: "idle" };
const mediaGroup = { id: "media_player.living_media", platform: "group", members: ["media_player.living_tv", "media_player.living_speaker"], name: "Living room media" };

type Opts = { inv?: InventorySettings; params?: ParameterSettings; installed?: Partial<RecipeInstalled>; changes?: Change[]; naming?: NamingSettings };
const plan = (specs: Spec[], o: Opts = {}) =>
  planRecipes(house(specs), o.inv ?? EMPTY_INVENTORY, o.naming ?? naming, o.params ?? EMPTY_PARAMETERS, { ...NOTHING_INSTALLED, ...o.installed }, o.changes ?? []);

const cell = (cells: RecipeCell[], recipe: string, area = "living_room") => cells.find((c) => c.recipe === recipe && c.areaId === area)!;

// The blueprint inputs a cell's automation would be written with.
const autoInput = (c: RecipeCell): Record<string, unknown> => (c.inputs.find((i) => i.kind === "automation")!.fields!.use_blueprint as { input: Record<string, unknown> }).input;

let nextId = 1;
const change = (c: Partial<Change> & Pick<Change, "kind" | "targetId" | "after">): Change => ({ id: nextId++, op: "create", scope: null, before: {}, createdAt: "", ...c });

const OCC = blueprintForRecipe("occupancy");
const MOT = blueprintForRecipe("motion_lights");
const MEDIA = blueprintForRecipe("media_off");
const BLUEPRINTS_THERE = { [OCC.path]: OCC.version, [MOT.path]: MOT.version, [MEDIA.path]: MEDIA.version };

// What Taxis would write for the living room with the defaults.
const occupancyInput = {
  starts_entities: ["binary_sensor.living_pir"],
  holds_entities: [],
  bed_entities: [],
  occupied_entity: "binary_sensor.living_occupied",
  hold_timer: "timer.living_hold",
  hold_minutes: 5,
  extended_after: 30,
  extended_hold: 15,
  sleep_hold: 60,
  pause_switch: "input_boolean.living_paused",
};
const installedOccupancy = { alias: "Living room – Occupancy (Taxis)", path: OCC.path, input: occupancyInput };

describe("names", () => {
  it("builds the ids and the alias", () => {
    expect(runtimeIds("living")).toEqual({
      timer: "timer.living_hold",
      occupied: "binary_sensor.living_occupied",
      switch: "input_boolean.living_paused",
      override: "timer.living_override",
    });
    expect(automationIdFor("motion_lights", "living")).toBe("taxis_motion_lights_living");
    expect(automationIdFor("media_off", "living")).toBe("taxis_media_off_living");
    expect(automationAlias("Living room", "occupancy")).toBe("Living room – Occupancy (Taxis)");
    expect(automationAlias("Kitchen", "motion_lights")).toBe("Kitchen – Motion lights (Taxis)");
    expect(automationAlias("Kitchen", "media_off")).toBe("Kitchen – Media off (Taxis)");
  });
});

describe("occupancy: what is missing", () => {
  it("needs a counted motion or presence sensor", () => {
    const c = cell(plan([spots]), "occupancy");
    expect(c).toMatchObject({ status: "missing", missing: ["A motion or presence sensor"], actionable: false, inputs: [] });
  });

  it("needs one that starts occupancy: sensors set to hold don't", () => {
    const h = house([motion]);
    const inv = setRole(h, EMPTY_INVENTORY, "binary_sensor.living_pir", "holds");
    const c = cell(plan([motion], { inv }), "occupancy");
    expect(c.status).toBe("missing");
    expect(c.missing[0]).toMatch(/starts occupancy.*set to hold/);
  });

  it("doesn't count a sensor that is switched off", () => {
    const h = house([motion]);
    const inv = setCounts(h, EMPTY_INVENTORY, "binary_sensor.living_pir", false);
    expect(cell(plan([motion], { inv }), "occupancy").missing).toEqual(["A motion or presence sensor"]);
  });

  it("names a helper id that something else holds", () => {
    const c = cell(plan([motion, { id: "timer.living_hold", platform: "demo", name: "Old timer" }]), "occupancy");
    expect(c.status).toBe("missing");
    expect(c.missing).toEqual(["timer.living_hold is already used by “Old timer”"]);
    // A real motion sensor can't sit on the occupied id either, and a template made in YAML isn't ours to edit.
    expect(cell(plan([motion, { id: "binary_sensor.living_occupied", platform: "template", dc: "occupancy" }]), "occupancy").missing[0]).toMatch(/binary_sensor.living_occupied is already used/);
    expect(cell(plan([motion, { id: "input_boolean.living_paused", platform: "demo" }]), "occupancy").missing[0]).toMatch(/input_boolean.living_paused is already used/);
  });

  it("every area has a cell for each recipe, and the kitchen is judged on its own", () => {
    const cells = plan([motion, { ...spots, area: "kitchen" }]);
    expect(cells.map((c) => `${c.areaId}:${c.recipe}`)).toEqual([
      "living_room:occupancy",
      "living_room:motion_lights",
      "living_room:media_off",
      "kitchen:occupancy",
      "kitchen:motion_lights",
      "kitchen:media_off",
    ]);
    expect(cell(cells, "occupancy", "living_room").status).toBe("ready");
    expect(cell(cells, "occupancy", "kitchen").status).toBe("missing");
  });
});

describe("occupancy: ready", () => {
  const c = cell(plan([motion, presence, spots]), "occupancy");

  it("is ready with sources that start and hold, and says what it will write, in order", () => {
    expect(c.status).toBe("ready");
    expect(c.actionable).toBe(true);
    expect(c.inputs.map((i) => `${i.kind}:${i.op}:${i.fields?.helper ?? i.fields?.path ?? i.fields?.automation_id}`)).toEqual([
      "blueprint:create:taxis/occupancy.yaml",
      "helper:create:timer",
      "helper:create:input_boolean",
      "helper:create:template",
      "automation:create:taxis_occupancy_living",
    ]);
  });

  it("splits the sensors by role: the motion sensor starts, the presence sensor next to it holds", () => {
    const auto = c.inputs.find((i) => i.kind === "automation")!.fields as { use_blueprint: { path: string; input: Record<string, unknown> }; alias: string; area_id: string; recipe: string };
    expect(auto.use_blueprint).toEqual({
      path: "taxis/occupancy.yaml",
      input: { ...occupancyInput, holds_entities: ["binary_sensor.living_mmwave"] },
    });
    expect(auto).toMatchObject({ alias: "Living room – Occupancy (Taxis)", area_id: "living_room", recipe: "occupancy" });
  });

  it("makes the helpers with the names, ids, area and parameters the design says", () => {
    const fieldsOf = (helper: string) => c.inputs.find((i) => i.fields?.helper === helper)!.fields;
    expect(fieldsOf("timer")).toEqual({ helper: "timer", name: "Living room hold", entity_id: "timer.living_hold", area_id: "living_room", duration: 300 });
    expect(fieldsOf("input_boolean")).toEqual({ helper: "input_boolean", name: "Living room automations paused", entity_id: "input_boolean.living_paused", area_id: "living_room", icon: "mdi:pause-circle-outline" });
    expect(fieldsOf("template")).toEqual({
      helper: "template",
      name: "Living room occupied",
      entity_id: "binary_sensor.living_occupied",
      area_id: "living_room",
      state_template: "{{ is_state('timer.living_hold','active') }}",
      device_class: "occupancy",
    });
  });

  it("uses the resolved hold timeout: area over floor over house", () => {
    let p = setParameter(EMPTY_PARAMETERS, { level: "house" }, "hold_timeout", 9);
    p = setParameter(p, { level: "area", id: "living_room" }, "hold_timeout", 12);
    const mine = cell(plan([motion, { ...motion, id: "binary_sensor.kitchen_pir", area: "kitchen" }], { params: p }), "occupancy");
    const kitchen = cell(plan([motion, { ...motion, id: "binary_sensor.kitchen_pir", area: "kitchen" }], { params: p }), "occupancy", "kitchen");
    expect(mine.inputs.find((i) => i.fields?.helper === "timer")!.fields!.duration).toBe(720);
    expect(kitchen.inputs.find((i) => i.fields?.helper === "timer")!.fields!.duration).toBe(540);
  });

  it("passes the extended and sleep times from the parameters, with the occupied sensor the extended time is read from", () => {
    let p = setParameter(EMPTY_PARAMETERS, { level: "house" }, "extended_after", 45);
    p = setParameter(p, { level: "area", id: "living_room" }, "sleep_hold", 90);
    p = setParameter(p, { level: "floor", id: "ground" }, "extended_hold", 20);
    expect(autoInput(cell(plan([motion, spots], { params: p }), "occupancy"))).toMatchObject({
      occupied_entity: "binary_sensor.living_occupied",
      extended_after: 45,
      extended_hold: 20,
      sleep_hold: 90,
      hold_minutes: 5,
    });
    // The hold timer stays as long as the hold timeout, not the longer ones.
    expect(cell(plan([motion, spots], { params: p }), "occupancy").inputs.find((i) => i.fields?.helper === "timer")!.fields!.duration).toBe(300);
  });

  it("gives the bed sensors of a bedroom, and only those that count", () => {
    const bed = { id: "binary_sensor.living_bed", dc: "occupancy" };
    const specs = [motion, bed, spots];
    const h = house(specs);
    // The role is the area's own: a bed sensor in an area that isn't a bedroom is just a presence sensor.
    let inv = setBed(EMPTY_INVENTORY, bed.id, true);
    expect(autoInput(cell(plan(specs, { inv }), "occupancy")).bed_entities).toEqual([]);
    inv = setBedroom(inv, "living_room", true);
    const c = cell(plan(specs, { inv }), "occupancy");
    expect(autoInput(c).bed_entities).toEqual(["binary_sensor.living_bed"]);
    // It is a presence sensor like the others: next to a motion sensor it holds.
    expect(autoInput(c)).toMatchObject({ starts_entities: ["binary_sensor.living_pir"], holds_entities: ["binary_sensor.living_bed"] });
    expect(autoInput(cell(plan(specs, { inv: setCounts(h, inv, bed.id, false) }), "occupancy")).bed_entities).toEqual([]);
    // A presence sensor that isn't marked as a bed stays out.
    expect(autoInput(cell(plan([motion, presence, spots], { inv: setBedroom(EMPTY_INVENTORY, "living_room", true) }), "occupancy")).bed_entities).toEqual([]);
  });

  it("all of it passes the change list's own checks", () => {
    for (const input of c.inputs) expect(validateInput(input), `${input.kind} ${JSON.stringify(input.fields).slice(0, 60)}`).toBeNull();
    const bed = { id: "binary_sensor.living_bed", dc: "occupancy" };
    const withBed = cell(plan([motion, bed, spots], { inv: setBedroom(setBed(EMPTY_INVENTORY, bed.id, true), "living_room", true) }), "occupancy");
    for (const input of withBed.inputs) expect(validateInput(input)).toBeNull();
  });

  it("skips what the change list already holds", () => {
    const pending = [
      change({ kind: "helper", targetId: "timer.living_hold", after: { helper: "timer", entity_id: "timer.living_hold" } }),
      change({ kind: "blueprint", targetId: OCC.path, after: { path: OCC.path, version: OCC.version } }),
    ];
    const again = cell(plan([motion, presence, spots], { changes: pending }), "occupancy");
    expect(again.status).toBe("ready");
    expect(again.inputs.map((i) => i.kind + ":" + (i.fields?.helper ?? ""))).toEqual(["helper:input_boolean", "helper:template", "automation:"]);
  });

  it("says in changes, and offers nothing, once the automation is in the list", () => {
    const pending = [change({ kind: "automation", targetId: "taxis_occupancy_living", after: {} })];
    expect(cell(plan([motion, spots], { changes: pending }), "occupancy")).toMatchObject({ status: "in-changes", actionable: false, inputs: [] });
  });
});

describe("occupancy: installed and out of date", () => {
  const specs = [motion, spots, ...runtime];
  const installed = { blueprints: BLUEPRINTS_THERE, automations: { taxis_occupancy_living: installedOccupancy }, timers: { "timer.living_hold": 300 } };

  it("is installed when the automation, helpers, timer and blueprint all match", () => {
    expect(cell(plan(specs, { installed }), "occupancy")).toMatchObject({ status: "installed", reasons: [], inputs: [], actionable: false });
  });

  it("is out of date, and says how, when the hold timeout changed: the timer and the automation both follow", () => {
    const p = setParameter(EMPTY_PARAMETERS, { level: "house" }, "hold_timeout", 8);
    const c = cell(plan(specs, { installed, params: p }), "occupancy");
    expect(c.status).toBe("out-of-date");
    expect(c.reasons).toEqual(["Hold timeout (min): 5 → 8", "The hold timer is 5 min, the hold timeout says 8"]);
    expect(c.actionable).toBe(true);
    expect(c.inputs.map((i) => `${i.kind}:${i.op}`)).toEqual(["helper:update", "automation:update"]);
    expect(c.inputs[0]).toMatchObject({ targetId: "timer.living_hold", fields: { duration: 480 } });
    expect(c.inputs.every((i) => validateInput(i) === null)).toBe(true);
  });

  it("is out of date, and says which inputs, when the automation was made from an older blueprint", () => {
    const { bed_entities: _a, occupied_entity: _b, extended_after: _c, extended_hold: _d, sleep_hold: _e, ...old } = occupancyInput;
    const older = { ...installed, blueprints: { [OCC.path]: 2 }, automations: { taxis_occupancy_living: { ...installedOccupancy, input: old } } };
    const c = cell(plan(specs, { installed: older }), "occupancy");
    expect(c.status).toBe("out-of-date");
    // An empty list of bed sensors is "none" on both sides, so it isn't a difference.
    expect(c.reasons).toEqual([
      "Extended after (min): none → 30",
      "Extended hold timeout (min): none → 15",
      "Sleep hold timeout (min): none → 60",
      "Occupied sensor: none → binary_sensor.living_occupied",
      "The blueprint is version 2, Taxis has 3",
    ]);
    expect(c.inputs.map((i) => `${i.kind}:${i.op}`)).toEqual(["blueprint:update", "automation:update"]);
  });

  it("is out of date when a bed sensor or the extended time changed", () => {
    const bed = { id: "binary_sensor.living_bed", dc: "occupancy" };
    const inv = setBedroom(setBed(EMPTY_INVENTORY, bed.id, true), "living_room", true);
    const withBed = cell(plan([...specs, bed], { installed, inv }), "occupancy");
    expect(withBed.reasons).toEqual([
      "Sensors that hold: none → binary_sensor.living_bed",
      "Bed presence sensors: none → binary_sensor.living_bed",
    ]);
    const p = setParameter(EMPTY_PARAMETERS, { level: "area", id: "living_room" }, "extended_after", 60);
    expect(cell(plan(specs, { installed, params: p }), "occupancy").reasons).toEqual(["Extended after (min): 30 → 60"]);
    const q = setParameter(EMPTY_PARAMETERS, { level: "house" }, "sleep_hold", 120);
    expect(cell(plan(specs, { installed, params: q }), "occupancy").reasons).toEqual(["Sleep hold timeout (min): 60 → 120"]);
  });

  it("is out of date when a sensor was added", () => {
    const c = cell(plan([...specs, { id: "binary_sensor.living_pir2", dc: "motion" }], { installed }), "occupancy");
    expect(c.reasons).toEqual(["Sensors that start: binary_sensor.living_pir → binary_sensor.living_pir, binary_sensor.living_pir2"]);
  });

  it("is out of date when the blueprint is older, missing, or the automation isn't from it", () => {
    expect(cell(plan(specs, { installed: { ...installed, blueprints: { [OCC.path]: OCC.version - 1 } } }), "occupancy").reasons).toEqual([`The blueprint is version ${OCC.version - 1}, Taxis has ${OCC.version}`]);
    const missing = cell(plan(specs, { installed: { ...installed, blueprints: {} } }), "occupancy");
    expect(missing.reasons).toEqual(["The blueprint is missing"]);
    expect(missing.inputs[0]).toMatchObject({ kind: "blueprint", op: "create", fields: { path: OCC.path, version: OCC.version } });
    const other = cell(plan(specs, { installed: { ...installed, automations: { taxis_occupancy_living: { ...installedOccupancy, path: null, input: {} } } } }), "occupancy");
    expect(other.reasons[0]).toBe("It isn't made from the Taxis blueprint");
  });

  it("is out of date when the area was renamed (the alias carries its name) or a helper is gone", () => {
    const renamed = cell(plan(specs, { installed: { ...installed, automations: { taxis_occupancy_living: { ...installedOccupancy, alias: "Lounge – Occupancy (Taxis)" } } } }), "occupancy");
    expect(renamed.reasons).toEqual(["Name: Lounge – Occupancy (Taxis) → Living room – Occupancy (Taxis)"]);
    const gone = cell(plan([motion, spots, toggle, occupied], { installed }), "occupancy");
    expect(gone.status).toBe("out-of-date");
    expect(gone.reasons).toEqual(["timer.living_hold is missing"]);
    expect(gone.inputs.map((i) => i.fields?.helper ?? i.kind)).toEqual(["timer", "automation"]);
  });

  it("an unreadable timer duration is not a difference", () => {
    expect(cell(plan(specs, { installed: { ...installed, timers: { "timer.living_hold": null } } }), "occupancy").status).toBe("installed");
    expect(cell(plan(specs, { installed: { ...installed, timers: {} } }), "occupancy").status).toBe("installed");
  });

  it("a timer duration already in the list is not asked for twice", () => {
    const p = setParameter(EMPTY_PARAMETERS, { level: "house" }, "hold_timeout", 8);
    const pending = [change({ kind: "helper", op: "update", targetId: "timer.living_hold", after: { duration: 480 } })];
    const c = cell(plan(specs, { installed, params: p, changes: pending }), "occupancy");
    expect(c.inputs.map((i) => i.kind)).toEqual(["automation"]);
  });
});

describe("motion lights", () => {
  const occupancyThere = { blueprints: BLUEPRINTS_THERE, automations: { taxis_occupancy_living: installedOccupancy }, timers: { "timer.living_hold": 300 } };

  it("needs occupancy first", () => {
    const c = cell(plan([motion, spots, lights]), "motion_lights");
    expect(c).toMatchObject({ status: "missing", missing: ["Occupancy (install it first)"], actionable: false });
  });

  it("needs a light group: in place or in the list", () => {
    const withoutGroup = cell(plan([motion, spots, ...runtime], { installed: occupancyThere }), "motion_lights");
    expect(withoutGroup.missing).toEqual(["A light group (make it on the Helpers tab)"]);
    const queued = [change({ kind: "helper", targetId: "light.living_all", after: { helper: "group", entity_id: "light.living_all" } })];
    expect(cell(plan([motion, spots, ...runtime], { installed: occupancyThere, changes: queued }), "motion_lights").status).toBe("ready");
    // A group adopted by renaming counts too.
    const renamed = [change({ kind: "entity", op: "update", targetId: "light.living_old", after: { new_entity_id: "light.living_all" } })];
    expect(cell(plan([motion, spots, ...runtime], { installed: occupancyThere, changes: renamed }), "motion_lights").status).toBe("ready");
  });

  it("says when the light group id is held by something else", () => {
    const c = cell(plan([motion, spots, ...runtime, { id: "light.living_all", platform: "demo", name: "Strip" }], { installed: occupancyThere }), "motion_lights");
    expect(c.missing).toEqual(["light.living_all is already used by “Strip”"]);
  });

  it("accepts occupancy that is in the change list, with its helpers still to be made", () => {
    const pending = [change({ kind: "automation", targetId: "taxis_occupancy_living", after: {} })];
    const helpers = [
      change({ kind: "helper", targetId: "binary_sensor.living_occupied", after: { entity_id: "binary_sensor.living_occupied" } }),
      change({ kind: "helper", targetId: "input_boolean.living_paused", after: { entity_id: "input_boolean.living_paused" } }),
    ];
    expect(cell(plan([motion, spots, lights], { changes: [...pending, ...helpers] }), "motion_lights").status).toBe("ready");
    // Occupancy in the list but its sensor and switch nowhere: say so.
    expect(cell(plan([motion, spots, lights], { changes: pending }), "motion_lights").missing).toEqual([
      "binary_sensor.living_occupied is missing (the Occupancy recipe makes it)",
      "input_boolean.living_paused is missing (the Occupancy recipe makes it)",
    ]);
  });

  const ready = () => cell(plan([motion, spots, lights, ...runtime], { installed: occupancyThere }), "motion_lights");

  it("is ready and fills the blueprint with the defaults, the lights, the occupied sensor and the switch", () => {
    const c = ready();
    expect(c.status).toBe("ready");
    expect(c.inputs.map((i) => i.kind)).toEqual(["automation"]);
    expect(c.inputs[0].fields).toEqual({
      automation_id: "taxis_motion_lights_living",
      recipe: "motion_lights",
      area_id: "living_room",
      alias: "Living room – Motion lights (Taxis)",
      use_blueprint: {
        path: "taxis/motion_lights.yaml",
        input: {
          occupied_entity: "binary_sensor.living_occupied",
          light_target: "light.living_all",
          main_lights: ["light.living_spots"],
          accent_lights: [],
          night_lights: [],
          bed_entities: [],
          lux_threshold: 50,
          night_start: "23:00:00",
          night_end: "07:00:00",
          day_brightness: 100,
          day_kelvin: 3000,
          night_brightness: 10,
          night_kelvin: 2200,
          transition: 1,
          dim_before_off: 15,
          dim_level: 30,
          extended_after: 30,
          override_timer: "timer.living_override",
          override_minutes: 0,
          pause_switch: "input_boolean.living_paused",
        },
      },
    });
    expect(validateInput(c.inputs[0])).toBeNull();
  });

  it("writes the blueprint too when Home Assistant has none", () => {
    const c = cell(plan([motion, spots, lights, ...runtime], { installed: { ...occupancyThere, blueprints: { [OCC.path]: OCC.version } } }), "motion_lights");
    expect(c.inputs.map((i) => i.kind)).toEqual(["blueprint", "automation"]);
    expect(c.inputs[0]).toMatchObject({ op: "create", fields: { path: MOT.path, version: MOT.version } });
  });

  it("uses the light level helper when there is one, and says when there isn't", () => {
    expect(ready().notes).toEqual(["No light level helper yet, so the lights go on at any light level"]);
    const withLux = cell(plan([motion, spots, lights, luxMean, ...runtime], { installed: occupancyThere }), "motion_lights");
    expect(withLux.notes).toEqual([]);
    expect((withLux.inputs[0].fields!.use_blueprint as { input: Record<string, unknown> }).input.lux_entity).toBe("sensor.living_illuminance");
    // A real sensor on that id isn't the helper.
    const real = cell(plan([motion, spots, lights, { ...luxMean, platform: "demo" }, ...runtime], { installed: occupancyThere }), "motion_lights");
    expect((real.inputs[0].fields!.use_blueprint as { input: Record<string, unknown> }).input).not.toHaveProperty("lux_entity");
  });

  it("uses the parameters, with the night window written as the blueprint takes it", () => {
    let p = setParameter(EMPTY_PARAMETERS, { level: "house" }, "night_start", "22:30");
    p = setParameter(p, { level: "area", id: "living_room" }, "night_brightness", 5);
    p = setParameter(p, { level: "floor", id: "ground" }, "dim_before_off", 0);
    p = setParameter(p, { level: "type", id: "interior" }, "day_kelvin", 3500);
    const input = (cell(plan([motion, spots, lights, ...runtime], { installed: occupancyThere, params: p }), "motion_lights").inputs[0].fields!.use_blueprint as { input: Record<string, unknown> }).input;
    expect(input).toMatchObject({ night_start: "22:30:00", night_brightness: 5, dim_before_off: 0, day_kelvin: 3500, night_end: "07:00:00" });
  });

  it("warns, without blocking, about other automations that already control the light group", () => {
    const controllers = { "light.living_all": [{ entityId: "automation.evening_lights", name: "Evening lights" }] };
    const c = cell(plan([motion, spots, lights, ...runtime], { installed: { ...occupancyThere, controllers } }), "motion_lights");
    expect(c.status).toBe("ready");
    expect(c.actionable).toBe(true);
    expect(c.controlledBy).toEqual([{ entityId: "automation.evening_lights", name: "Evening lights" }]);
    // Nothing is said while it can't be installed anyway.
    const missing = cell(plan([motion, spots, lights], { installed: { ...NOTHING_INSTALLED, controllers } }), "motion_lights");
    expect(missing.controlledBy).toEqual([]);
  });

  it("is installed when it matches, and out of date when the parameters moved", () => {
    const input = (ready().inputs[0].fields!.use_blueprint as { input: Record<string, unknown> }).input;
    const installed = {
      ...occupancyThere,
      automations: { ...occupancyThere.automations, taxis_motion_lights_living: { alias: "Living room – Motion lights (Taxis)", path: MOT.path, input } },
    };
    const specs = [motion, spots, lights, ...runtime];
    expect(cell(plan(specs, { installed }), "motion_lights")).toMatchObject({ status: "installed", inputs: [] });
    const p = setParameter(EMPTY_PARAMETERS, { level: "area", id: "living_room" }, "lux_threshold", 80);
    const c = cell(plan(specs, { installed, params: p }), "motion_lights");
    expect(c.status).toBe("out-of-date");
    expect(c.reasons).toEqual(["Dark below (lx): 50 → 80"]);
    // A light level helper appearing is a difference too.
    const lux = cell(plan([...specs, luxMean], { installed }), "motion_lights");
    expect(lux.reasons).toEqual(["Light level sensor: none → sensor.living_illuminance"]);
  });
});

describe("motion lights: roles, sleep and the manual override", () => {
  const occupancyThere = { blueprints: BLUEPRINTS_THERE, automations: { taxis_occupancy_living: installedOccupancy }, timers: { "timer.living_hold": 300 } };
  const base = [motion, lights, ...runtime];
  const lamp = { id: "light.living_lamp" };
  const strip = { id: "light.living_strip" };
  const nightlight = { id: "light.living_night" };
  const reader = { id: "light.living_reader" };
  const motionCell = (specs: Parameters<typeof plan>[0], o: Opts = {}) => cell(plan(specs, { installed: occupancyThere, ...o }), "motion_lights");

  it("sends the counted lights by role: main, accent and night, in order; task lights and lights that don't count stay out", () => {
    const specs = [...base, spots, lamp, strip, nightlight, reader, { id: "light.living_off" }];
    const h = house(specs);
    let inv = setLightRole(EMPTY_INVENTORY, lamp.id, "accent");
    inv = setLightRole(inv, strip.id, "accent");
    inv = setLightRole(inv, nightlight.id, "night");
    inv = setLightRole(inv, reader.id, "task");
    inv = setCounts(h, inv, "light.living_off", false);
    const input = autoInput(motionCell(specs, { inv }));
    expect(input).toMatchObject({
      light_target: "light.living_all",
      main_lights: ["light.living_spots"],
      accent_lights: ["light.living_lamp", "light.living_strip"],
      night_lights: ["light.living_night"],
    });
    // The group is the light target and turns everything off; it is not one of the roles.
    const every = [input.main_lights, input.accent_lights, input.night_lights].flat() as string[];
    expect(every).not.toContain("light.living_all");
    expect(every).not.toContain("light.living_reader");
    expect(every).not.toContain("light.living_off");
    expect(motionCell(specs, { inv }).notes).toEqual(["No light level helper yet, so the lights go on at any light level"]);
  });

  it("passes the bed sensors of a bedroom, and says what a bedroom without night lights or main lights will do", () => {
    const bed = { id: "binary_sensor.living_bed", dc: "occupancy" };
    const specs = [...base, bed, spots];
    const inv = setBedroom(setBed(EMPTY_INVENTORY, bed.id, true), "living_room", true);
    const c = motionCell(specs, { inv });
    expect(autoInput(c).bed_entities).toEqual(["binary_sensor.living_bed"]);
    expect(c.notes).toEqual(["No light level helper yet, so the lights go on at any light level", "No night lights, so no light goes on while someone is in bed"]);
    // With a night light there is nothing to warn about.
    const night = setLightRole(inv, "light.living_night", "night");
    expect(motionCell([...specs, nightlight], { inv: night }).notes).toEqual(["No light level helper yet, so the lights go on at any light level"]);
    // An area that isn't a bedroom never sleeps.
    expect(autoInput(motionCell(specs, { inv: setBed(EMPTY_INVENTORY, bed.id, true) })).bed_entities).toEqual([]);
  });

  it("says when no light is a main light", () => {
    const inv = setLightRole(EMPTY_INVENTORY, "light.living_spots", "accent");
    expect(motionCell([...base, spots], { inv }).notes).toEqual([
      "No light level helper yet, so the lights go on at any light level",
      "No main lights, so no light goes on by day (set a light's role on the area's Capabilities tab)",
    ]);
    const night = setLightRole(inv, "light.living_night", "night");
    expect(motionCell([...base, spots, nightlight], { inv: night }).notes[1]).toBe("No main lights, so only the night lights go on");
  });

  it("passes the extended time and the override time from the parameters", () => {
    let p = setParameter(EMPTY_PARAMETERS, { level: "house" }, "extended_after", 40);
    p = setParameter(p, { level: "area", id: "living_room" }, "override_duration", 30);
    expect(autoInput(motionCell([...base, spots], { params: p }))).toMatchObject({ extended_after: 40, override_minutes: 30, override_timer: "timer.living_override" });
  });

  it("makes the override timer with the rest, as long as the override time (an hour as a placeholder when it has none)", () => {
    const noTimer = [motion, lights, spots, timer, toggle, occupied];
    const c = motionCell(noTimer);
    expect(c.status).toBe("ready");
    expect(c.inputs.map((i) => i.kind)).toEqual(["helper", "automation"]);
    expect(c.inputs[0].fields).toEqual({ helper: "timer", name: "Living room override", entity_id: "timer.living_override", area_id: "living_room", duration: 3600 });
    const fixed = motionCell(noTimer, { params: setParameter(EMPTY_PARAMETERS, { level: "house" }, "override_duration", 30) });
    expect(fixed.inputs[0].fields!.duration).toBe(1800);
    for (const i of c.inputs) expect(validateInput(i)).toBeNull();
    // The longest override time still fits a timer.
    const longest = motionCell(noTimer, { params: setParameter(EMPTY_PARAMETERS, { level: "house" }, "override_duration", 240) });
    expect(validateInput(longest.inputs[0])).toBeNull();
    // Already in the change list: not asked for twice.
    const pending = [change({ kind: "helper", targetId: "timer.living_override", after: { helper: "timer", entity_id: "timer.living_override" } })];
    expect(motionCell(noTimer, { changes: pending }).inputs.map((i) => i.kind)).toEqual(["automation"]);
  });

  it("is blocked by something else on the override timer's id", () => {
    const c = motionCell([...base.filter((s) => s !== overrideTimer), spots, { id: "timer.living_override", platform: "demo", name: "Old timer" }]);
    expect(c).toMatchObject({ status: "missing", missing: ["timer.living_override is already used by “Old timer”"] });
  });

  it("is out of date when the override setting changes, and the timer follows", () => {
    const specs = [...base, spots];
    const input = autoInput(motionCell(specs));
    const installed = {
      ...occupancyThere,
      automations: { ...occupancyThere.automations, taxis_motion_lights_living: { alias: "Living room – Motion lights (Taxis)", path: MOT.path, input } },
      timers: { ...occupancyThere.timers, "timer.living_override": 3600 },
    };
    expect(cell(plan(specs, { installed }), "motion_lights")).toMatchObject({ status: "installed", inputs: [] });
    const p = setParameter(EMPTY_PARAMETERS, { level: "house" }, "override_duration", 30);
    const c = cell(plan(specs, { installed, params: p }), "motion_lights");
    expect(c.status).toBe("out-of-date");
    expect(c.reasons).toEqual(["Manual override lasts (min): 0 → 30", "The override timer is 60 min, the override setting says 30"]);
    expect(c.inputs.map((i) => `${i.kind}:${i.op}`)).toEqual(["helper:update", "automation:update"]);
    expect(c.inputs[0]).toMatchObject({ targetId: "timer.living_override", fields: { duration: 1800 } });
    for (const i of c.inputs) expect(validateInput(i)).toBeNull();
    // A timer that is gone is made again.
    const gone = cell(plan([motion, lights, spots, timer, toggle, occupied], { installed }), "motion_lights");
    expect(gone.reasons).toEqual(["timer.living_override is missing"]);
    expect(gone.inputs.map((i) => i.fields?.helper ?? i.kind)).toEqual(["timer", "automation"]);
  });

  it("is out of date, and says which inputs, when the automation was made from the older blueprint", () => {
    const specs = [...base, spots, lamp];
    const inv = setLightRole(EMPTY_INVENTORY, lamp.id, "accent");
    const now = autoInput(motionCell(specs, { inv }));
    const { main_lights: _a, accent_lights: _b, night_lights: _c, bed_entities: _d, extended_after: _e, override_timer: _f, override_minutes: _g, ...old } = now;
    const installed = {
      ...occupancyThere,
      blueprints: { ...BLUEPRINTS_THERE, [MOT.path]: 2 },
      automations: { ...occupancyThere.automations, taxis_motion_lights_living: { alias: "Living room – Motion lights (Taxis)", path: MOT.path, input: old } },
    };
    const c = cell(plan(specs, { installed, inv }), "motion_lights");
    expect(c.status).toBe("out-of-date");
    expect(c.reasons).toEqual([
      "Extended after (min): none → 30",
      "Main lights: none → light.living_spots",
      "Accent lights: none → light.living_lamp",
      "Override timer: none → timer.living_override",
      "Manual override lasts (min): none → 0",
      "The blueprint is version 2, Taxis has 3",
    ]);
  });

  it("is out of date when a light's role changes", () => {
    const specs = [...base, spots, lamp];
    const input = autoInput(motionCell(specs));
    const installed = {
      ...occupancyThere,
      automations: { ...occupancyThere.automations, taxis_motion_lights_living: { alias: "Living room – Motion lights (Taxis)", path: MOT.path, input } },
    };
    expect(cell(plan(specs, { installed }), "motion_lights").status).toBe("installed");
    const inv = setLightRole(EMPTY_INVENTORY, lamp.id, "night");
    expect(cell(plan(specs, { installed, inv }), "motion_lights").reasons).toEqual(["Main lights: light.living_lamp, light.living_spots → light.living_spots", "Night lights: none → light.living_lamp"]);
  });
});

describe("media off", () => {
  const occupancyThere = { blueprints: BLUEPRINTS_THERE, automations: { taxis_occupancy_living: installedOccupancy }, timers: { "timer.living_hold": 300 } };
  const mediaCell = (specs: Parameters<typeof plan>[0], o: Opts = {}) => cell(plan(specs, { installed: occupancyThere, ...o }), "media_off");
  const base = [motion, ...runtime];

  it("needs occupancy first, and a speaker or a TV that counts", () => {
    expect(cell(plan([motion, tv]), "media_off")).toMatchObject({ status: "missing", missing: ["Occupancy (install it first)"], actionable: false });
    expect(mediaCell([...base, spots])).toMatchObject({ status: "missing", missing: ["A speaker or a TV that counts (Capabilities)"] });
    const h = house([...base, tv]);
    expect(mediaCell([...base, tv], { inv: setCounts(h, EMPTY_INVENTORY, tv.id, false) }).missing).toEqual(["A speaker or a TV that counts (Capabilities)"]);
    // Occupancy in the list but its sensor and switch nowhere: say so, as Motion lights does.
    const pending = [change({ kind: "automation", targetId: "taxis_occupancy_living", after: {} })];
    expect(cell(plan([motion, tv], { changes: pending }), "media_off").missing).toEqual([
      "binary_sensor.living_occupied is missing (the Occupancy recipe makes it)",
      "input_boolean.living_paused is missing (the Occupancy recipe makes it)",
    ]);
    expect(cell(plan([motion, tv], { changes: [...pending, change({ kind: "helper", targetId: "binary_sensor.living_occupied", after: { entity_id: "binary_sensor.living_occupied" } }), change({ kind: "helper", targetId: "input_boolean.living_paused", after: { entity_id: "input_boolean.living_paused" } })] }), "media_off").status).toBe("ready");
  });

  it("is ready for a TV, and fills the blueprint with the lists and the two times", () => {
    const c = mediaCell([...base, tv]);
    expect(c.status).toBe("ready");
    expect(c.inputs.map((i) => i.kind)).toEqual(["automation"]);
    expect(c.inputs[0].fields).toEqual({
      automation_id: "taxis_media_off_living",
      recipe: "media_off",
      area_id: "living_room",
      alias: "Living room – Media off (Taxis)",
      use_blueprint: {
        path: "taxis/media_off.yaml",
        input: {
          occupied_entity: "binary_sensor.living_occupied",
          speaker_entities: [],
          tv_entities: ["media_player.living_tv"],
          speaker_minutes: 15,
          tv_minutes: 30,
          pause_switch: "input_boolean.living_paused",
        },
      },
    });
    expect(validateInput(c.inputs[0])).toBeNull();
  });

  it("writes the blueprint too when Home Assistant has none", () => {
    const c = mediaCell([...base, speaker], { installed: { ...occupancyThere, blueprints: { [OCC.path]: OCC.version } } });
    expect(c.inputs.map((i) => i.kind)).toEqual(["blueprint", "automation"]);
    expect(c.inputs[0]).toMatchObject({ op: "create", fields: { path: MEDIA.path, version: MEDIA.version } });
    expect(c.inputs.every((i) => validateInput(i) === null)).toBe(true);
  });

  it("uses the parameters: speakers and TVs have their own time", () => {
    let p = setParameter(EMPTY_PARAMETERS, { level: "house" }, "media_off_after", 10);
    p = setParameter(p, { level: "area", id: "living_room" }, "tv_off_after", 45);
    expect(autoInput(mediaCell([...base, tv, speaker], { params: p }))).toMatchObject({
      speaker_entities: ["media_player.living_speaker"],
      tv_entities: ["media_player.living_tv"],
      speaker_minutes: 10,
      tv_minutes: 45,
    });
  });

  it("a speaker the user reads as a TV is turned off on the TV's time", () => {
    const h = house([...base, speaker]);
    const inv = { ...EMPTY_INVENTORY, entities: { [speaker.id]: { kind: "tv" as const } } };
    expect(h.entities[speaker.id]).toBeDefined();
    expect(autoInput(mediaCell([...base, speaker], { inv }))).toMatchObject({ speaker_entities: [], tv_entities: ["media_player.living_speaker"] });
  });

  it("uses the media group when the area has one kind of player, and the players themselves when it has both", () => {
    const speaker2 = { id: "media_player.living_speaker2" };
    const group = { ...mediaGroup, members: [speaker.id, speaker2.id] };
    // Two speakers and their group: the group stands for them.
    expect(autoInput(mediaCell([...base, speaker, speaker2, group]))).toMatchObject({ speaker_entities: ["media_player.living_media"], tv_entities: [] });
    // Two TVs: the same, on the TV time.
    const tv2 = { ...tv, id: "media_player.living_tv2" };
    expect(autoInput(mediaCell([...base, tv, tv2, { ...group, members: [tv.id, tv2.id] }]))).toMatchObject({ speaker_entities: [], tv_entities: ["media_player.living_media"] });
    // A TV and a speaker need their own times, so the group can't stand for them.
    expect(autoInput(mediaCell([...base, tv, speaker, mediaGroup]))).toMatchObject({ speaker_entities: [speaker.id], tv_entities: [tv.id] });
    // Without the group, or with a real player on its id, the players are used.
    expect(autoInput(mediaCell([...base, speaker, speaker2]))).toMatchObject({ speaker_entities: [speaker.id, speaker2.id] });
    expect(autoInput(mediaCell([...base, speaker, speaker2, { ...group, platform: "demo" }]))).toMatchObject({ speaker_entities: [speaker.id, speaker2.id] });
    // One player: no group is planned for it, so even a leftover one isn't used.
    expect(autoInput(mediaCell([...base, speaker, group]))).toMatchObject({ speaker_entities: [speaker.id] });
    // A group on its way, in the change list or being adopted, counts.
    const queued = [change({ kind: "helper", targetId: "media_player.living_media", after: { helper: "group", entity_id: "media_player.living_media" } })];
    expect(autoInput(mediaCell([...base, speaker, speaker2], { changes: queued }))).toMatchObject({ speaker_entities: ["media_player.living_media"] });
    const renamed = [change({ kind: "entity", op: "update", targetId: "media_player.old_group", after: { new_entity_id: "media_player.living_media" } })];
    expect(autoInput(mediaCell([...base, speaker, speaker2], { changes: renamed }))).toMatchObject({ speaker_entities: ["media_player.living_media"] });
  });

  it("is installed when it matches, and out of date when a time or the players change", () => {
    const specs = [...base, tv];
    const input = autoInput(mediaCell(specs));
    const installed = {
      ...occupancyThere,
      automations: { ...occupancyThere.automations, taxis_media_off_living: { alias: "Living room – Media off (Taxis)", path: MEDIA.path, input } },
    };
    expect(cell(plan(specs, { installed }), "media_off")).toMatchObject({ status: "installed", inputs: [], actionable: false });
    const p = setParameter(EMPTY_PARAMETERS, { level: "house" }, "tv_off_after", 20);
    const c = cell(plan(specs, { installed, params: p }), "media_off");
    expect(c.status).toBe("out-of-date");
    expect(c.reasons).toEqual(["TVs off when clear for (min): 30 → 20"]);
    expect(c.inputs.map((i) => `${i.kind}:${i.op}`)).toEqual(["automation:update"]);
    const more = cell(plan([...specs, speaker], { installed }), "media_off");
    expect(more.reasons).toEqual(["Speakers: none → media_player.living_speaker"]);
    // The blueprint missing or older than Taxis's.
    const older = cell(plan(specs, { installed: { ...installed, blueprints: { ...installed.blueprints, [MEDIA.path]: 0 } } }), "media_off");
    expect(older.reasons).toEqual([`The blueprint is version 0, Taxis has ${MEDIA.version}`]);
    expect(older.inputs.map((i) => `${i.kind}:${i.op}`)).toEqual(["blueprint:update", "automation:update"]);
  });

  it("says in changes once the automation is in the list", () => {
    const pending = [change({ kind: "automation", targetId: "taxis_media_off_living", after: {} })];
    expect(mediaCell([...base, tv], { changes: pending })).toMatchObject({ status: "in-changes", actionable: false, inputs: [] });
  });

  it("every area has its own cell, and the kitchen is judged on its own", () => {
    const cells = plan([motion, tv, ...runtime, { id: "media_player.kitchen_radio", area: "kitchen" }], { installed: occupancyThere });
    expect(cell(cells, "media_off", "living_room").status).toBe("ready");
    expect(cell(cells, "media_off", "kitchen").status).toBe("missing");
    expect(cell(cells, "media_off", "kitchen").missing).toEqual(["Occupancy (install it first)"]);
  });
});

describe("the chosen cells", () => {
  it("send each blueprint once", () => {
    const cells = plan([motion, spots, { id: "binary_sensor.kitchen_pir", dc: "motion", area: "kitchen" }, { id: "light.kitchen_x", area: "kitchen" }]);
    const both = [cell(cells, "occupancy", "living_room"), cell(cells, "occupancy", "kitchen")];
    const inputs = recipeChangeInputs(both);
    expect(inputs.filter((i) => i.kind === "blueprint")).toHaveLength(1);
    expect(inputs.filter((i) => i.kind === "automation").map((i) => i.fields!.automation_id)).toEqual(["taxis_occupancy_living", "taxis_occupancy_kitchen"]);
    expect(inputs.filter((i) => i.kind === "helper")).toHaveLength(6);
    for (const i of inputs) expect(validateInput(i), JSON.stringify(i).slice(0, 80)).toBeNull();
  });

  it("send nothing for cells that can't be added", () => {
    expect(recipeChangeInputs(plan([spots]))).toEqual([]);
  });
});

describe("the occupied sensor is not one of the area's sensors", () => {
  it("is left out of the inventory, so it can't feed the occupancy that makes it", () => {
    const h = house([motion, occupied]);
    expect(helperExclusions(h, naming)("living_room").has("binary_sensor.living_occupied")).toBe(true);
    // Only when it is a template: a real sensor on that id stays a conflict to see.
    const real = house([motion, { ...occupied, platform: "demo" }]);
    expect(helperExclusions(real, naming)("living_room").has("binary_sensor.living_occupied")).toBe(false);
  });

  it("is a name no stage-3 binary sensor helper may take", () => {
    expect(helperNameErrors({ motion: RECIPE_HELPER_SUFFIX.occupied })).toEqual({ motion: "Taxis uses this name for the occupied sensor of the recipes." });
    expect(helperNameErrors({ lights: "occupied" })).toEqual({});
  });
});

describe("what the change list accepts", () => {
  const goodAutomation = (over: Record<string, unknown> = {}): ChangeInput => ({
    kind: "automation",
    op: "create",
    fields: {
      automation_id: "taxis_occupancy_living",
      recipe: "occupancy",
      area_id: "living_room",
      alias: "Living room – Occupancy (Taxis)",
      use_blueprint: { path: OCC.path, input: occupancyInput },
      ...over,
    },
  });
  const goodBlueprint = (over: Record<string, unknown> = {}): ChangeInput => ({ kind: "blueprint", op: "create", fields: { path: OCC.path, version: OCC.version, ...over } });
  const timerCreate = (over: Record<string, unknown> = {}): ChangeInput => ({
    kind: "helper",
    op: "create",
    fields: { helper: "timer", name: "Living hold", entity_id: "timer.living_hold", area_id: "living_room", duration: 300, ...over },
  });

  it("takes a blueprint at its current version, as a create or an update", () => {
    expect(validateInput(goodBlueprint())).toBeNull();
    expect(validateInput({ ...goodBlueprint(), op: "update" })).toBeNull();
    for (const b of BLUEPRINTS) expect(validateInput(goodBlueprint({ path: b.path, version: b.version }))).toBeNull();
  });

  it("refuses a blueprint at another path, another version, or with anything else", () => {
    expect(validateInput(goodBlueprint({ path: "taxis/other.yaml" }))).toMatch(/no blueprint at/);
    expect(validateInput(goodBlueprint({ path: "other/occupancy.yaml" }))).toMatch(/wouldn't accept/);
    expect(validateInput(goodBlueprint({ path: "taxis/../occupancy.yaml" }))).toMatch(/wouldn't accept/);
    expect(validateInput(goodBlueprint({ version: OCC.version + 1 }))).toMatch(/isn't the current version/);
    expect(validateInput(goodBlueprint({ version: 0 }))).toMatch(/wouldn't accept/);
    expect(validateInput(goodBlueprint({ yaml: "blueprint: {}" }))).toMatch(/can't be changed on a blueprint/);
    expect(validateInput({ kind: "blueprint", op: "create", fields: { path: OCC.path } })).toMatch(/needs a path and a version/);
    expect(validateInput({ kind: "blueprint", op: "delete", fields: {} })).toMatch(/not deleted/);
    expect(validateInput({ kind: "blueprint", op: "update", fields: {} })).toMatch(/Nothing to change/);
  });

  it("takes an automation for a recipe, with that recipe's blueprint and inputs", () => {
    expect(validateInput(goodAutomation())).toBeNull();
    expect(validateInput({ ...goodAutomation(), op: "update" })).toBeNull();
  });

  it("refuses an automation that is not a Taxis recipe's, uses another blueprint, or carries other inputs", () => {
    expect(validateInput(goodAutomation({ automation_id: "living_occupancy" }))).toMatch(/wouldn't accept/);
    expect(validateInput(goodAutomation({ automation_id: "taxis_motion_lights_living" }))).toMatch(/taxis_<recipe>_<area code>/);
    expect(validateInput(goodAutomation({ automation_id: "taxis_occupancy_" }))).toMatch(/taxis_<recipe>_<area code>/);
    expect(validateInput(goodAutomation({ automation_id: "taxis_occupancy_../x" }))).toMatch(/wouldn't accept/);
    expect(validateInput(goodAutomation({ recipe: "climate" }))).toMatch(/wouldn't accept/);
    expect(validateInput(goodAutomation({ use_blueprint: { path: MOT.path, input: occupancyInput } }))).toMatch(/another blueprint|wouldn't accept/);
    expect(validateInput(goodAutomation({ use_blueprint: { path: OCC.path, input: { ...occupancyInput, evil: "x" } } }))).toMatch(/wouldn't accept/);
    expect(validateInput(goodAutomation({ use_blueprint: { path: OCC.path, input: { ...occupancyInput, hold_timer: "script.run_all" } } }))).toMatch(/wouldn't accept/);
    expect(validateInput(goodAutomation({ use_blueprint: { path: OCC.path, input: { ...occupancyInput, hold_timer: "not an id" } } }))).toMatch(/wouldn't accept/);
    expect(validateInput(goodAutomation({ use_blueprint: { path: OCC.path, input: { hold_timer: "timer.x" } } }))).toMatch(/wouldn't accept/);
    expect(validateInput(goodAutomation({ use_blueprint: { path: OCC.path, input: occupancyInput, extra: 1 } }))).toMatch(/wouldn't accept/);
    expect(validateInput(goodAutomation({ use_blueprint: "taxis/occupancy.yaml" }))).toMatch(/wouldn't accept/);
    expect(validateInput(goodAutomation({ alias: "" }))).toMatch(/wouldn't accept/);
    expect(validateInput(goodAutomation({ trigger: [] }))).toMatch(/can't be changed on an automation/);
    expect(validateInput({ kind: "automation", op: "create", fields: { automation_id: "taxis_occupancy_living" } })).toMatch(/needs recipe/);
    expect(validateInput({ kind: "automation", op: "delete", fields: {} })).toMatch(/not deleted/);
  });

  it("takes the three helpers a recipe adds, each with its own fields only", () => {
    expect(validateInput(timerCreate())).toBeNull();
    expect(validateInput({ kind: "helper", op: "create", fields: { helper: "input_boolean", name: "Living automations paused", entity_id: "input_boolean.living_paused", area_id: "living_room", icon: "mdi:pause-circle-outline" } })).toBeNull();
    expect(
      validateInput({
        kind: "helper",
        op: "create",
        fields: { helper: "template", name: "Living occupied", entity_id: "binary_sensor.living_occupied", area_id: "living_room", state_template: "{{ is_state('timer.living_hold','active') }}", device_class: "occupancy" },
      }),
    ).toBeNull();
  });

  it("refuses a timer without a sensible duration, in another domain, or with fields it doesn't have", () => {
    for (const duration of [0, 59, 14401, 1.5, "300", -60, null]) expect(validateInput(timerCreate({ duration })), String(duration)).toMatch(/wouldn't accept/);
    expect(validateInput(timerCreate({ duration: 60 }))).toBeNull();
    expect(validateInput(timerCreate({ duration: 14400 }))).toBeNull();
    expect(validateInput(timerCreate({ entity_id: "input_boolean.living_hold" }))).toMatch(/has to start with “timer\.”/);
    expect(validateInput({ kind: "helper", op: "create", fields: { helper: "timer", name: "x", entity_id: "timer.x", area_id: "a" } })).toMatch(/needs a duration/);
    expect(validateInput(timerCreate({ entities: ["light.a"] }))).toMatch(/can't be set on a timer/);
    expect(validateInput(timerCreate({ state_template: "{{ is_state('timer.living_hold','active') }}" }))).toMatch(/can't be set on a timer/);
    expect(validateInput({ kind: "helper", op: "create", fields: { helper: "group", group_type: "light", name: "x", entity_id: "light.x", entities: ["light.a"], area_id: "a", duration: 60 } })).toMatch(/Only a timer/);
  });

  it("refuses a template sensor with any template but the hold timer being active", () => {
    const tpl = (over: Record<string, unknown>): ChangeInput => ({
      kind: "helper",
      op: "create",
      fields: { helper: "template", name: "Living occupied", entity_id: "binary_sensor.living_occupied", area_id: "living_room", state_template: "{{ is_state('timer.living_hold','active') }}", device_class: "occupancy", ...over },
    });
    for (const state_template of [
      "{{ true }}",
      "{{ states('sensor.x') }}",
      "{{ is_state('timer.living_hold','active') }}{{ x }}",
      "{{ is_state('light.living_all','on') }}",
      "{{ is_state('timer.living_hold','idle') }}",
      "{% if true %}on{% endif %}",
      "",
      5,
    ]) {
      expect(validateInput(tpl({ state_template })), String(state_template)).toMatch(/wouldn't accept/);
    }
    expect(validateInput(tpl({ device_class: "motion" }))).toMatch(/wouldn't accept/);
    expect(validateInput(tpl({ entity_id: "sensor.living_occupied" }))).toMatch(/has to start with “binary_sensor\.”/);
    expect(validateInput({ kind: "helper", op: "create", fields: { helper: "template", name: "x", entity_id: "binary_sensor.x", area_id: "a" } })).toMatch(/needs its template/);
  });

  it("changes a timer's duration, and nothing else about a timer", () => {
    expect(validateInput({ kind: "helper", op: "update", targetId: "timer.living_hold", fields: { duration: 480 } })).toBeNull();
    expect(validateInput({ kind: "helper", op: "update", targetId: "timer.living_hold", fields: { duration: 480, name: "x" } })).toMatch(/only change its members or a timer's duration/);
    expect(validateInput({ kind: "helper", op: "update", targetId: "timer.living_hold", fields: { name: "x" } })).toMatch(/only change its members or a timer's duration/);
    expect(validateInput({ kind: "helper", op: "update", targetId: "timer.living_hold", fields: { duration: 480, entities: ["light.a"] } })).toMatch(/only change its members or a timer's duration/);
    expect(validateInput({ kind: "helper", op: "update", targetId: "timer.living_hold", fields: { duration: 5 } })).toMatch(/wouldn't accept/);
    expect(validateInput({ kind: "helper", op: "delete", targetId: "timer.living_hold" })).toMatch(/not deleted/);
  });
});
