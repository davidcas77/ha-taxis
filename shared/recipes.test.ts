import { describe, expect, it } from "vitest";

import { buildMockRegistry } from "../scripts/mock-ha-core.ts";
import { buildHierarchy, type RawRegistry } from "../server/model/hierarchy.ts";
import { BLUEPRINTS, blueprintForRecipe } from "./blueprints.ts";
import { sameValue, validateInput } from "./changes.ts";
import { RECIPE_HELPER_SUFFIX, helperExclusions, helperNameErrors } from "./helpers.ts";
import { EMPTY_INVENTORY, resetEntity, setAppliance, setAreaType, setBed, setBedroom, setClimateKind, setCounts, setKind, setLightRole, setRole, type InventorySettings } from "./inventory.ts";
import { closureFor } from "./apply-plan.ts";
import { DEFAULT_NAMING, type NamingSettings } from "./naming.ts";
import { EMPTY_PARAMETERS, PARAM_DEF, setParameter, type ParameterSettings } from "./parameters.ts";
import {
  ANNOUNCE_ALIAS,
  NOTHING_INSTALLED,
  automationAlias,
  automationIdFor,
  planAnnounce,
  planRecipes,
  recipeChangeInputs,
  runtimeIds,
  RECIPE_LABEL,
  type RecipeCell,
  type RecipeInstalled,
} from "./recipes.ts";
import type { Change, ChangeInput } from "./types.ts";

type Spec = { id: string; state?: string; dc?: string; platform?: string; area?: string; entry?: string; name?: string; members?: string[]; attrs?: Record<string, unknown> };

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
    reg.states.push({ entity_id: s.id, state: s.state ?? "off", attributes: { friendly_name: s.name ?? s.id.split(".")[1].replace(/_/g, " "), device_class: s.dc, entity_id: s.members, ...s.attrs } });
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
const BLUEPRINTS_THERE = { [OCC.path]: OCC.version, [MOT.path]: MOT.version, [MEDIA.path]: MEDIA.version, [blueprintForRecipe("area_climate").path]: blueprintForRecipe("area_climate").version };

// What Taxis would write for the living room with the defaults.
const occupancyInput = {
  starts_entities: ["binary_sensor.living_pir"],
  holds_entities: [],
  bed_entities: [],
  rate_entities: [],
  rate_hold: 0,
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
      schedule: "schedule.living_climate",
      rate: "sensor.living_humidity_rate",
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
      "living_room:area_climate",
      "living_room:bathroom_fan",
      "living_room:exterior_lights",
      "living_room:left_open",
      "living_room:appliance_done",
      "kitchen:occupancy",
      "kitchen:motion_lights",
      "kitchen:media_off",
      "kitchen:area_climate",
      "kitchen:bathroom_fan",
      "kitchen:exterior_lights",
      "kitchen:left_open",
      "kitchen:appliance_done",
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
    p = setParameter(p, { level: "type", id: "interior" }, "extended_hold", 20);
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
    const { bed_entities: _a, occupied_entity: _b, extended_after: _c, extended_hold: _d, sleep_hold: _e, rate_entities: _f, rate_hold: _g, ...old } = occupancyInput;
    const older = { ...installed, blueprints: { [OCC.path]: 2 }, automations: { taxis_occupancy_living: { ...installedOccupancy, input: old } } };
    const c = cell(plan(specs, { installed: older }), "occupancy");
    expect(c.status).toBe("out-of-date");
    // An empty list of bed sensors is "none" on both sides, so it isn't a difference.
    expect(c.reasons).toEqual([
      "Extended after (min): none → 30",
      "Extended hold timeout (min): none → 15",
      "Sleep hold timeout (min): none → 60",
      "Occupied sensor: none → binary_sensor.living_occupied",
      "Shower holds occupied at (%/s): none → 0",
      `The blueprint is version 2, Taxis has ${OCC.version}`,
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
          entry_lights: ["light.living_spots"],
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
    p = setParameter(p, { level: "type", id: "interior" }, "dim_before_off", 0);
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
      entry_lights: ["light.living_spots"],
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

  it("says when there are no entry lights: several lights and none is a main light", () => {
    let inv = setLightRole(EMPTY_INVENTORY, "light.living_spots", "accent");
    inv = setLightRole(inv, "light.living_lamp", "accent");
    expect(motionCell([...base, spots, lamp], { inv }).notes).toEqual([
      "No light level helper yet, so the lights go on at any light level",
      "No entry or main lights, so no light goes on by day (set an entry light, or a light's role, on the area's Capabilities tab)",
    ]);
    expect(autoInput(motionCell([...base, spots, lamp], { inv })).entry_lights).toEqual([]);
    const night = setLightRole(inv, "light.living_night", "night");
    expect(motionCell([...base, spots, lamp, nightlight], { inv: night }).notes[1]).toBe("No entry or main lights, so only the night lights go on");
    // An entry light of one's own settles it.
    const own = setParameter(EMPTY_PARAMETERS, { level: "area", id: "living_room" }, "entry_lights", ["light.living_lamp"]);
    const c = motionCell([...base, spots, lamp], { inv, params: own });
    expect(c.notes).toEqual(["No light level helper yet, so the lights go on at any light level"]);
    expect(autoInput(c).entry_lights).toEqual(["light.living_lamp"]);
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
    const { entry_lights: _h, main_lights: _a, accent_lights: _b, night_lights: _c, bed_entities: _d, extended_after: _e, override_timer: _f, override_minutes: _g, ...old } = now;
    const installed = {
      ...occupancyThere,
      blueprints: { ...BLUEPRINTS_THERE, [MOT.path]: 3 },
      automations: { ...occupancyThere.automations, taxis_motion_lights_living: { alias: "Living room – Motion lights (Taxis)", path: MOT.path, input: old } },
    };
    const c = cell(plan(specs, { installed, inv }), "motion_lights");
    expect(c.status).toBe("out-of-date");
    expect(c.reasons).toEqual([
      "Extended after (min): none → 30",
      "Entry lights: none → light.living_spots",
      "Main lights: none → light.living_spots",
      "Accent lights: none → light.living_lamp",
      "Override timer: none → timer.living_override",
      "Manual override lasts (min): none → 0",
      "The blueprint is version 3, Taxis has 5",
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
    expect(cell(plan(specs, { installed, inv }), "motion_lights").reasons).toEqual([
      "Entry lights: light.living_lamp, light.living_spots → light.living_spots",
      "Main lights: light.living_lamp, light.living_spots → light.living_spots",
      "Night lights: none → light.living_lamp",
    ]);
  });

  describe("entry lights", () => {
    const area = { level: "area", id: "living_room" } as const;
    const entryOf = (c: ReturnType<typeof motionCell>) => autoInput(c).entry_lights;

    it("are the only light of the area, whatever its role, else the main lights", () => {
      expect(entryOf(motionCell([...base, spots]))).toEqual(["light.living_spots"]);
      expect(entryOf(motionCell([...base, spots], { inv: setLightRole(EMPTY_INVENTORY, "light.living_spots", "night") }))).toEqual(["light.living_spots"]);
      expect(entryOf(motionCell([...base, spots, lamp]))).toEqual(["light.living_lamp", "light.living_spots"]);
      const inv = setLightRole(EMPTY_INVENTORY, lamp.id, "accent");
      expect(entryOf(motionCell([...base, spots, lamp], { inv }))).toEqual(["light.living_spots"]);
    });

    it("are the ones chosen for the area, and a choice for another level or another area is not used", () => {
      const own = setParameter(EMPTY_PARAMETERS, area, "entry_lights", ["light.living_strip"]);
      const specs = [...base, spots, lamp, strip];
      expect(entryOf(motionCell(specs, { params: own }))).toEqual(["light.living_strip"]);
      const other = setParameter(EMPTY_PARAMETERS, { level: "area", id: "kitchen" }, "entry_lights", ["light.living_strip"]);
      expect(entryOf(motionCell(specs, { params: other }))).toEqual(["light.living_lamp", "light.living_spots", "light.living_strip"]);
    });

    it("leave out a chosen light that doesn't count (any more), with a note", () => {
      const h = house([...base, spots, lamp]);
      const own = setParameter(EMPTY_PARAMETERS, area, "entry_lights", ["light.living_lamp"]);
      const c = motionCell([...base, spots, lamp], { params: own, inv: setCounts(h, EMPTY_INVENTORY, lamp.id, false) });
      expect(entryOf(c)).toEqual(["light.living_spots"]);
      expect(c.notes).toContain("The entry lights set for this area don't count here any more, so the suggested ones are used");
    });

    it("make an installed automation out of date when they change, and not otherwise", () => {
      const specs = [...base, spots, lamp];
      const input = autoInput(motionCell(specs));
      const installed = {
        ...occupancyThere,
        automations: { ...occupancyThere.automations, taxis_motion_lights_living: { alias: "Living room – Motion lights (Taxis)", path: MOT.path, input } },
        timers: { ...occupancyThere.timers, "timer.living_override": 3600 },
      };
      expect(cell(plan(specs, { installed }), "motion_lights").status).toBe("installed");
      const own = setParameter(EMPTY_PARAMETERS, area, "entry_lights", ["light.living_lamp"]);
      const c = cell(plan(specs, { installed, params: own }), "motion_lights");
      expect(c.status).toBe("out-of-date");
      expect(c.reasons).toEqual(["Entry lights: light.living_lamp, light.living_spots → light.living_lamp"]);
      expect(c.inputs.map((i) => i.kind)).toEqual(["automation"]);
      for (const i of c.inputs) expect(validateInput(i)).toBeNull();
    });
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

describe("area climate", () => {
  const CLIMATE = blueprintForRecipe("area_climate");
  const valve = { id: "climate.living_valve", state: "heat", name: "Radiator valve" };
  const tado = { id: "climate.living_tado", state: "heat", name: "Tado", attrs: { preset_modes: ["eco", "comfort", "sleep", "away"], hvac_modes: ["off", "heat", "auto"] } };
  const windows = { id: "binary_sensor.living_windows", platform: "group", dc: "window", members: ["binary_sensor.living_window"], entry: "W1" };
  const doors = { id: "binary_sensor.living_doors", platform: "group", dc: "door", members: ["binary_sensor.living_balcony"], entry: "D1" };
  const tempMean = { id: "sensor.living_temperature", platform: "min_max", dc: "temperature", state: "21.3", entry: "T1" };
  const schedule = { id: "schedule.living_climate", platform: "schedule", state: "off" };
  const away = { id: "input_boolean.taxis_away", platform: "input_boolean", area: "" };
  const sleep = { id: "input_boolean.taxis_sleep", platform: "input_boolean", area: "" };
  const occupancyThere = { blueprints: BLUEPRINTS_THERE, automations: { taxis_occupancy_living: installedOccupancy }, timers: { "timer.living_hold": 300 } };

  // The blueprint is in place unless a test says it isn't.
  const climate = (specs: Spec[], o: Opts = {}) => cell(plan(specs, { ...o, installed: { blueprints: BLUEPRINTS_THERE, ...o.installed } }), "area_climate");
  const kinds = (c: RecipeCell) => c.inputs.map((i) => `${i.kind}:${i.op}:${i.fields?.helper ?? i.fields?.path ?? i.fields?.automation_id ?? i.targetId}`);

  // An air conditioner: it can cool, so it is an AC, and it has presets of its own.
  const ac = { id: "climate.living_ac", state: "cool", name: "Living AC", attrs: { hvac_modes: ["off", "cool", "heat", "auto"], preset_modes: ["eco", "comfort", "boost"], temperature: 24 } };

  // What Taxis writes for the living room with the defaults and one valve.
  const defaults = {
    climate_entities: ["climate.living_valve"],
    opening_entities: [],
    occupied_entities: [],
    bed_entities: [],
    is_bedroom: false,
    away_entity: "input_boolean.taxis_away",
    sleep_entity: "input_boolean.taxis_sleep",
    schedule_entity: "schedule.living_climate",
    comfort_periods: "Mon-Fri 06:30-08:30 17:00-23:00; Sat-Sun 08:00-23:00",
    comfort_needs_occupancy: true,
    season: "heating",
    auto_hvac_on: false,
    comfort_temp: 21,
    eco_temp: 19,
    night_temp: 18,
    sleep_temp: 17.5,
    away_temp: 16,
    cool_comfort_temp: 24,
    cool_eco_temp: 27,
    cool_night_temp: 25,
    cool_away_temp: 29,
    frost_temp: 7,
    min_temp: 16,
    max_temp: 24,
    window_delay: 2,
    restore_delay: 1,
    eco_after_clear: 30,
    night_start: "23:00:00",
    night_end: "07:00:00",
    preset_comfort: "",
    preset_eco: "",
    preset_away: "",
    preset_sleep: "",
    pause_switch: "input_boolean.living_paused",
  };
  // Everything in place, so only the automation is left to make.
  const inPlace = [valve, schedule, away, sleep, toggle];

  it("builds the ids and the alias", () => {
    expect(runtimeIds("living").schedule).toBe("schedule.living_climate");
    expect(automationIdFor("area_climate", "living")).toBe("taxis_area_climate_living");
    expect(automationAlias("Living room", "area_climate")).toBe("Living room – Area climate (Taxis)");
    expect(RECIPE_LABEL.area_climate).toBe("Area climate");
  });

  describe("what is missing", () => {
    it("needs a thermostat that counts", () => {
      expect(climate([spots])).toMatchObject({ status: "missing", missing: ["A thermostat that counts (Capabilities)"], actionable: false, inputs: [], notes: [] });
      const h = house([valve]);
      const inv = setCounts(h, EMPTY_INVENTORY, "climate.living_valve", false);
      expect(climate([valve], { inv }).missing).toEqual(["A thermostat that counts (Capabilities)"]);
    });

    it("is judged by the area's own thermostats", () => {
      const cells = plan([valve, { ...tado, id: "climate.kitchen_tado", area: "kitchen" }]);
      expect(cell(cells, "area_climate", "living_room").inputs.length).toBeGreaterThan(0);
      expect(cell(cells, "area_climate", "kitchen").inputs.length).toBeGreaterThan(0);
      expect(autoInput(cell(cells, "area_climate", "kitchen")).climate_entities).toEqual(["climate.kitchen_tado"]);
      expect(autoInput(cell(cells, "area_climate", "living_room")).climate_entities).toEqual(["climate.living_valve"]);
    });

    it("names an id that something else holds: the schedule, the pause switch, the house switches", () => {
      expect(climate([valve, { id: "schedule.living_climate", platform: "demo", name: "Old schedule" }]).missing).toEqual(["schedule.living_climate is already used by “Old schedule”"]);
      expect(climate([valve, { id: "input_boolean.living_paused", platform: "demo", name: "Nope" }]).missing).toEqual(["input_boolean.living_paused is already used by “Nope”"]);
      expect(climate([valve, { id: "input_boolean.taxis_away", platform: "demo", name: "Mine", area: "" }]).missing).toEqual([
        "input_boolean.taxis_away is already used by “Mine”. Pick a switch of your own for away mode (Parameters, House)",
      ]);
    });

    it("refuses a lowest temperature above the highest", () => {
      let p = setParameter(EMPTY_PARAMETERS, { level: "house" }, "min_temp", 25);
      expect(climate([valve], { params: p }).missing).toEqual(["The lowest temperature is above the highest (Parameters, Climate)"]);
      p = setParameter(EMPTY_PARAMETERS, { level: "area", id: "living_room" }, "max_temp", 15);
      expect(climate([valve], { params: p }).status).toBe("missing");
      // Equal is fine.
      p = setParameter(setParameter(EMPTY_PARAMETERS, { level: "house" }, "min_temp", 20), { level: "house" }, "max_temp", 20);
      expect(climate([valve], { params: p }).status).toBe("ready");
    });
  });

  describe("ready", () => {
    it("needs nothing else: it makes the blueprint, the house switches, the pause switch and the schedule, then the automation", () => {
      const c = climate([valve], { installed: { blueprints: {} } });
      expect(c.status).toBe("ready");
      expect(c.actionable).toBe(true);
      expect(kinds(c)).toEqual([
        "blueprint:create:taxis/area_climate.yaml",
        "helper:create:input_boolean",
        "helper:create:input_boolean",
        "helper:create:input_boolean",
        "helper:create:schedule",
        "automation:create:taxis_area_climate_living",
      ]);
      const helper = (id: string) => c.inputs.find((i) => i.fields?.entity_id === id)!.fields;
      // The house switches have no area; the pause switch and the schedule are the area's.
      expect(helper("input_boolean.taxis_away")).toEqual({ helper: "input_boolean", name: "Taxis away mode", entity_id: "input_boolean.taxis_away", icon: "mdi:home-export-outline" });
      expect(helper("input_boolean.taxis_sleep")).toEqual({ helper: "input_boolean", name: "Taxis sleep mode", entity_id: "input_boolean.taxis_sleep", icon: "mdi:sleep" });
      expect(helper("input_boolean.living_paused")).toEqual({ helper: "input_boolean", name: "Living room automations paused", entity_id: "input_boolean.living_paused", area_id: "living_room", icon: "mdi:pause-circle-outline" });
      expect(helper("schedule.living_climate")).toEqual({
        helper: "schedule",
        name: "Living room climate",
        entity_id: "schedule.living_climate",
        area_id: "living_room",
        periods: "Mon-Fri 06:30-08:30 17:00-23:00; Sat-Sun 08:00-23:00",
      });
    });

    it("fills the blueprint from the defaults of the design", () => {
      const c = climate(inPlace);
      expect(c.status).toBe("ready");
      expect(kinds(c)).toEqual(["automation:create:taxis_area_climate_living"]);
      expect(c.inputs[0].fields).toMatchObject({ recipe: "area_climate", area_id: "living_room", alias: "Living room – Area climate (Taxis)", use_blueprint: { path: "taxis/area_climate.yaml" } });
      // The schedule is the user's own, so nothing was written into it.
      expect(autoInput(c)).toEqual({ ...defaults, comfort_periods: "" });
    });

    it("writes the blueprint too only when Home Assistant has none of this version", () => {
      expect(kinds(climate(inPlace, { installed: { blueprints: { [CLIMATE.path]: CLIMATE.version } } }))).toEqual(["automation:create:taxis_area_climate_living"]);
      expect(kinds(climate(inPlace, { installed: { blueprints: { [CLIMATE.path]: CLIMATE.version - 1 } } }))).toEqual(["blueprint:update:taxis/area_climate.yaml", "automation:create:taxis_area_climate_living"]);
    });

    it("all of it passes the change list's own checks", () => {
      for (const specs of [[valve], inPlace, [tado, windows, doors, tempMean, ...runtime]]) {
        const c = climate(specs, { installed: occupancyThere });
        expect(c.inputs.length).toBeGreaterThan(0);
        for (const input of c.inputs) expect(validateInput(input), JSON.stringify(input)).toBeNull();
      }
    });

    it("skips what the change list already holds, and says in changes once the automation is there", () => {
      const queued = [
        change({ kind: "helper", targetId: "input_boolean.taxis_away", after: { entity_id: "input_boolean.taxis_away" } }),
        change({ kind: "helper", targetId: "input_boolean.living_paused", after: { entity_id: "input_boolean.living_paused" } }),
        change({ kind: "helper", targetId: "schedule.living_climate", after: { entity_id: "schedule.living_climate" } }),
        change({ kind: "blueprint", targetId: CLIMATE.path, after: { path: CLIMATE.path, version: CLIMATE.version } }),
      ];
      expect(kinds(climate([valve], { changes: queued }))).toEqual(["helper:create:input_boolean", "automation:create:taxis_area_climate_living"]);
      const withAutomation = [...queued, change({ kind: "automation", targetId: "taxis_area_climate_living", after: {} })];
      expect(climate([valve], { changes: withAutomation })).toMatchObject({ status: "in-changes", actionable: false, inputs: [] });
    });

    it("makes changes that depend on each other so the automation can be applied with only what it needs", () => {
      const c = climate([valve], { installed: { blueprints: {} } });
      const list: Change[] = c.inputs.map((i, n) => ({
        id: n + 1,
        kind: i.kind,
        op: i.op,
        targetId: i.targetId ?? `new:${i.kind}:${n + 1}`,
        scope: null,
        before: {},
        after: i.fields ?? {},
        createdAt: "now",
      }));
      const automation = list.find((x) => x.kind === "automation")!;
      // The blueprint, the three helpers (two house switches, the pause switch) and the schedule.
      expect(closureFor(list, [automation.id]).map((x) => `${x.kind}:${x.op}`)).toEqual(list.map((x) => `${x.kind}:${x.op}`));
      // A helper alone needs nothing.
      const away = list.find((x) => x.after.entity_id === "input_boolean.taxis_away")!;
      expect(closureFor(list, [away.id]).map((x) => x.id)).toEqual([away.id]);
    });

    it("a user's own schedule is used as it is, and Taxis says nothing is written into it", () => {
      const c = climate([valve, schedule, away, sleep, toggle]);
      expect(kinds(c)).toEqual(["automation:create:taxis_area_climate_living"]);
      expect(autoInput(c).comfort_periods).toBe("");
    });
  });

  describe("the house switches", () => {
    it("uses the ones the user picked, and makes none", () => {
      const p = setParameter(setParameter(EMPTY_PARAMETERS, { level: "house" }, "away_mode_entity", "input_boolean.away_mode"), { level: "house" }, "sleep_mode_entity", "input_boolean.sleep_mode");
      const c = climate([valve, schedule, toggle, { id: "input_boolean.away_mode", platform: "input_boolean", area: "" }, { id: "input_boolean.sleep_mode", platform: "input_boolean", area: "" }], { params: p });
      expect(c.status).toBe("ready");
      expect(kinds(c)).toEqual(["automation:create:taxis_area_climate_living"]);
      expect(autoInput(c)).toMatchObject({ away_entity: "input_boolean.away_mode", sleep_entity: "input_boolean.sleep_mode" });
    });

    it("says when a switch the user picked isn't there, or isn't a toggle", () => {
      const p = setParameter(setParameter(EMPTY_PARAMETERS, { level: "house" }, "away_mode_entity", "input_boolean.away_mode"), { level: "house" }, "sleep_mode_entity", "input_boolean.sleep_mode");
      expect(climate([valve], { params: p }).missing).toEqual([
        "The away mode switch “input_boolean.away_mode” isn't in Home Assistant (Parameters, House)",
        "The sleep mode switch “input_boolean.sleep_mode” isn't in Home Assistant (Parameters, House)",
      ]);
      const wrong = climate([valve, { id: "input_boolean.sleep_mode", platform: "input_boolean", area: "" }, { id: "input_boolean.away_mode", platform: "input_boolean", area: "" }], { params: setParameter(p, { level: "house" }, "away_mode_entity", "light.living_spots") });
      expect(wrong.missing).toEqual(["The away mode switch “light.living_spots” isn't in Home Assistant (Parameters, House)"]);
      const notToggle = climate([valve, spots, { id: "input_boolean.sleep_mode", platform: "input_boolean", area: "" }], { params: setParameter(p, { level: "house" }, "away_mode_entity", "light.living_spots") });
      expect(notToggle.missing).toEqual(["The away mode switch “light.living_spots” isn't a toggle (an input boolean)"]);
    });

    it("can differ for an area: a floor's own sleep switch", () => {
      const p = setParameter(EMPTY_PARAMETERS, { level: "area", id: "kitchen" }, "sleep_mode_entity", "input_boolean.kitchen_sleep");
      const cells = plan([valve, { ...tado, id: "climate.kitchen_tado", area: "kitchen" }, { id: "input_boolean.kitchen_sleep", platform: "input_boolean", area: "" }], { params: p });
      expect(autoInput(cell(cells, "area_climate", "kitchen")).sleep_entity).toBe("input_boolean.kitchen_sleep");
      expect(autoInput(cell(cells, "area_climate", "living_room")).sleep_entity).toBe("input_boolean.taxis_sleep");
    });

    it("are made once when two areas are added together", () => {
      const cells = plan([valve, { ...valve, id: "climate.kitchen_valve", area: "kitchen" }]);
      const inputs = recipeChangeInputs([cell(cells, "area_climate", "living_room"), cell(cells, "area_climate", "kitchen")]);
      expect(inputs.filter((i) => i.fields?.entity_id === "input_boolean.taxis_away")).toHaveLength(1);
      expect(inputs.filter((i) => i.fields?.entity_id === "input_boolean.taxis_sleep")).toHaveLength(1);
      expect(inputs.filter((i) => i.kind === "blueprint")).toHaveLength(1);
      // The area's own helpers are still one each.
      expect(inputs.filter((i) => i.fields?.helper === "schedule")).toHaveLength(2);
    });
  });

  describe("what it is told about", () => {
    it("takes the occupied sensor once Occupancy is installed or in the list, and says when it isn't", () => {
      const without = climate(inPlace);
      expect(autoInput(without).occupied_entities).toEqual([]);
      expect(without.notes).toContain("No Occupancy yet, so comfort follows the schedule alone");
      const withOccupancy = climate([...inPlace, occupied], { installed: occupancyThere });
      expect(autoInput(withOccupancy).occupied_entities).toEqual(["binary_sensor.living_occupied"]);
      expect(withOccupancy.notes).not.toContain("No Occupancy yet, so comfort follows the schedule alone");
      const pending = [
        change({ kind: "automation", targetId: "taxis_occupancy_living", after: {} }),
        change({ kind: "helper", targetId: "binary_sensor.living_occupied", after: { entity_id: "binary_sensor.living_occupied" } }),
      ];
      expect(autoInput(climate(inPlace, { changes: pending })).occupied_entities).toEqual(["binary_sensor.living_occupied"]);
      // Occupancy in the list but its sensor nowhere: not named.
      expect(autoInput(climate(inPlace, { changes: pending.slice(0, 1) })).occupied_entities).toEqual([]);
    });

    it("takes the window group in place or in the list, the door group only when open doors count, and the temperature helper", () => {
      expect(autoInput(climate([...inPlace, windows])).opening_entities).toEqual(["binary_sensor.living_windows"]);
      expect(autoInput(climate([...inPlace, windows, doors])).opening_entities).toEqual(["binary_sensor.living_windows"]);
      const doorsCount = setParameter(EMPTY_PARAMETERS, { level: "house" }, "doors_open_count", true);
      expect(autoInput(climate([...inPlace, windows, doors], { params: doorsCount })).opening_entities).toEqual(["binary_sensor.living_windows", "binary_sensor.living_doors"]);
      const queued = [change({ kind: "helper", targetId: "binary_sensor.living_windows", after: { helper: "group", entity_id: "binary_sensor.living_windows" } })];
      expect(autoInput(climate(inPlace, { changes: queued })).opening_entities).toEqual(["binary_sensor.living_windows"]);
      expect(autoInput(climate([...inPlace, tempMean])).temperature_entity).toBe("sensor.living_temperature");
      expect(autoInput(climate(inPlace))).not.toHaveProperty("temperature_entity");
      // A real sensor on the helper's id isn't the helper.
      expect(autoInput(climate([...inPlace, { ...tempMean, platform: "demo" }]))).not.toHaveProperty("temperature_entity");
      expect(autoInput(climate([...inPlace, { ...windows, platform: "demo" }])).opening_entities).toEqual([]);
    });

    it("says when windows or doors are counted but their group isn't made, and when the room can't be checked", () => {
      const window = { id: "binary_sensor.living_window", dc: "window" };
      expect(climate([...inPlace, window]).notes).toContain("The window group isn't made yet, so open windows are not seen (Helpers tab)");
      expect(climate([...inPlace, window, windows]).notes).not.toContain("The window group isn't made yet, so open windows are not seen (Helpers tab)");
      const door = { id: "binary_sensor.living_door", dc: "door" };
      const doorsCount = setParameter(EMPTY_PARAMETERS, { level: "house" }, "doors_open_count", true);
      expect(climate([...inPlace, door], { params: doorsCount }).notes).toContain("The door group isn't made yet, so open doors are not seen (Helpers tab)");
      expect(climate([...inPlace, door]).notes.join(" ")).not.toMatch(/door group/);
      const auto = setParameter(EMPTY_PARAMETERS, { level: "house" }, "auto_hvac_on", true);
      expect(climate(inPlace, { params: auto }).notes).toContain("No temperature helper yet, so a thermostat is switched on without checking the room (Helpers tab)");
      expect(climate([...inPlace, tempMean], { params: auto }).notes.join(" ")).not.toMatch(/temperature helper/);
      expect(climate(inPlace).notes.join(" ")).not.toMatch(/temperature helper/);
    });

    it("passes the bed sensors of a bedroom and says so, and a bedroom doesn't need anyone in it for comfort unless told", () => {
      const bedSensor = { id: "binary_sensor.living_bed", dc: "occupancy" };
      let inv = setBed(EMPTY_INVENTORY, "binary_sensor.living_bed", true);
      // Not a bedroom: no bed sensors, comfort needs occupancy.
      expect(autoInput(climate([...inPlace, bedSensor], { inv }))).toMatchObject({ bed_entities: [], is_bedroom: false, comfort_needs_occupancy: true });
      inv = setBedroom(inv, "living_room", true);
      const c = climate([...inPlace, bedSensor], { inv });
      expect(autoInput(c)).toMatchObject({ bed_entities: ["binary_sensor.living_bed"], is_bedroom: true, comfort_needs_occupancy: false });
      expect(c.notes).toContain("A bedroom: comfort doesn't need anyone in the room unless you set it to");
      // Told otherwise at the house, interior or area level, it is: a choice is a choice.
      for (const scope of [{ level: "house" }, { level: "type", id: "interior" }, { level: "area", id: "living_room" }] as const) {
        const p = setParameter(EMPTY_PARAMETERS, scope, "comfort_needs_occupancy", true);
        const told = climate([...inPlace, bedSensor], { inv, params: p });
        expect(autoInput(told).comfort_needs_occupancy, JSON.stringify(scope)).toBe(true);
        expect(told.notes).not.toContain("A bedroom: comfort doesn't need anyone in the room unless you set it to");
      }
      // And a room that isn't a bedroom can be told it doesn't need anyone.
      const none = setParameter(EMPTY_PARAMETERS, { level: "area", id: "living_room" }, "comfort_needs_occupancy", false);
      expect(autoInput(climate(inPlace, { params: none })).comfort_needs_occupancy).toBe(false);
    });

    it("uses the parameters: temperatures, delays, season, switching, presets and the night window", () => {
      let p = setParameter(EMPTY_PARAMETERS, { level: "house" }, "comfort_temp", 22);
      p = setParameter(p, { level: "area", id: "living_room" }, "eco_temp", 17.5);
      p = setParameter(p, { level: "type", id: "interior" }, "window_delay", 5);
      p = setParameter(p, { level: "type", id: "interior" }, "restore_delay", 3);
      p = setParameter(p, { level: "house" }, "night_start", "22:30");
      p = setParameter(p, { level: "house" }, "season", "cooling");
      p = setParameter(p, { level: "house" }, "auto_hvac_on", true);
      p = setParameter(p, { level: "house" }, "preset_eco", "Eco");
      p = setParameter(p, { level: "house" }, "eco_after_clear", 45);
      p = setParameter(p, { level: "house" }, "cool_comfort_temp", 23.5);
      p = setParameter(p, { level: "area", id: "living_room" }, "cool_away_temp", 30);
      // Cooling runs the AC; the valve is left out.
      expect(autoInput(climate([ac, ...inPlace], { params: p }))).toEqual({
        ...defaults,
        climate_entities: ["climate.living_ac"],
        cool_comfort_temp: 23.5,
        cool_away_temp: 30,
        comfort_periods: "",
        comfort_temp: 22,
        eco_temp: 17.5,
        window_delay: 5,
        restore_delay: 3,
        night_start: "22:30:00",
        season: "cooling",
        auto_hvac_on: true,
        preset_eco: "Eco",
        eco_after_clear: 45,
      });
    });

    it("fills the cooling temperatures with their own defaults", () => {
      const c = autoInput(climate([ac, schedule, away, sleep, toggle]));
      expect([c.cool_comfort_temp, c.cool_eco_temp, c.cool_night_temp, c.cool_away_temp]).toEqual([24, 27, 25, 29]);
      expect(validateInput(climate([ac, schedule, away, sleep, toggle]).inputs[0])).toBeNull();
    });

    it("writes the comfort periods in one spelling", () => {
      const p = setParameter(EMPTY_PARAMETERS, { level: "area", id: "living_room" }, "comfort_periods", "sat-sun 08:00-23:00;  mon-fri 17:00-22:00");
      expect(autoInput(climate(inPlace.filter((s) => s !== schedule), { params: p })).comfort_periods).toBe("Mon-Fri 17:00-22:00; Sat-Sun 08:00-23:00");
      const create = climate([valve], { params: p }).inputs.find((i) => i.fields?.helper === "schedule")!;
      expect(create.fields!.periods).toBe("Mon-Fri 17:00-22:00; Sat-Sun 08:00-23:00");
    });
  });

  describe("the kinds of climate entity", () => {
    const cooling = setParameter(EMPTY_PARAMETERS, { level: "house" }, "season", "cooling");
    const everything = [ac, valve, tado, schedule, away, sleep, toggle];

    it("runs every kind that counts in the heating season", () => {
      const c = climate(everything);
      expect(autoInput(c).climate_entities).toEqual(["climate.living_ac", "climate.living_tado", "climate.living_valve"]);
      expect(c.notes.join(" ")).not.toMatch(/Not run while cooling/);
    });

    it("runs only the AC in the cooling season, and says what it left out", () => {
      const c = climate(everything, { params: cooling });
      expect(c.status).toBe("ready");
      expect(autoInput(c).climate_entities).toEqual(["climate.living_ac"]);
      expect(c.notes).toContain("Not run while cooling: Radiator valve (heating), Tado (heating)");
      // Every note about a thermostat is about one that is run.
      expect(c.notes.join(" ")).not.toMatch(/^Tado:/m);
    });

    it("reads a valve as a valve, and leaves it out of the cooling season as well", () => {
      const h = house(everything);
      const inv = setClimateKind(h, EMPTY_INVENTORY, "climate.living_valve", "valve");
      const c = climate(everything, { params: cooling, inv });
      expect(c.notes).toContain("Not run while cooling: Radiator valve (valve), Tado (heating)");
      expect(autoInput(climate(everything, { inv })).climate_entities).toContain("climate.living_valve");
    });

    it("runs an AC set to heating no more in the cooling season, and a heater set to AC again", () => {
      const h = house(everything);
      let inv = setClimateKind(h, EMPTY_INVENTORY, "climate.living_ac", "heating");
      expect(climate(everything, { params: cooling, inv }).missing).toEqual(["An air conditioner that counts: heating and radiator valves are not run in the cooling season (Capabilities)"]);
      inv = setClimateKind(h, setClimateKind(h, EMPTY_INVENTORY, "climate.living_valve", "ac"), "climate.living_ac", "heating");
      expect(autoInput(climate(everything, { params: cooling, inv })).climate_entities).toEqual(["climate.living_valve"]);
    });

    it("says an air conditioner is missing when only heating counts in the cooling season", () => {
      const c = climate([valve, schedule, away, sleep, toggle], { params: cooling });
      expect(c).toMatchObject({ status: "missing", actionable: false, inputs: [] });
      expect(c.missing).toEqual(["An air conditioner that counts: heating and radiator valves are not run in the cooling season (Capabilities)"]);
    });

    it("leaves a thermostat that doesn't count out of both, and does not call it skipped", () => {
      const h = house(everything);
      const inv = setCounts(h, EMPTY_INVENTORY, "climate.living_valve", false);
      const c = climate(everything, { params: cooling, inv });
      expect(c.notes).toContain("Not run while cooling: Tado (heating)");
    });

    it("sees a change of season as a change of the thermostats it controls", () => {
      const installed = {
        blueprints: BLUEPRINTS_THERE,
        automations: { taxis_area_climate_living: { alias: "Living room – Area climate (Taxis)", path: CLIMATE.path, input: { ...defaults, climate_entities: ["climate.living_ac", "climate.living_valve"] } } },
      };
      const c = climate([ac, valve, schedule, away, sleep, toggle], { installed, params: cooling });
      expect(c.status).toBe("out-of-date");
      expect(c.reasons.join(" ")).toMatch(/Thermostats: climate.living_ac, climate.living_valve → climate.living_ac/);
    });

    it("offers presets of the AC itself", () => {
      const p = setParameter(setParameter(EMPTY_PARAMETERS, { level: "house" }, "season", "cooling"), { level: "house" }, "preset_comfort", "comfort");
      const c = climate([ac, schedule, away, sleep, toggle], { params: p });
      expect(c.notes).toContain("Living AC: presets for comfort, temperatures for the rest");
      expect(autoInput(c).preset_comfort).toBe("comfort");
    });
  });

  describe("which thermostats use presets and which temperatures", () => {
    const presets = (over: Record<string, string> = {}) =>
      Object.entries({ preset_comfort: "comfort", preset_eco: "eco", preset_away: "away", preset_sleep: "sleep", ...over }).reduce((p, [k, v]) => setParameter(p, { level: "house" }, k as "preset_eco", v), EMPTY_PARAMETERS);

    it("names every thermostat and says temperatures when no preset is mapped", () => {
      const c = climate([...inPlace, tado]);
      expect(autoInput(c).climate_entities).toEqual(["climate.living_tado", "climate.living_valve"]);
      expect(c.notes.filter((n) => /^(Tado|Radiator valve):/.test(n))).toEqual(["Tado: temperatures", "Radiator valve: temperatures"]);
    });

    it("says presets for the thermostat that offers all four, temperatures for the valve", () => {
      const c = climate([...inPlace, tado], { params: presets() });
      expect(c.notes.filter((n) => /^(Tado|Radiator valve):/.test(n))).toEqual(["Tado: presets", "Radiator valve: temperatures"]);
    });

    it("says which of the four a thermostat doesn't offer, and that it gets temperatures for those", () => {
      const c = climate([...inPlace, tado], { params: presets({ preset_eco: "economy", preset_away: "" }) });
      expect(c.notes).toContain("Tado: presets for comfort, sleep, temperatures for the rest");
      expect(c.notes).toContain("Tado doesn't offer “economy” (eco); it gets temperatures for that");
      // A thermostat that reports no presets at all has nothing to say about them.
      expect(c.notes.join(" ")).not.toMatch(/Radiator valve doesn't offer/);
      expect(autoInput(c)).toMatchObject({ preset_comfort: "comfort", preset_eco: "economy", preset_away: "", preset_sleep: "sleep" });
    });

    it("keeps the notes off a recipe that can't be added", () => {
      expect(climate([spots]).notes).toEqual([]);
    });

    it("says when the season is off", () => {
      const p = setParameter(EMPTY_PARAMETERS, { level: "house" }, "season", "off");
      expect(climate(inPlace, { params: p }).notes).toContain("The season is off, so the recipe does nothing");
    });
  });

  describe("the comfort schedule", () => {
    const installedWith = (input: Record<string, unknown>) => ({
      blueprints: BLUEPRINTS_THERE,
      automations: { taxis_area_climate_living: { alias: "Living room – Area climate (Taxis)", path: CLIMATE.path, input } },
    });

    it("is installed when everything matches", () => {
      expect(climate(inPlace, { installed: installedWith(defaults) })).toMatchObject({ status: "installed", inputs: [], reasons: [] });
    });

    it("updates a schedule Taxis made when the periods setting changed, and says how", () => {
      const p = setParameter(EMPTY_PARAMETERS, { level: "house" }, "comfort_periods", "Mon-Fri 18:00-22:00");
      const c = climate(inPlace, { installed: installedWith(defaults), params: p });
      expect(c.status).toBe("out-of-date");
      expect(c.reasons).toEqual(["Comfort periods: Mon-Fri 06:30-08:30 17:00-23:00; Sat-Sun 08:00-23:00 → Mon-Fri 18:00-22:00"]);
      expect(kinds(c)).toEqual(["helper:update:schedule.living_climate", "automation:update:taxis_area_climate_living"]);
      expect(c.inputs[0]).toEqual({ kind: "helper", op: "update", targetId: "schedule.living_climate", fields: { periods: "Mon-Fri 18:00-22:00" } });
      expect(autoInput(c).comfort_periods).toBe("Mon-Fri 18:00-22:00");
      for (const input of c.inputs) expect(validateInput(input)).toBeNull();
      // The same spelled differently is the same periods.
      const same = setParameter(EMPTY_PARAMETERS, { level: "house" }, "comfort_periods", "Sat-Sun 08:00-23:00; Mon-Fri 17:00-23:00 06:30-08:30");
      expect(climate(inPlace, { installed: installedWith(defaults), params: same }).status).toBe("installed");
    });

    it("asks for the update once", () => {
      const p = setParameter(EMPTY_PARAMETERS, { level: "house" }, "comfort_periods", "Mon-Fri 18:00-22:00");
      const queued = [change({ kind: "helper", op: "update", targetId: "schedule.living_climate", after: { periods: "Mon-Fri 18:00-22:00" } })];
      expect(kinds(climate(inPlace, { installed: installedWith(defaults), params: p, changes: queued }))).toEqual(["automation:update:taxis_area_climate_living"]);
    });

    it("never writes into a schedule the user brought", () => {
      const p = setParameter(EMPTY_PARAMETERS, { level: "house" }, "comfort_periods", "Mon-Fri 18:00-22:00");
      const mine = { ...defaults, comfort_periods: "" };
      const c = climate(inPlace, { installed: installedWith(mine), params: p });
      expect(c.status).toBe("installed");
      expect(c.inputs).toEqual([]);
    });

    it("makes the schedule again when it is gone", () => {
      const c = climate([valve, away, sleep, toggle], { installed: installedWith(defaults) });
      expect(c.status).toBe("out-of-date");
      expect(c.reasons).toEqual(["schedule.living_climate is missing"]);
      expect(kinds(c)).toEqual(["helper:create:schedule", "automation:update:taxis_area_climate_living"]);
    });

    it("is out of date for the pause switch gone, and for another blueprint version", () => {
      expect(climate([valve, schedule, away, sleep], { installed: installedWith(defaults) }).reasons).toEqual(["input_boolean.living_paused is missing"]);
      const old = climate(inPlace, { installed: { ...installedWith(defaults), blueprints: { [CLIMATE.path]: 0 } } });
      expect(old.reasons).toEqual([`The blueprint is version 0, Taxis has ${CLIMATE.version}`]);
      expect(kinds(old)).toEqual(["blueprint:update:taxis/area_climate.yaml", "automation:update:taxis_area_climate_living"]);
    });
  });

  describe("installed and out of date", () => {
    const installedWith = (input: Record<string, unknown>) => ({
      blueprints: BLUEPRINTS_THERE,
      automations: { taxis_area_climate_living: { alias: "Living room – Area climate (Taxis)", path: CLIMATE.path, input } },
    });

    it("sees a thermostat added, a window group appearing and Occupancy installed", () => {
      const added = climate([...inPlace, tado], { installed: installedWith(defaults) });
      expect(added.status).toBe("out-of-date");
      expect(added.reasons).toEqual(["Thermostats: climate.living_valve → climate.living_tado, climate.living_valve"]);
      const group = climate([...inPlace, windows], { installed: installedWith(defaults) });
      expect(group.reasons).toEqual(["Windows and doors: none → binary_sensor.living_windows"]);
      const occ = climate([...inPlace, occupied], { installed: { ...occupancyThere, ...installedWith(defaults), automations: { ...occupancyThere.automations, ...installedWith(defaults).automations } } });
      expect(occ.reasons).toEqual(["Occupied sensor: none → binary_sensor.living_occupied"]);
    });

    it("sees a changed parameter, a changed preset and a changed switch", () => {
      const p = setParameter(setParameter(EMPTY_PARAMETERS, { level: "house" }, "comfort_temp", 22), { level: "house" }, "auto_hvac_on", true);
      expect(climate(inPlace, { installed: installedWith(defaults), params: p }).reasons).toEqual(["Switch thermostats on and off: false → true", "Comfort temperature: 21 → 22"]);
      const q = setParameter(EMPTY_PARAMETERS, { level: "house" }, "preset_away", "Away");
      expect(climate(inPlace, { installed: installedWith(defaults), params: q }).reasons).toEqual(["Away preset: none → Away"]);
    });

    it("is out of date when the area was renamed, or the automation isn't from the blueprint", () => {
      const renamed = { blueprints: BLUEPRINTS_THERE, automations: { taxis_area_climate_living: { alias: "Lounge – Area climate (Taxis)", path: CLIMATE.path, input: defaults } } };
      expect(climate(inPlace, { installed: renamed }).reasons).toEqual(["Name: Lounge – Area climate (Taxis) → Living room – Area climate (Taxis)"]);
      const other = { blueprints: BLUEPRINTS_THERE, automations: { taxis_area_climate_living: { alias: "Living room – Area climate (Taxis)", path: "other/x.yaml", input: defaults } } };
      expect(climate(inPlace, { installed: other }).reasons).toEqual(["It isn't made from the Taxis blueprint"]);
    });

    it("an input a later version adds is a difference, and one it drops is named", () => {
      const { frost_temp: _frost, ...older } = defaults;
      expect(climate(inPlace, { installed: installedWith({ ...older, legacy: 1 }) }).reasons).toEqual(["Frost protection temperature: none → 7", "legacy: not used any more"]);
    });
  });

  describe("other automations on the same thermostats", () => {
    it("warns, without blocking, and says it is thermostats", () => {
      const controllers = { "climate.living_valve": [{ entityId: "automation.heating_schedule", name: "Heating schedule" }], "climate.other": [{ entityId: "automation.x", name: "X" }] };
      const c = climate(inPlace, { installed: { controllers } });
      expect(c.status).toBe("ready");
      expect(c.actionable).toBe(true);
      expect(c.controls).toBe("thermostats");
      expect(c.controlledBy).toEqual([{ entityId: "automation.heating_schedule", name: "Heating schedule" }]);
      // The same automation on two thermostats is listed once.
      const both = { "climate.living_valve": controllers["climate.living_valve"], "climate.living_tado": controllers["climate.living_valve"] };
      expect(climate([...inPlace, tado], { installed: { controllers: both } }).controlledBy).toHaveLength(1);
      // Nothing is said while it can't be installed anyway; the lights recipes say lights.
      expect(climate([spots], { installed: { controllers } }).controlledBy).toEqual([]);
      expect(cell(plan(inPlace), "motion_lights").controls).toBe("lights");
    });
  });

  describe("the change list accepts what it asks for", () => {
    const schedule = (over: Record<string, unknown> = {}): ChangeInput => ({
      kind: "helper",
      op: "create",
      fields: { helper: "schedule", name: "Living room climate", entity_id: "schedule.living_climate", area_id: "living_room", periods: "Mon-Fri 06:30-08:30", ...over },
    });
    const houseSwitch = (over: Record<string, unknown> = {}): ChangeInput => ({
      kind: "helper",
      op: "create",
      fields: { helper: "input_boolean", name: "Taxis away mode", entity_id: "input_boolean.taxis_away", icon: "mdi:home-export-outline", ...over },
    });

    it("takes a schedule with its periods, in its own domain, with nothing else", () => {
      expect(validateInput(schedule())).toBeNull();
      expect(validateInput(schedule({ periods: "Mon-Fri 17:00-23:00; Sat-Sun 08:00-23:00" }))).toBeNull();
      for (const periods of ["", "Mon", "Mon-Fri 25:00-26:00", "Mon 09:00-08:00", 5, null, "x".repeat(400)]) expect(validateInput(schedule({ periods })), String(periods)).toMatch(/wouldn't accept/);
      expect(validateInput(schedule({ entity_id: "timer.living_climate" }))).toMatch(/has to start with “schedule\.”/);
      expect(validateInput({ kind: "helper", op: "create", fields: { helper: "schedule", name: "x", entity_id: "schedule.x", area_id: "a" } })).toMatch(/needs its periods/);
      expect(validateInput(schedule({ duration: 60 }))).toMatch(/can't be set on a schedule/);
      expect(validateInput(schedule({ entities: ["light.a"] }))).toMatch(/can't be set on a schedule/);
      expect(validateInput({ kind: "helper", op: "create", fields: { helper: "timer", name: "x", entity_id: "timer.x", area_id: "a", duration: 60, periods: "Mon 08:00-09:00" } })).toMatch(/can't be set on a timer/);
      expect(validateInput({ kind: "helper", op: "create", fields: { helper: "group", group_type: "light", name: "x", entity_id: "light.x", entities: ["light.a"], area_id: "a", periods: "Mon 08:00-09:00" } })).toMatch(/Only a timer/);
    });

    it("changes a schedule's periods, and nothing else about it", () => {
      expect(validateInput({ kind: "helper", op: "update", targetId: "schedule.living_climate", fields: { periods: "Mon 08:00-09:00" } })).toBeNull();
      expect(validateInput({ kind: "helper", op: "update", targetId: "schedule.living_climate", fields: { periods: "nope" } })).toMatch(/wouldn't accept/);
      expect(validateInput({ kind: "helper", op: "update", targetId: "schedule.living_climate", fields: { periods: "Mon 08:00-09:00", name: "x" } })).toMatch(/only change its members, a timer's duration or a schedule's periods/);
      expect(validateInput({ kind: "helper", op: "update", targetId: "schedule.living_climate", fields: { name: "x" } })).toMatch(/only change its members, a timer's duration or a schedule's periods/);
      expect(validateInput({ kind: "helper", op: "delete", targetId: "schedule.living_climate" })).toMatch(/not deleted/);
    });

    it("takes the house's two switches with no area, and only those", () => {
      expect(validateInput(houseSwitch())).toBeNull();
      expect(validateInput(houseSwitch({ name: "Taxis sleep mode", entity_id: "input_boolean.taxis_sleep" }))).toBeNull();
      expect(validateInput(houseSwitch({ area_id: "living_room" }))).toMatch(/have no area/);
      // Any other toggle needs its area.
      expect(validateInput(houseSwitch({ entity_id: "input_boolean.guest_mode" }))).toMatch(/needs an area/);
      expect(validateInput(houseSwitch({ entity_id: "input_boolean.taxis_other" }))).toMatch(/needs an area/);
      expect(validateInput(houseSwitch({ entity_id: "input_boolean.living_paused", area_id: "living_room" }))).toBeNull();
      // A timer cannot take the house id.
      expect(validateInput({ kind: "helper", op: "create", fields: { helper: "timer", name: "x", entity_id: "timer.taxis_away", duration: 60 } })).toMatch(/needs an area/);
    });

    it("takes the climate automation with its blueprint and inputs, and no other recipe's", () => {
      const c = climate(inPlace);
      expect(validateInput(c.inputs[0])).toBeNull();
      const fields = c.inputs[0].fields as { use_blueprint: { path: string; input: Record<string, unknown> } };
      expect(validateInput({ ...c.inputs[0], fields: { ...fields, use_blueprint: { path: OCC.path, input: fields.use_blueprint.input } } })).toMatch(/another blueprint|wouldn't accept/);
      expect(validateInput({ ...c.inputs[0], fields: { ...fields, use_blueprint: { path: CLIMATE.path, input: { ...fields.use_blueprint.input, season: "auto" } } } })).toMatch(/wouldn't accept/);
      expect(validateInput({ ...c.inputs[0], fields: { ...fields, automation_id: "taxis_occupancy_living" } })).toMatch(/taxis_<recipe>_<area code>/);
    });
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
    expect(validateInput({ kind: "helper", op: "update", targetId: "timer.living_hold", fields: { duration: 480, name: "x" } })).toMatch(/only change its members, a timer's duration or a schedule's periods/);
    expect(validateInput({ kind: "helper", op: "update", targetId: "timer.living_hold", fields: { name: "x" } })).toMatch(/only change its members, a timer's duration or a schedule's periods/);
    expect(validateInput({ kind: "helper", op: "update", targetId: "timer.living_hold", fields: { duration: 480, entities: ["light.a"] } })).toMatch(/only change its members, a timer's duration or a schedule's periods/);
    expect(validateInput({ kind: "helper", op: "update", targetId: "timer.living_hold", fields: { duration: 5 } })).toMatch(/wouldn't accept/);
    expect(validateInput({ kind: "helper", op: "delete", targetId: "timer.living_hold" })).toMatch(/not deleted/);
  });
});

// ---------------------------------------------------------------------------
// The recipes after Area climate: Bathroom fan, Exterior lights, Left open,
// Appliance done, and Announce for the house.
// ---------------------------------------------------------------------------

const ALL_THERE = {
  ...BLUEPRINTS_THERE,
  ...Object.fromEntries(BLUEPRINTS.map((b) => [b.path, b.version])),
};
const kindsOf = (c: RecipeCell) => c.inputs.map((i) => `${i.kind}:${i.op}:${i.fields?.helper ?? i.fields?.path ?? i.fields?.automation_id ?? i.fields?.script_id ?? i.targetId}`);
const setHouse = (p: ParameterSettings, key: Parameters<typeof setParameter>[2], value: Parameters<typeof setParameter>[3]) => setParameter(p, { level: "house" }, key, value);

describe("the humidity rate sensor", () => {
  it("has its own id, which no helper name may take", () => {
    expect(runtimeIds("living").rate).toBe("sensor.living_humidity_rate");
    expect(RECIPE_HELPER_SUFFIX.humidityRate).toBe("humidity_rate");
    expect(helperNameErrors({ humidity: "humidity_rate" }).humidity).toMatch(/humidity rate sensor/);
    expect(helperNameErrors({ humidity: "humid" })).toEqual({});
    // A binary sensor group may use the word: its domain differs.
    expect(helperNameErrors({ motion: "humidity_rate" })).toEqual({});
  });
});

describe("bathroom fan", () => {
  const hygro = { id: "sensor.living_hygro", dc: "humidity", state: "55", attrs: { unit_of_measurement: "%" } };
  const humidityMean = { id: "sensor.living_humidity", platform: "min_max", dc: "humidity", state: "55", entry: "HUM1" };
  const extractor = { id: "fan.living_extractor" };
  const plug = { id: "switch.living_fan_plug" };
  const rateSensor = { id: "sensor.living_humidity_rate", platform: "derivative", state: "0", entry: "RATE1" };
  const sleepSwitch = { id: "input_boolean.taxis_sleep", platform: "input_boolean", area: "" };
  const fan = (specs: Spec[], o: Opts = {}) => cell(plan(specs, { ...o, installed: { blueprints: ALL_THERE, ...o.installed } }), "bathroom_fan");
  // Everything in place, so only the automation is left.
  const inPlace = [hygro, humidityMean, extractor, rateSensor, toggle];

  const defaults = {
    humidity_entity: "sensor.living_humidity",
    rate_entity: "sensor.living_humidity_rate",
    fan_entities: ["fan.living_extractor"],
    rate_on: 0.03,
    delta_on: 10,
    abs_on: 80,
    delta_off: 3,
    flat_rate: 0.001,
    flat_minutes: 20,
    max_minutes: 60,
    suppress_in_sleep: false,
    pause_switch: "input_boolean.living_paused",
  };
  const installedWith = (input: Record<string, unknown>) => ({
    automations: { taxis_bathroom_fan_living: { alias: "Living room – Bathroom fan (Taxis)", path: "taxis/bathroom_fan.yaml", input } },
  });

  it("is named like the others", () => {
    expect(automationIdFor("bathroom_fan", "living")).toBe("taxis_bathroom_fan_living");
    expect(automationAlias("Living room", "bathroom_fan")).toBe("Living room – Bathroom fan (Taxis)");
    expect(RECIPE_LABEL.bathroom_fan).toBe("Bathroom fan");
  });

  describe("what is missing", () => {
    it("needs a humidity sensor that counts, and a fan", () => {
      expect(fan([spots])).toMatchObject({
        status: "missing",
        missing: ["A humidity sensor that counts (Capabilities)", "A fan, or a switch marked as a fan (Capabilities)"],
        actionable: false,
        inputs: [],
      });
      const h = house([hygro]);
      expect(fan([hygro, extractor], { inv: setCounts(h, EMPTY_INVENTORY, hygro.id, false) }).missing).toEqual(["A humidity sensor that counts (Capabilities)"]);
    });

    it("needs the humidity helper to be there, or already in the change list", () => {
      expect(fan([hygro, extractor]).missing).toEqual(["The humidity helper (Helpers tab)"]);
      const pending = [change({ kind: "helper", targetId: "sensor.living_humidity", after: { helper: "min_max", entity_id: "sensor.living_humidity" } })];
      expect(fan([hygro, extractor], { changes: pending }).status).toBe("ready");
      // ...or a group renamed to that id.
      const renamed = [change({ kind: "entity", op: "update", targetId: "sensor.old", after: { new_entity_id: "sensor.living_humidity" } })];
      expect(fan([hygro, extractor], { changes: renamed }).status).toBe("ready");
    });

    it("counts a fan by default, and a switch only when it is marked", () => {
      const h = house([hygro, humidityMean, plug]);
      expect(fan([hygro, humidityMean, plug]).missing).toEqual(["A fan, or a switch marked as a fan (Capabilities)"]);
      const marked = setCounts(h, EMPTY_INVENTORY, plug.id, true);
      const c = fan([hygro, humidityMean, plug], { inv: marked });
      expect(c.status).toBe("ready");
      expect(autoInput(c).fan_entities).toEqual(["switch.living_fan_plug"]);
      // Both: sorted.
      expect(autoInput(fan([hygro, humidityMean, plug, extractor], { inv: marked })).fan_entities).toEqual(["fan.living_extractor", "switch.living_fan_plug"]);
    });

    it("names an id something else sits on, for the rate sensor and the pause switch", () => {
      expect(fan([hygro, humidityMean, extractor, { id: "sensor.living_humidity_rate", platform: "demo", name: "Old rate" }]).missing).toEqual(["sensor.living_humidity_rate is already used by “Old rate”"]);
      // A derivative helper made in YAML isn't ours to edit.
      expect(fan([hygro, humidityMean, extractor, { ...rateSensor, entry: undefined }]).missing[0]).toMatch(/sensor.living_humidity_rate is already used/);
      expect(fan([hygro, humidityMean, extractor, { id: "input_boolean.living_paused", platform: "demo" }]).missing[0]).toMatch(/input_boolean.living_paused is already used/);
    });

    it("needs the reference sensor to exist, when one is chosen", () => {
      const p = setHouse(EMPTY_PARAMETERS, "fan_reference", "sensor.hall_humidity");
      expect(fan(inPlace, { params: p }).missing).toEqual(["The reference humidity sensor “sensor.hall_humidity” isn't in Home Assistant (Parameters, Bathroom fan)"]);
      expect(fan([...inPlace, { id: "sensor.hall_humidity", dc: "humidity", area: "kitchen" }], { params: p }).status).toBe("ready");
    });
  });

  describe("ready", () => {
    it("makes the pause switch, the rate sensor and the automation, after the blueprint, in this order", () => {
      const c = fan([hygro, humidityMean, extractor], { installed: { blueprints: {} } });
      expect(c.status).toBe("ready");
      expect(kindsOf(c)).toEqual([
        "blueprint:create:taxis/bathroom_fan.yaml",
        "helper:create:input_boolean",
        "helper:create:derivative",
        "automation:create:taxis_bathroom_fan_living",
      ]);
      expect(c.inputs.find((i) => i.fields?.helper === "derivative")!.fields).toEqual({
        helper: "derivative",
        name: "Living room humidity rate",
        entity_id: "sensor.living_humidity_rate",
        entities: ["sensor.living_humidity"],
        area_id: "living_room",
      });
      for (const input of c.inputs) expect(validateInput(input), JSON.stringify(input).slice(0, 80)).toBeNull();
    });

    it("writes the thresholds of the design as inputs, with no reference and the pause switch", () => {
      const c = fan(inPlace);
      expect(autoInput(c)).toEqual(defaults);
      // No reference: the note says what that means.
      expect(c.notes[0]).toMatch(/No reference humidity sensor.*back near where it started/);
    });

    it("skips what is in place or already in the list", () => {
      expect(kindsOf(fan(inPlace))).toEqual(["automation:create:taxis_bathroom_fan_living"]);
      const pending = [
        change({ kind: "helper", targetId: "sensor.living_humidity_rate", after: { helper: "derivative", entity_id: "sensor.living_humidity_rate" } }),
        change({ kind: "helper", targetId: "input_boolean.living_paused", after: { helper: "input_boolean", entity_id: "input_boolean.living_paused" } }),
        change({ kind: "blueprint", targetId: "taxis/bathroom_fan.yaml", after: { path: "taxis/bathroom_fan.yaml", version: 1 } }),
      ];
      expect(kindsOf(fan([hygro, humidityMean, extractor], { changes: pending, installed: { blueprints: {} } }))).toEqual(["automation:create:taxis_bathroom_fan_living"]);
      expect(kindsOf(fan([hygro, humidityMean, extractor], { installed: { blueprints: {} } }))[0]).toBe("blueprint:create:taxis/bathroom_fan.yaml");
    });

    it("takes the parameters, the most specific first, and the reference when one is chosen", () => {
      let p = setHouse(EMPTY_PARAMETERS, "fan_rate_on", 0.05);
      p = setParameter(p, { level: "area", id: "living_room" }, "fan_delta_on", 12);
      p = setParameter(p, { level: "type", id: "interior" }, "fan_abs_on", 75);
      p = setHouse(p, "fan_delta_off", 2);
      p = setHouse(p, "fan_flat_minutes", 15);
      p = setHouse(p, "fan_max_minutes", 45);
      p = setHouse(p, "fan_reference", "sensor.hall_humidity");
      const c = fan([...inPlace, { id: "sensor.hall_humidity", dc: "humidity", area: "kitchen" }], { params: p });
      expect(autoInput(c)).toEqual({ ...defaults, rate_on: 0.05, delta_on: 12, abs_on: 75, delta_off: 2, flat_minutes: 15, max_minutes: 45, reference_entity: "sensor.hall_humidity" });
      expect(c.notes.some((n) => /No reference/.test(n))).toBe(false);
    });

    it("with the sleep option, gives the sleep switch, and makes the house one when there is none", () => {
      const p = setHouse(EMPTY_PARAMETERS, "fan_suppress_in_sleep", true);
      const c = fan(inPlace, { params: p });
      expect(autoInput(c)).toMatchObject({ suppress_in_sleep: true, sleep_entity: "input_boolean.taxis_sleep" });
      const made = c.inputs.find((i) => i.fields?.entity_id === "input_boolean.taxis_sleep")!;
      expect(made.fields).toEqual({ helper: "input_boolean", name: "Taxis sleep mode", entity_id: "input_boolean.taxis_sleep", icon: "mdi:sleep" });
      // ...which has no area, and is not made again once it is there.
      expect(validateInput(made)).toBeNull();
      expect(fan([...inPlace, sleepSwitch], { params: p }).inputs.some((i) => i.fields?.entity_id === "input_boolean.taxis_sleep")).toBe(false);
      // The user's own switch is used as it is; one that isn't there stops it.
      const own = setHouse(p, "sleep_mode_entity", "input_boolean.night");
      const withOwn = fan([...inPlace, { id: "input_boolean.night", platform: "input_boolean", area: "" }], { params: own });
      expect(withOwn.inputs.some((i) => i.fields?.helper === "input_boolean")).toBe(false);
      expect(autoInput(withOwn).sleep_entity).toBe("input_boolean.night");
      expect(fan(inPlace, { params: own }).missing).toEqual(["The sleep mode switch “input_boolean.night” isn't in Home Assistant (Parameters, House)"]);
    });

    it("shares the house switches with Area climate: they are made once", () => {
      const p = setHouse(EMPTY_PARAMETERS, "fan_suppress_in_sleep", true);
      const cells = plan([...inPlace, { id: "climate.living_valve", state: "heat" }], { params: p, installed: { blueprints: ALL_THERE } });
      const chosen = [cell(cells, "area_climate"), cell(cells, "bathroom_fan")];
      const creates = recipeChangeInputs(chosen).filter((i) => i.fields?.entity_id === "input_boolean.taxis_sleep");
      expect(creates).toHaveLength(1);
    });
  });

  describe("installed and out of date", () => {
    it("is installed when the automation, the rate sensor and the blueprint all match", () => {
      expect(fan(inPlace, { installed: installedWith(defaults) })).toMatchObject({ status: "installed", inputs: [], actionable: false });
    });

    it("sees a changed parameter, a new fan, a reference and the sleep option", () => {
      const p = setHouse(EMPTY_PARAMETERS, "fan_rate_on", 0.05);
      expect(fan(inPlace, { installed: installedWith(defaults), params: p }).reasons).toEqual(["Fan on: rise rate (%/s): 0.03 → 0.05"]);
      expect(fan([...inPlace, plug], { installed: installedWith(defaults), inv: setCounts(house([...inPlace, plug]), EMPTY_INVENTORY, plug.id, true) }).reasons).toEqual([
        "Fan: fan.living_extractor → fan.living_extractor, switch.living_fan_plug",
      ]);
      const q = setHouse(EMPTY_PARAMETERS, "fan_reference", "sensor.hall_humidity");
      expect(fan([...inPlace, { id: "sensor.hall_humidity", dc: "humidity", area: "kitchen" }], { installed: installedWith(defaults), params: q }).reasons).toEqual(["Reference humidity sensor: none → sensor.hall_humidity"]);
      const s = setHouse(EMPTY_PARAMETERS, "fan_suppress_in_sleep", true);
      expect(fan([...inPlace, sleepSwitch], { installed: installedWith(defaults), params: s }).reasons).toEqual(["Not while the house sleeps: false → true", "Sleep switch: none → input_boolean.taxis_sleep"]);
    });

    it("says the rate sensor is gone, and offers to make it again", () => {
      const c = fan([hygro, humidityMean, extractor, toggle], { installed: installedWith(defaults) });
      expect(c.status).toBe("out-of-date");
      expect(c.reasons).toEqual(["sensor.living_humidity_rate is missing"]);
      expect(kindsOf(c)).toEqual(["helper:create:derivative", "automation:update:taxis_bathroom_fan_living"]);
      // Once the list makes it, nothing is missing.
      const pending = [change({ kind: "helper", targetId: "sensor.living_humidity_rate", after: { helper: "derivative", entity_id: "sensor.living_humidity_rate" } })];
      expect(fan([hygro, humidityMean, extractor, toggle], { installed: installedWith(defaults), changes: pending }).status).toBe("installed");
    });

    it("is out of date for an older blueprint, a missing pause switch and another name", () => {
      expect(fan(inPlace, { installed: { ...installedWith(defaults), blueprints: { "taxis/bathroom_fan.yaml": 0 } } }).reasons).toEqual(["The blueprint is version 0, Taxis has 1"]);
      expect(fan(inPlace.filter((e) => e !== toggle), { installed: installedWith(defaults) }).reasons).toEqual(["input_boolean.living_paused is missing"]);
      expect(fan(inPlace, { installed: { automations: { taxis_bathroom_fan_living: { alias: "Lounge – Bathroom fan (Taxis)", path: "taxis/bathroom_fan.yaml", input: defaults } } } }).reasons).toEqual([
        "Name: Lounge – Bathroom fan (Taxis) → Living room – Bathroom fan (Taxis)",
      ]);
    });
  });
});

describe("occupancy with a humidity rate", () => {
  const hygro = { id: "sensor.living_hygro", dc: "humidity", state: "55" };
  const rateSensor = { id: "sensor.living_humidity_rate", platform: "derivative", state: "0", entry: "RATE1" };
  const hold = (specs: Spec[], o: Opts = {}) => cell(plan(specs, { ...o, installed: { blueprints: ALL_THERE, ...o.installed } }), "occupancy");

  it("holds the area on a fast rise only when the rate sensor is there, and the rise is set", () => {
    // Off by default: 0.
    expect(autoInput(hold([motion, spots]))).toMatchObject({ rate_entities: [], rate_hold: 0 });
    const p = setParameter(EMPTY_PARAMETERS, { level: "area", id: "living_room" }, "humidity_hold_rate", 0.02);
    expect(autoInput(hold([motion, spots], { params: p }))).toMatchObject({ rate_entities: [], rate_hold: 0.02 });
    expect(autoInput(hold([motion, spots, hygro, rateSensor], { params: p }))).toMatchObject({ rate_entities: ["sensor.living_humidity_rate"], rate_hold: 0.02 });
    // The rate sensor the list is about to make counts, so the two can be added together.
    const pending = [change({ kind: "helper", targetId: "sensor.living_humidity_rate", after: { helper: "derivative", entity_id: "sensor.living_humidity_rate" } })];
    expect(autoInput(hold([motion, spots], { params: p, changes: pending })).rate_entities).toEqual(["sensor.living_humidity_rate"]);
    // A sensor of that name that isn't a derivative helper is not used.
    expect(autoInput(hold([motion, spots, { id: "sensor.living_humidity_rate", platform: "demo" }], { params: p })).rate_entities).toEqual([]);
  });

  it("is a parameter on the Occupancy tab of every level, 0 (off) at the start", () => {
    expect(PARAM_DEF.humidity_hold_rate).toMatchObject({ tab: "occupancy", kind: "number", default: 0, unit: "%/s" });
    expect(PARAM_DEF.humidity_hold_rate.areaOnly).toBeUndefined();
  });

  it("makes an installed Occupancy out of date when the rise or the sensor changes", () => {
    const installedAuto = (input: Record<string, unknown>) => ({ automations: { taxis_occupancy_living: { ...installedOccupancy, input } } });
    expect(hold([motion, spots, ...runtime], { installed: installedAuto(occupancyInput) }).status).toBe("installed");
    const p = setParameter(EMPTY_PARAMETERS, { level: "area", id: "living_room" }, "humidity_hold_rate", 0.02);
    expect(hold([motion, spots, ...runtime], { installed: installedAuto(occupancyInput), params: p }).reasons).toEqual(["Shower holds occupied at (%/s): 0 → 0.02"]);
    expect(hold([motion, spots, ...runtime, rateSensor], { installed: installedAuto(occupancyInput) }).reasons).toEqual(["Humidity rate sensor: none → sensor.living_humidity_rate"]);
  });
});

describe("exterior lights", () => {
  const exterior = setAreaType(EMPTY_INVENTORY, "living_room", "exterior");
  const camera = { id: "binary_sensor.living_camera_motion", dc: "motion" };
  const alex = { id: "person.alex", area: "" };
  const sam = { id: "person.sam", area: "" };
  const light = (specs: Spec[], o: Opts = {}) => cell(plan(specs, { inv: exterior, ...o, installed: { blueprints: ALL_THERE, ...o.installed } }), "exterior_lights");
  const defaults = {
    light_target: "light.living_all",
    motion_entities: [],
    person_entities: [],
    sunset_offset: 0,
    clock_minutes: 120,
    override_timer: "timer.living_override",
    override_minutes: 0,
    pause_switch: "input_boolean.living_paused",
  };

  it("is named like the others", () => {
    expect(automationIdFor("exterior_lights", "living")).toBe("taxis_exterior_lights_living");
    expect(RECIPE_LABEL.exterior_lights).toBe("Exterior lights");
  });

  it("is for areas whose type is exterior, and needs the light group", () => {
    expect(cell(plan([lights, spots]), "exterior_lights")).toMatchObject({ status: "missing", missing: ["An exterior area (Capabilities, Type)"] });
    expect(light([spots]).missing).toEqual(["A light group (make it on the Helpers tab)"]);
    expect(light([lights, spots]).status).toBe("ready");
    const pending = [change({ kind: "helper", targetId: "light.living_all", after: { helper: "group", entity_id: "light.living_all" } })];
    expect(light([spots], { changes: pending }).status).toBe("ready");
    expect(light([{ ...lights, platform: "demo" }]).missing[0]).toMatch(/light.living_all is already used/);
    // Occupancy is not needed: an outdoor area has no occupied sensor of its own.
    expect(light([lights, spots]).missing).toEqual([]);
  });

  it("makes the pause switch, the override timer and the automation, and takes the counted sensors and every person", () => {
    const c = light([lights, spots, motion, camera, alex, sam]);
    expect(kindsOf(c)).toEqual(["helper:create:input_boolean", "helper:create:timer", "automation:create:taxis_exterior_lights_living"]);
    // Motion sensors and presence sensors that count, sorted; people are every person in the house.
    expect(autoInput(c)).toEqual({ ...defaults, motion_entities: ["binary_sensor.living_camera_motion", "binary_sensor.living_pir"], person_entities: ["person.alex", "person.sam"] });
    expect(kindsOf(light([lights, spots], { installed: { blueprints: {} } }))[0]).toBe("blueprint:create:taxis/exterior_lights.yaml");
    expect(c.inputs.find((i) => i.fields?.helper === "timer")!.fields).toEqual({ helper: "timer", name: "Living room override", entity_id: "timer.living_override", area_id: "living_room", duration: 3600 });
    // A camera's sensor the user doesn't want to count stays out.
    const h = house([lights, spots, motion, camera]);
    const uncounted = setCounts(h, exterior, camera.id, false);
    expect(autoInput(light([lights, spots, motion, camera], { inv: uncounted })).motion_entities).toEqual(["binary_sensor.living_pir"]);
    for (const input of c.inputs) expect(validateInput(input), JSON.stringify(input).slice(0, 80)).toBeNull();
  });

  it("gives the sunset offset in seconds and the clock, and the override time the other lights use", () => {
    let p = setParameter(EMPTY_PARAMETERS, { level: "type", id: "exterior" }, "exterior_sunset_offset", -30);
    p = setParameter(p, { level: "area", id: "living_room" }, "exterior_clock", 90);
    p = setHouse(p, "override_duration", 20);
    const c = light([lights, spots], { params: p });
    expect(autoInput(c)).toMatchObject({ sunset_offset: -1800, clock_minutes: 90, override_minutes: 20 });
    expect(c.inputs.find((i) => i.fields?.helper === "timer")!.fields!.duration).toBe(1200);
  });

  it("reuses the override timer and the pause switch that are there (Motion lights makes the same ones)", () => {
    expect(kindsOf(light([lights, spots, toggle, overrideTimer], { installed: { timers: { "timer.living_override": 3600 } } }))).toEqual(["automation:create:taxis_exterior_lights_living"]);
    // A timer that is not as long as the setting is brought to it.
    const p = setHouse(EMPTY_PARAMETERS, "override_duration", 30);
    expect(kindsOf(light([lights, spots, toggle, overrideTimer], { params: p, installed: { timers: { "timer.living_override": 3600 } } }))).toEqual(["helper:update:timer.living_override", "automation:create:taxis_exterior_lights_living"]);
  });

  it("notes when there is nothing to keep the lights on, and when Motion lights is installed too", () => {
    expect(light([lights, spots]).notes).toEqual([
      "No motion sensor counts here (a camera's counts when you say so), so only sunset and a person arriving keep the lights on",
      "Home Assistant has no person, so arriving home turns nothing on",
    ]);
    const both = light([lights, spots, motion, alex], { installed: { automations: { taxis_motion_lights_living: { alias: "x", path: "taxis/motion_lights.yaml", input: {} } } } });
    expect(both.notes).toEqual(["Motion lights is installed for this area too, and both switch its lights: one of them is enough"]);
  });

  it("lists the other automations that control the lights", () => {
    const controllers = { "light.living_all": [{ entityId: "automation.sunset", name: "Sunset" }] };
    expect(light([lights, spots], { installed: { controllers } }).controlledBy).toEqual([{ entityId: "automation.sunset", name: "Sunset" }]);
  });

  it("is installed when it matches, and out of date when a person, a sensor or the clock changes", () => {
    const input = { ...defaults, motion_entities: ["binary_sensor.living_pir"], person_entities: ["person.alex"] };
    const there = { automations: { taxis_exterior_lights_living: { alias: "Living room – Exterior lights (Taxis)", path: "taxis/exterior_lights.yaml", input } }, timers: { "timer.living_override": 3600 } };
    const specs = [lights, spots, motion, alex, toggle, overrideTimer];
    expect(light(specs, { installed: there })).toMatchObject({ status: "installed", inputs: [] });
    expect(light([...specs, sam], { installed: there }).reasons).toEqual(["People: person.alex → person.alex, person.sam"]);
    expect(light(specs, { installed: there, params: setHouse(EMPTY_PARAMETERS, "exterior_clock", 60) }).reasons).toEqual(["Stay on for (min): 120 → 60"]);
    expect(light(specs, { installed: there, params: setHouse(EMPTY_PARAMETERS, "exterior_sunset_offset", 15) }).reasons).toEqual(["Sunset offset (s): 0 → 900"]);
    expect(light(specs.filter((e) => e !== overrideTimer), { installed: { ...there, timers: {} } }).reasons).toEqual(["timer.living_override is missing"]);
  });
});

describe("left open", () => {
  const door = { id: "binary_sensor.living_front_door", dc: "door" };
  const win = { id: "binary_sensor.living_window", dc: "window" };
  const open = (specs: Spec[], o: Opts = {}) => cell(plan(specs, { ...o, installed: { blueprints: ALL_THERE, ...o.installed } }), "left_open");
  const defaults = {
    door_entities: ["binary_sensor.living_front_door"],
    window_entities: ["binary_sensor.living_window"],
    door_minutes: 10,
    window_minutes: 30,
    repeat_minutes: 0,
    notify_targets: [],
    area_name: "Living room",
    pause_switch: "input_boolean.living_paused",
  };

  it("needs a door or a window that counts", () => {
    expect(open([spots])).toMatchObject({ status: "missing", missing: ["A door or window that counts (Capabilities)"] });
    const h = house([door]);
    expect(open([door], { inv: setCounts(h, EMPTY_INVENTORY, door.id, false) }).status).toBe("missing");
    expect(open([door]).status).toBe("ready");
    expect(open([win]).status).toBe("ready");
  });

  it("watches each sensor itself, doors and windows apart, and names the area", () => {
    const c = open([door, win]);
    expect(kindsOf(c)).toEqual(["helper:create:input_boolean", "automation:create:taxis_left_open_living"]);
    expect(autoInput(c)).toEqual(defaults);
    // An "opening" sensor is a window until the user says it is a door.
    const opening = { id: "binary_sensor.living_skylight", dc: "opening" };
    expect(autoInput(open([opening])).window_entities).toEqual(["binary_sensor.living_skylight"]);
    expect(autoInput(open([opening], { inv: setKind(house([opening]), EMPTY_INVENTORY, opening.id, "door") })).door_entities).toEqual(["binary_sensor.living_skylight"]);
    for (const input of c.inputs) expect(validateInput(input), JSON.stringify(input).slice(0, 80)).toBeNull();
  });

  it("takes the times, the repeat and the notify services from the parameters; the services are the house's", () => {
    let p = setHouse(EMPTY_PARAMETERS, "door_open_after", 5);
    p = setParameter(p, { level: "area", id: "living_room" }, "window_open_after", 45);
    p = setHouse(p, "left_open_repeat", 15);
    p = setHouse(p, "notify_targets", ["notify.mobile_app_phone", "notify.family"]);
    const c = open([door, win], { params: p });
    expect(autoInput(c)).toMatchObject({ door_minutes: 5, window_minutes: 45, repeat_minutes: 15, notify_targets: ["notify.mobile_app_phone", "notify.family"] });
    expect(c.notes).toEqual([]);
    // An area can't have services of its own: the house's are used.
    const q = setParameter(setHouse(EMPTY_PARAMETERS, "notify_targets", ["notify.family"]), { level: "area", id: "living_room" }, "notify_targets", ["notify.other"]);
    expect(autoInput(open([door], { params: q })).notify_targets).toEqual(["notify.family"]);
  });

  it("says where the message goes when no service is set", () => {
    expect(open([door]).notes).toEqual(["No notify services are set (Parameters, House), so the message appears in Home Assistant's notifications"]);
  });

  it("is installed when it matches, and out of date when the services or a time change", () => {
    const there = { automations: { taxis_left_open_living: { alias: "Living room – Left open (Taxis)", path: "taxis/left_open.yaml", input: defaults } } };
    expect(open([door, win, toggle], { installed: there })).toMatchObject({ status: "installed", inputs: [] });
    const p = setHouse(EMPTY_PARAMETERS, "notify_targets", ["notify.phone"]);
    expect(open([door, win, toggle], { installed: there, params: p }).reasons).toEqual(["Notify services: none → notify.phone"]);
    expect(open([door, win, toggle], { installed: there, params: setHouse(EMPTY_PARAMETERS, "left_open_repeat", 10) }).reasons).toEqual(["Repeat every (min): 0 → 10"]);
    expect(open([door, toggle], { installed: there }).reasons).toEqual(["Windows: binary_sensor.living_window → none"]);
  });
});

describe("appliance done", () => {
  const washer = { id: "sensor.living_washer_power", dc: "power", state: "0.4", attrs: { unit_of_measurement: "W" } };
  const dryer = { id: "sensor.living_dryer_power", dc: "power", state: "0.2", attrs: { unit_of_measurement: "W" } };
  const done = (specs: Spec[], o: Opts = {}) => cell(plan(specs, { ...o, installed: { blueprints: ALL_THERE, ...o.installed } }), "appliance_done");
  const marked = (...ids: string[]) => ids.reduce((s, id) => setAppliance(s, id, true), EMPTY_INVENTORY);
  const defaults = {
    power_entities: ["sensor.living_washer_power"],
    run_watts: 10,
    run_minutes: 2,
    idle_watts: 5,
    idle_minutes: 3,
    notify_targets: [],
    area_name: "Living room",
    pause_switch: "input_boolean.living_paused",
  };

  it("needs a power sensor that counts and is marked as an appliance", () => {
    expect(done([washer])).toMatchObject({ status: "missing", missing: ["A power sensor that counts and is marked as an appliance (Capabilities)"] });
    expect(done([washer], { inv: marked(washer.id) }).status).toBe("ready");
    const h = house([washer]);
    expect(done([washer], { inv: setCounts(h, marked(washer.id), washer.id, false) }).status).toBe("missing");
    // The mark is kept in the inventory, per sensor, and goes when it is reset.
    expect(resetEntity(marked(washer.id), washer.id)).toEqual(EMPTY_INVENTORY);
  });

  it("gives every appliance of the area to one automation, and the levels from the parameters", () => {
    const c = done([washer, dryer], { inv: marked(washer.id, dryer.id) });
    expect(kindsOf(c)).toEqual(["helper:create:input_boolean", "automation:create:taxis_appliance_done_living"]);
    expect(autoInput(c)).toEqual({ ...defaults, power_entities: ["sensor.living_dryer_power", "sensor.living_washer_power"] });
    let p = setHouse(EMPTY_PARAMETERS, "appliance_run_watts", 20);
    p = setParameter(p, { level: "area", id: "living_room" }, "appliance_idle_watts", 2);
    p = setHouse(p, "appliance_run_minutes", 5);
    p = setHouse(p, "appliance_idle_minutes", 10);
    p = setHouse(p, "notify_targets", ["notify.phone"]);
    expect(autoInput(done([washer], { inv: marked(washer.id), params: p }))).toMatchObject({ run_watts: 20, idle_watts: 2, run_minutes: 5, idle_minutes: 10, notify_targets: ["notify.phone"] });
    for (const input of c.inputs) expect(validateInput(input), JSON.stringify(input).slice(0, 80)).toBeNull();
  });

  it("refuses a running level that is not above the done level", () => {
    const p = setHouse(setHouse(EMPTY_PARAMETERS, "appliance_run_watts", 5), "appliance_idle_watts", 5);
    expect(done([washer], { inv: marked(washer.id), params: p }).missing).toEqual(["Running above is not higher than Done below (Parameters, Safety)"]);
  });

  it("notes a sensor in kW, and where the message goes", () => {
    const kw = { ...washer, attrs: { unit_of_measurement: "kW" } };
    expect(done([kw], { inv: marked(kw.id) }).notes).toEqual([
      "No notify services are set (Parameters, House), so the message appears in Home Assistant's notifications",
      "A sensor reports kW; the levels are in watts, so set them in kW or use a sensor in W",
    ]);
  });

  it("is installed when it matches, and out of date when an appliance is added or the levels change", () => {
    const there = { automations: { taxis_appliance_done_living: { alias: "Living room – Appliance done (Taxis)", path: "taxis/appliance_done.yaml", input: defaults } } };
    expect(done([washer, toggle], { inv: marked(washer.id), installed: there })).toMatchObject({ status: "installed", inputs: [] });
    expect(done([washer, dryer, toggle], { inv: marked(washer.id, dryer.id), installed: there }).reasons).toEqual(["Appliances: sensor.living_washer_power → sensor.living_dryer_power, sensor.living_washer_power"]);
    expect(done([washer, toggle], { inv: marked(washer.id), installed: there, params: setHouse(EMPTY_PARAMETERS, "appliance_idle_minutes", 6) }).reasons).toEqual(["Done for (min): 3 → 6"]);
  });
});

describe("announce", () => {
  const kitchenSpeaker = { id: "media_player.kitchen_speaker", area: "kitchen", state: "idle" };
  const livingSpeaker = { id: "media_player.living_speaker", state: "idle" };
  const tts = { id: "tts.cloud", area: "", state: "unknown", platform: "tts" };
  const occupancyFor = (code: string, area: string) => [
    { id: `timer.${code}_hold`, platform: "timer", state: "idle", area },
    { id: `input_boolean.${code}_paused`, platform: "input_boolean", state: "off", area },
    { id: `binary_sensor.${code}_occupied`, platform: "template", dc: "occupancy", entry: `OCC_${code}`, area },
  ];
  const installedOcc = (...codes: string[]) => Object.fromEntries(codes.map((c) => [`taxis_occupancy_${c}`, { alias: "x", path: OCC.path, input: occupancyInput }]));
  const tellMe = (specs: Spec[], o: Opts = {}) =>
    planAnnounce(house(specs), o.inv ?? EMPTY_INVENTORY, o.naming ?? naming, o.params ?? EMPTY_PARAMETERS, { ...NOTHING_INSTALLED, blueprints: ALL_THERE, ...o.installed }, o.changes ?? []);
  const ready = setHouse(EMPTY_PARAMETERS, "tts_entity", "tts.cloud");
  const areas = [
    { occupied: "binary_sensor.kitchen_occupied", paused: "input_boolean.kitchen_paused", bed: [], speakers: ["media_player.kitchen_speaker"] },
    { occupied: "binary_sensor.living_occupied", paused: "input_boolean.living_paused", bed: [], speakers: ["media_player.living_speaker"] },
  ];
  const specs = [kitchenSpeaker, livingSpeaker, tts, ...occupancyFor("kitchen", "kitchen"), ...occupancyFor("living", "living_room")];
  const scriptInput = (c: RecipeCell) => (c.inputs.find((i) => i.kind === "script")!.fields!.use_blueprint as { input: { areas: Record<string, unknown>[]; tts_entity: string; default_volume: number } }).input;

  it("is one script for the house, planned apart from the areas", () => {
    expect(RECIPE_LABEL.announce).toBe("Announce");
    expect(ANNOUNCE_ALIAS).toBe("Announce (Taxis)");
    const c = tellMe(specs, { params: ready, installed: { automations: installedOcc("kitchen", "living") } });
    expect(c).toMatchObject({ areaId: "", areaName: "House", recipe: "announce", status: "ready", actionable: true, controlledBy: [] });
    // Not among the cells of the areas.
    expect(plan(specs).some((x) => (x.recipe as string) === "announce")).toBe(false);
  });

  it("needs a text-to-speech entity that exists, and a speaker in an area with Occupancy", () => {
    expect(tellMe([livingSpeaker])).toMatchObject({
      status: "missing",
      missing: ["A text-to-speech entity (Parameters, House)", "A speaker that counts in an area that has Occupancy (Capabilities, Recipes)"],
      inputs: [],
    });
    expect(tellMe([livingSpeaker], { params: ready }).missing).toEqual(["The text-to-speech entity “tts.cloud” isn't in Home Assistant (Parameters, House)", "A speaker that counts in an area that has Occupancy (Capabilities, Recipes)"]);
    expect(tellMe(specs, { params: setHouse(EMPTY_PARAMETERS, "tts_entity", "tts.nope"), installed: { automations: installedOcc("living") } }).missing).toEqual([
      "The text-to-speech entity “tts.nope” isn't in Home Assistant (Parameters, House)",
    ]);
  });

  it("includes the areas with a counted speaker, the Occupancy automation, and its sensor and switch, and says who is left out", () => {
    const c = tellMe(specs, { params: ready, installed: { automations: installedOcc("living") } });
    expect(c.status).toBe("ready");
    expect(c.notes).toEqual(["Kitchen has speakers but no Occupancy yet, so it is left out", "The volume is set before speaking and is not put back"]);
    const script = c.inputs.find((i) => i.kind === "script")!;
    expect(script.fields!.use_blueprint).toEqual({ path: "taxis/announce.yaml", input: { areas: [areas[1]], tts_entity: "tts.cloud", default_volume: 40 } });
    // The occupancy about to be installed counts as there.
    const pending = [
      change({ kind: "automation", targetId: "taxis_occupancy_kitchen", after: { automation_id: "taxis_occupancy_kitchen" } }),
      change({ kind: "helper", targetId: "binary_sensor.kitchen_occupied", after: { helper: "template", entity_id: "binary_sensor.kitchen_occupied" } }),
      change({ kind: "helper", targetId: "input_boolean.kitchen_paused", after: { helper: "input_boolean", entity_id: "input_boolean.kitchen_paused" } }),
    ];
    const both = tellMe([kitchenSpeaker, livingSpeaker, tts, ...occupancyFor("living", "living_room")], { params: ready, installed: { automations: installedOcc("living") }, changes: pending });
    expect(scriptInput(both).areas).toEqual(areas);
  });

  it("gives the bed sensors of a bedroom, and only the speakers that count (a TV is not a speaker)", () => {
    const bed = { id: "binary_sensor.living_bed", dc: "occupancy" };
    const tv = { id: "media_player.living_tv", dc: "tv" };
    const inv = setBedroom(setBed(EMPTY_INVENTORY, bed.id, true), "living_room", true);
    const c = tellMe([...specs, bed, tv], { params: ready, inv, installed: { automations: installedOcc("living") } });
    expect(scriptInput(c).areas[0]).toMatchObject({ bed: ["binary_sensor.living_bed"], speakers: ["media_player.living_speaker"] });
  });

  it("writes the blueprint (a script blueprint) first, then the script, and passes the change list's checks", () => {
    const c = tellMe(specs, { params: ready, installed: { blueprints: {}, automations: installedOcc("kitchen", "living") } });
    expect(kindsOf(c)).toEqual(["blueprint:create:taxis/announce.yaml", "script:create:taxis_announce"]);
    expect(c.inputs[1].fields).toMatchObject({ script_id: "taxis_announce", alias: "Announce (Taxis)" });
    for (const input of c.inputs) expect(validateInput(input), JSON.stringify(input).slice(0, 80)).toBeNull();
  });

  it("uses the volume of the house, and ignores one set for an area", () => {
    const p = setParameter(setHouse(ready, "announce_volume", 25), { level: "area", id: "living_room" }, "announce_volume", 90);
    expect(scriptInput(tellMe(specs, { params: p, installed: { automations: installedOcc("living") } })).default_volume).toBe(25);
  });

  describe("installed and out of date", () => {
    const stored = { alias: "Announce (Taxis)", path: "taxis/announce.yaml", input: { areas, tts_entity: "tts.cloud", default_volume: 40 } };
    const there = { automations: installedOcc("kitchen", "living"), scripts: { taxis_announce: stored } };

    it("is installed when it matches, in whatever order Home Assistant gives the areas' fields", () => {
      expect(tellMe(specs, { params: ready, installed: there })).toMatchObject({ status: "installed", inputs: [], actionable: false });
      const reordered = { ...stored, input: { ...stored.input, areas: areas.map((a) => ({ speakers: a.speakers, bed: a.bed, paused: a.paused, occupied: a.occupied })) } };
      expect(tellMe(specs, { params: ready, installed: { ...there, scripts: { taxis_announce: reordered } } }).status).toBe("installed");
    });

    it("says which area was added or left out, what changed in one, and the speaker, the volume and the name", () => {
      const fewer = { ...stored, input: { ...stored.input, areas: [areas[1]] } };
      const c = tellMe(specs, { params: ready, installed: { ...there, scripts: { taxis_announce: fewer } } });
      expect(c.status).toBe("out-of-date");
      expect(c.reasons).toEqual(["Kitchen: not spoken to → spoken to"]);
      expect(kindsOf(c)).toEqual(["script:update:taxis_announce"]);
      const more = { ...stored, input: { ...stored.input, areas: [...areas, { occupied: "binary_sensor.gone_occupied", paused: "input_boolean.gone_paused", bed: [], speakers: ["media_player.gone"] }] } };
      expect(tellMe(specs, { params: ready, installed: { ...there, scripts: { taxis_announce: more } } }).reasons).toEqual(["binary_sensor.gone_occupied: spoken to → not spoken to"]);
      const twoSpeakers = [kitchenSpeaker, { ...kitchenSpeaker, id: "media_player.kitchen_hub" }, livingSpeaker, tts, ...occupancyFor("kitchen", "kitchen"), ...occupancyFor("living", "living_room")];
      expect(tellMe(twoSpeakers, { params: ready, installed: there }).reasons).toEqual(["Kitchen: speakers or bed sensors changed"]);
      expect(tellMe(specs, { params: setHouse(ready, "announce_volume", 60), installed: there }).reasons).toEqual(["Default volume (%): 40 → 60"]);
      expect(tellMe(specs, { params: ready, installed: { ...there, scripts: { taxis_announce: { ...stored, alias: "Old" } } } }).reasons).toEqual(["Name: Old → Announce (Taxis)"]);
    });

    it("is out of date for an older or missing blueprint, or one it isn't made from", () => {
      expect(tellMe(specs, { params: ready, installed: { ...there, blueprints: { "taxis/announce.yaml": 0 } } }).reasons).toEqual(["The blueprint is version 0, Taxis has 1"]);
      expect(tellMe(specs, { params: ready, installed: { ...there, blueprints: {} } }).reasons).toEqual(["The blueprint is missing"]);
      const other = { ...there, scripts: { taxis_announce: { ...stored, path: "other/x.yaml" } } };
      expect(tellMe(specs, { params: ready, installed: other }).reasons).toEqual(["It isn't made from the Taxis blueprint"]);
    });

    it("is in the change list once it is added, and a script of that name Taxis didn't make is left alone", () => {
      const pending = [change({ kind: "script", targetId: "taxis_announce", after: { script_id: "taxis_announce" } })];
      expect(tellMe(specs, { params: ready, installed: { automations: installedOcc("living") }, changes: pending }).status).toBe("in-changes");
      const held = [...specs, { id: "script.taxis_announce", platform: "script", area: "", name: "My script" }];
      expect(tellMe(held, { params: ready, installed: { automations: installedOcc("living") } }).missing).toEqual(["script.taxis_announce is already used by “My script”, which Taxis didn't make or can't edit"]);
    });
  });
});

describe("the chosen cells of the later recipes", () => {
  it("add one blueprint each, once", () => {
    const hygro = { id: "sensor.living_hygro", dc: "humidity", state: "55" };
    const humidityMean = { id: "sensor.living_humidity", platform: "min_max", dc: "humidity", entry: "HUM1" };
    const door = { id: "binary_sensor.living_front_door", dc: "door" };
    const door2 = { id: "binary_sensor.kitchen_door", dc: "door", area: "kitchen" };
    const cells = plan([hygro, humidityMean, { id: "fan.living_extractor" }, door, door2], { installed: { blueprints: {} } });
    const chosen = [cell(cells, "left_open", "living_room"), cell(cells, "left_open", "kitchen"), cell(cells, "bathroom_fan")];
    const paths = recipeChangeInputs(chosen).filter((i) => i.kind === "blueprint").map((i) => i.fields!.path);
    expect(paths).toEqual(["taxis/left_open.yaml", "taxis/bathroom_fan.yaml"]);
  });
});

describe("a list of objects is compared in order, a list of values as a set", () => {
  it("tells apart announce areas that differ, and not the same areas with their fields in another order", () => {
    expect(sameValue([{ a: 1, b: ["x", "y"] }], [{ b: ["y", "x"], a: 1 }])).toBe(true);
    expect(sameValue([{ a: 1 }], [{ a: 2 }])).toBe(false);
    expect(sameValue([{ a: 1 }, { a: 2 }], [{ a: 1 }])).toBe(false);
    expect(sameValue([{ a: 1 }, { a: 2 }], [{ a: 2 }, { a: 1 }])).toBe(false);
    expect(sameValue(["b", "a"], ["a", "b"])).toBe(true);
    expect(sameValue(["a"], ["a", "b"])).toBe(false);
    expect(sameValue([], [])).toBe(true);
    expect(sameValue([{ a: 1 }], ["a"])).toBe(false);
  });
});


describe("ambiguous canonical area codes", () => {
  it("blocks every recipe in rooms with duplicate inferred codes, even with a pending automation", () => {
    const raw = buildMockRegistry();
    raw.areas.push({ area_id: "living_annex", name: "Living annex" });
    raw.entities.push({ entity_id: "binary_sensor.living_side_motion", area_id: "living_annex", platform: "demo", original_name: "Side motion" });
    raw.states.push({ entity_id: "binary_sensor.living_side_motion", state: "off", attributes: { device_class: "motion" } });
    raw.entities.push({ entity_id: "media_player.living_side_speaker", area_id: "living_annex", platform: "demo" });
    raw.states.push({ entity_id: "media_player.living_side_speaker", state: "off", attributes: { device_class: "speaker" } });
    const h = buildHierarchy(raw, "now");
    const cells = planRecipes(h, EMPTY_INVENTORY, DEFAULT_NAMING, EMPTY_PARAMETERS, NOTHING_INSTALLED, []);
    const affected = cells.filter(c => ["living_room", "living_annex"].includes(c.areaId));
    expect(affected).toHaveLength(16);
    for (const c of affected) {
      expect(c.status).toBe("missing");
      expect(c.actionable).toBe(false);
      expect(c.inputs).toEqual([]);
      expect(c.missing.join(" ")).toMatch(/code “living”.*Living room.*Living annex/);
    }
    expect(cells.find(c => c.areaId === "study" && c.recipe === "occupancy")!.status).toBe("ready");
    const pending: Change = { id: 10, kind: "automation", op: "create", targetId: "taxis_occupancy_living", scope: null, before: {}, after: {}, createdAt: "now" };
    expect(planRecipes(h, EMPTY_INVENTORY, DEFAULT_NAMING, EMPTY_PARAMETERS, NOTHING_INSTALLED, [pending]).find(c => c.areaId === "living_room" && c.recipe === "occupancy")!.status).toBe("missing");
    expect(planAnnounce(h, EMPTY_INVENTORY, DEFAULT_NAMING, EMPTY_PARAMETERS, NOTHING_INSTALLED, []).missing.join(" ")).toMatch(/code “living”/);
  });
});


describe("optional house modes in native recipes", () => {
  const base = [motion, spots, lights, speaker, ...runtime];
  const occInstalled = { automations: { [automationIdFor("occupancy", "living")]: { alias: "Living occupancy", path: OCC.path, input: {} } } };
  const mode = (name: string, state = "off"): Spec => ({ id: `input_boolean.taxis_${name}`, platform: "input_boolean", state });
  it("keeps optional mode inputs absent until switches exist or are deliberately queued", () => {
    const c = cell(plan(base, { installed: occInstalled }), "motion_lights");
    expect(autoInput(c)).not.toHaveProperty("guest_entity");
    expect(autoInput(c)).not.toHaveProperty("away_entity");
    const queued = [change({ kind: "helper", targetId: "new:helper:1", after: { helper: "input_boolean", entity_id: "input_boolean.taxis_guest" } })];
    const updated = cell(plan(base, { installed: occInstalled, changes: queued }), "motion_lights");
    expect(autoInput(updated)).toMatchObject({ guest_entity: "input_boolean.taxis_guest", guest_pause_lighting: true });
    expect(updated.inputs.filter((i) => i.kind === "helper")).toEqual([]);
  });
  it("wires the effective modes and per-area guest exceptions to the right recipes", () => {
    const params = setParameter(EMPTY_PARAMETERS, { level: "area", id: "living_room" }, "guest_pause_lighting", false);
    const inv = setBedroom(EMPTY_INVENTORY, "living_room", true);
    const cells = plan([...base, mode("guest"), mode("away"), mode("sleep")], { installed: occInstalled, params, inv });
    expect(autoInput(cell(cells, "motion_lights"))).toMatchObject({ guest_entity: "input_boolean.taxis_guest", away_entity: "input_boolean.taxis_away", sleep_entity: "input_boolean.taxis_sleep", is_bedroom: true, guest_pause_lighting: false });
    expect(autoInput(cell(cells, "media_off"))).toMatchObject({ guest_entity: "input_boolean.taxis_guest", guest_pause_media: true });
  });
  it("blocks recipes when a selected or existing guest switch cannot be used", () => {
    const params = setParameter(EMPTY_PARAMETERS, { level: "house" }, "guest_mode_entity", "input_boolean.visitors");
    expect(cell(plan(base, { installed: occInstalled, params }), "motion_lights").status).toBe("missing");
    expect(cell(plan([...base, mode("guest", "unavailable")], { installed: occInstalled }), "media_off").missing.join(" ")).toContain("state cannot be used");
  });
  it("gives climate guest input without proposing a second guest switch", () => {
    const cells = plan([{ id: "climate.living", platform: "demo" }, mode("guest")]);
    expect(autoInput(cell(cells, "area_climate"))).toHaveProperty("guest_entities", ["input_boolean.taxis_guest"]);
    expect(cell(cells, "area_climate").inputs.filter((i) => i.fields?.entity_id === "input_boolean.taxis_guest")).toEqual([]);
  });
});
