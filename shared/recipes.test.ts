import { describe, expect, it } from "vitest";

import { buildHierarchy, type RawRegistry } from "../server/model/hierarchy.ts";
import { BLUEPRINTS, blueprintForRecipe } from "./blueprints.ts";
import { validateInput } from "./changes.ts";
import { RECIPE_HELPER_SUFFIX, helperExclusions, helperNameErrors } from "./helpers.ts";
import { EMPTY_INVENTORY, setCounts, setRole, type InventorySettings } from "./inventory.ts";
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
const runtime = [timer, toggle, occupied];

type Opts = { inv?: InventorySettings; params?: ParameterSettings; installed?: Partial<RecipeInstalled>; changes?: Change[]; naming?: NamingSettings };
const plan = (specs: Spec[], o: Opts = {}) =>
  planRecipes(house(specs), o.inv ?? EMPTY_INVENTORY, o.naming ?? naming, o.params ?? EMPTY_PARAMETERS, { ...NOTHING_INSTALLED, ...o.installed }, o.changes ?? []);

const cell = (cells: RecipeCell[], recipe: string, area = "living_room") => cells.find((c) => c.recipe === recipe && c.areaId === area)!;

let nextId = 1;
const change = (c: Partial<Change> & Pick<Change, "kind" | "targetId" | "after">): Change => ({ id: nextId++, op: "create", scope: null, before: {}, createdAt: "", ...c });

const OCC = blueprintForRecipe("occupancy");
const MOT = blueprintForRecipe("motion_lights");
const BLUEPRINTS_THERE = { [OCC.path]: OCC.version, [MOT.path]: MOT.version };

// What Taxis would write for the living room with the defaults.
const occupancyInput = {
  starts_entities: ["binary_sensor.living_pir"],
  holds_entities: [],
  hold_timer: "timer.living_hold",
  hold_minutes: 5,
  pause_switch: "input_boolean.living_paused",
};
const installedOccupancy = { alias: "Living room – Occupancy (Taxis)", path: OCC.path, input: occupancyInput };

describe("names", () => {
  it("builds the ids and the alias", () => {
    expect(runtimeIds("living")).toEqual({ timer: "timer.living_hold", occupied: "binary_sensor.living_occupied", switch: "input_boolean.living_paused" });
    expect(automationIdFor("motion_lights", "living")).toBe("taxis_motion_lights_living");
    expect(automationAlias("Living room", "occupancy")).toBe("Living room – Occupancy (Taxis)");
    expect(automationAlias("Kitchen", "motion_lights")).toBe("Kitchen – Motion lights (Taxis)");
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
    expect(cells.map((c) => `${c.areaId}:${c.recipe}`)).toEqual(["living_room:occupancy", "living_room:motion_lights", "kitchen:occupancy", "kitchen:motion_lights"]);
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
      input: { starts_entities: ["binary_sensor.living_pir"], holds_entities: ["binary_sensor.living_mmwave"], hold_timer: "timer.living_hold", hold_minutes: 5, pause_switch: "input_boolean.living_paused" },
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

  it("all of it passes the change list's own checks", () => {
    for (const input of c.inputs) expect(validateInput(input), `${input.kind} ${JSON.stringify(input.fields).slice(0, 60)}`).toBeNull();
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
