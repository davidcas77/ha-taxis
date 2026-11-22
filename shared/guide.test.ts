import { describe, expect, it } from "vitest";
import { buildHierarchy, type RawRegistry } from "../server/model/hierarchy.ts";
import { assessHouse, EMPTY_GUIDE, guideChoice, validateGuide, type GuideGoal } from "./guide.ts";
import {
  EMPTY_INVENTORY,
  setAppliance,
  setAreaType,
  setCounts,
  setLightRole,
  setBedroom,
  setRole,
  setTvOccupancyNotApplicable,
  setTvOccupancyRole,
  setRecipeWanted,
} from "./inventory.ts";
import type { RoomAutomationKey } from "./guide-automations.ts";
import { DEFAULT_NAMING } from "./naming.ts";
import { EMPTY_PARAMETERS, setParameter } from "./parameters.ts";
import { NOTHING_INSTALLED, planRecipes } from "./recipes.ts";
import { blueprintForRecipe } from "./blueprints.ts";
import type { Change } from "./types.ts";

const naming = { ...DEFAULT_NAMING, areaCodes: { living_room: "living" } };
const guide = (goals: GuideGoal[] = ["lighting"]) => ({
  areas: { living_room: { profile: "living" as const, goals } },
});
function house() {
  const raw: RawRegistry = {
    config: { location_name: "Guide test house" },
    floors: [{ floor_id: "ground", name: "Ground" }],
    areas: [{ area_id: "living_room", name: "Living room", floor_id: "ground" }],
    devices: [],
    labels: [],
    entities: [],
    states: [],
  };
  const add = (id: string, platform: string, dc?: string, members?: string[], state = "off") => {
    raw.entities.push({ entity_id: id, platform, area_id: "living_room", config_entry_id: "fixture", unique_id: id });
    raw.states.push({ entity_id: id, state, attributes: { device_class: dc, entity_id: members } });
  };
  add("light.living_ceiling", "demo");
  add("light.living_all", "group", undefined, ["light.living_ceiling"]);
  add("binary_sensor.living_pir", "demo", "motion");
  add("binary_sensor.living_motion_all", "group", "motion", ["binary_sensor.living_pir"]);
  return { raw, add, get: () => buildHierarchy(raw, "2026-10-28T00:00:00Z") };
}

describe("guide preferences", () => {
  it("validates room types and selected goals without accepting arbitrary recipes or advice", () => {
    expect(validateGuide(guide())).toEqual({ ok: true, value: guide() });
    expect(validateGuide(guide(["lighting", "lighting"]))).toEqual({ ok: true, value: guide() });
    for (const bad of [
      null,
      [],
      { areas: [] },
      { areas: { living_room: { profile: "anything", goals: [] } } },
      { areas: { living_room: { profile: "living", goals: ["arbitrary_write"] } } },
      { areas: { "bad id": { profile: "living", goals: [] } } },
    ])
      expect(validateGuide(bad)).toMatchObject({ ok: false });
    expect(guideChoice(EMPTY_GUIDE, "constructor")).toBeNull();
    const own = validateGuide(JSON.parse('{"areas":{"constructor":{"profile":"other","goals":[]}}}'));
    expect(own.ok && guideChoice(own.value, "constructor")).toEqual({ profile: "other", goals: [] });
  });
  it("bounds settings size", () => {
    expect(
      validateGuide({
        areas: Object.fromEntries(Array.from({ length: 501 }, (_, index) => [`area_${index}`, { profile: "other", goals: [] }])),
      }),
    ).toMatchObject({ ok: false });
  });
  it("persists only valid equipment confirmations and rechecks changed equipment", () => {
    const fixture = house();
    const read = (value = EMPTY_GUIDE) => assessHouse(fixture.get(), EMPTY_INVENTORY, naming, EMPTY_PARAMETERS, value, NOTHING_INSTALLED, [])[0];
    const before = read();
    expect(before.equipmentConfirmed).toBe(false);
    const saved = validateGuide({ ...EMPTY_GUIDE, equipment: { living_room: before.equipmentConfiguration } });
    if (!saved.ok) throw new Error(saved.error);
    expect(read(saved.value).equipmentConfirmed).toBe(true);
    fixture.add("timer.living_hold", "timer", undefined, [], "idle");
    expect(read(saved.value).equipmentConfirmed).toBe(true);
    fixture.add("light.replacement", "demo");
    expect(read(saved.value).equipmentConfirmed).toBe(false);
    expect(validateGuide({ ...EMPTY_GUIDE, equipment: { living_room: "forged" } })).toMatchObject({ ok: false });
  });
});

describe("house readiness", () => {
  it("requires goals before claiming readiness and does not penalize an intentionally unplanned room", () => {
    const h = house().get();
    expect(assessHouse(h, EMPTY_INVENTORY, naming, EMPTY_PARAMETERS, EMPTY_GUIDE, NOTHING_INSTALLED, [])[0].stage).toBe("choose");
    expect(assessHouse(h, EMPTY_INVENTORY, naming, EMPTY_PARAMETERS, guide([]), NOTHING_INSTALLED, [])[0].stage).toBe("unplanned");
  });
  it("checks only the chosen outcomes, not every sensor category", () => {
    const row = assessHouse(house().get(), EMPTY_INVENTORY, naming, EMPTY_PARAMETERS, guide(), NOTHING_INSTALLED, [])[0];
    expect(row.equipment.filter((item) => item.required).map((item) => item.key)).toEqual(["lights", "activity"]);
    expect(row.equipment.find((item) => item.key === "lux")).toMatchObject({ required: false, status: "missing" });
    expect(row.equipment.some((item) => item.key === "climate" || item.key === "media")).toBe(false);
  });
  it("does not count a raw switch as a light", () => {
    const fixture = house();
    fixture.raw.entities = [];
    fixture.raw.states = [];
    fixture.add("switch.living_relay", "demo");
    const row = assessHouse(fixture.get(), EMPTY_INVENTORY, naming, EMPTY_PARAMETERS, guide(), NOTHING_INSTALLED, [])[0];
    expect(row.equipment.find((item) => item.key === "lights")?.status).toBe("missing");
    expect(row.switches).toEqual(["switch.living_relay"]);
  });
  it("asks to review existing unavailable, disabled or excluded sources rather than recommending duplicate equipment", () => {
    for (const mode of ["unavailable", "disabled", "excluded"] as const) {
      const h = house().get();
      if (mode === "unavailable") h.entities["binary_sensor.living_pir"].state = "unavailable";
      if (mode === "disabled") h.entities["binary_sensor.living_pir"].disabled = true;
      const inventory = mode === "excluded" ? setCounts(h, EMPTY_INVENTORY, "binary_sensor.living_pir", false) : EMPTY_INVENTORY;
      const row = assessHouse(h, inventory, naming, EMPTY_PARAMETERS, guide(), NOTHING_INSTALLED, [])[0];
      expect(row.stage).toBe("equipment");
      expect(row.equipment.find((item) => item.key === "activity")).toMatchObject({
        status: "review",
        entityIds: ["binary_sensor.living_pir"],
      });
    }
  });
  it("requires an explicitly chosen night target and follows the saved inventory role", () => {
    const h = house().get();
    expect(assessHouse(h, EMPTY_INVENTORY, naming, EMPTY_PARAMETERS, guide(["night"]), NOTHING_INSTALLED, [])[0].stage).toBe("equipment");
    const inventory = setLightRole(EMPTY_INVENTORY, "light.living_ceiling", "night");
    expect(
      assessHouse(h, inventory, naming, EMPTY_PARAMETERS, guide(["night"]), NOTHING_INSTALLED, [])[0].equipment.find((item) => item.key === "night-target")
        ?.status,
    ).toBe("ready");
  });
  it("reads the same explicit night target that the native lighting planner uses", () => {
    const h = house().get();
    const scope = { level: "area", id: "living_room" } as const;
    const target = setParameter(EMPTY_PARAMETERS, scope, "night_lights", ["light.living_ceiling"]);
    const assessment = assessHouse(h, EMPTY_INVENTORY, naming, target, guide(["night"]), NOTHING_INSTALLED, [])[0];
    expect(assessment.equipment.find((item) => item.key === "night-target")).toMatchObject({ status: "ready", entityIds: ["light.living_ceiling"] });
    const inventory = setLightRole(EMPTY_INVENTORY, "light.living_ceiling", "night");
    const empty = setParameter(EMPTY_PARAMETERS, scope, "night_lights", []);
    const cleared = assessHouse(h, inventory, naming, empty, guide(["night"]), NOTHING_INSTALLED, [])[0];
    expect(cleared.equipment.find((item) => item.key === "night-target")?.status).toBe("review");
  });
  it("does not treat a helper in the preview queue as installed", () => {
    const h = house().get();
    const pending: Change = {
      id: 1,
      kind: "helper",
      op: "create",
      targetId: "light.living_all",
      scope: null,
      before: {},
      after: { entity_id: "light.living_all" },
      createdAt: "now",
    };
    const row = assessHouse(h, EMPTY_INVENTORY, naming, EMPTY_PARAMETERS, guide(), NOTHING_INSTALLED, [pending])[0];
    expect(row.helpers.find((item) => item.row.key === "lights")?.pending).toBe(true);
    expect(row.stage).toBe("changes");
  });
  it("does not invent an installed status when the installed read failed", () => {
    const row = assessHouse(house().get(), EMPTY_INVENTORY, naming, EMPTY_PARAMETERS, guide(), null, [])[0];
    expect(row.stage).toBe("unread");
    expect(row.recipes.every((item) => item.cell === null)).toBe(true);
  });
  it("keeps a real helper conflict visible even if an old proposal is queued", () => {
    const h = house().get();
    h.entities["light.living_all"].platform = "demo";
    const pending: Change = {
      id: 1,
      kind: "helper",
      op: "create",
      targetId: "light.living_all",
      scope: null,
      before: {},
      after: { entity_id: "light.living_all" },
      createdAt: "now",
    };
    const row = assessHouse(h, EMPTY_INVENTORY, naming, EMPTY_PARAMETERS, guide(), NOTHING_INSTALLED, [pending])[0];
    expect(row.helpers.find((item) => item.row.key === "lights")).toMatchObject({
      pending: false,
      row: { status: "conflict" },
    });
    expect(row.stage).toBe("helpers");
  });
  it("distinguishes stored configuration, enabled automation and a pending physical room test", () => {
    const fixture = house();
    fixture.add("timer.living_hold", "timer", undefined, undefined, "idle");
    fixture.add("input_boolean.living_paused", "input_boolean");
    fixture.add("binary_sensor.living_occupied", "template", "occupancy");
    fixture.add("automation.taxis_occupancy_living", "automation");
    const h = fixture.get();
    const initial = planRecipes(h, EMPTY_INVENTORY, naming, EMPTY_PARAMETERS, NOTHING_INSTALLED, []).find((cell) => cell.recipe === "occupancy")!;
    const fields = initial.inputs.find((input) => input.kind === "automation")!.fields!;
    const bp = fields.use_blueprint as { path: string; input: Record<string, unknown> };
    const installed = {
      ...structuredClone(NOTHING_INSTALLED),
      blueprints: { [bp.path]: blueprintForRecipe("occupancy").version },
      automations: { taxis_occupancy_living: { alias: fields.alias as string, path: bp.path, input: bp.input } },
    };
    const off = assessHouse(h, EMPTY_INVENTORY, naming, EMPTY_PARAMETERS, guide(["occupancy"]), installed, [])[0];
    expect(off.recipes[0].cell?.status).toBe("installed");
    expect(off.stage).toBe("check");
    h.entities["automation.taxis_occupancy_living"].state = "on";
    expect(assessHouse(h, EMPTY_INVENTORY, naming, EMPTY_PARAMETERS, guide(["occupancy"]), installed, [])[0].stage).toBe("test");
    const ready = assessHouse(h, EMPTY_INVENTORY, naming, EMPTY_PARAMETERS, guide(["occupancy"]), installed, [])[0];
    const testedGuide = {
      ...guide(["occupancy"]),
      tests: {
        living_room: {
          configuration: ready.configuration,
          checked: ready.checks.map((check) => check.key),
          notes: "Observed in the room.",
          testedAt: "2026-10-28T00:00:00.000Z",
        },
      },
    };
    expect(assessHouse(h, EMPTY_INVENTORY, naming, EMPTY_PARAMETERS, testedGuide, installed, [])[0]).toMatchObject({
      stage: "tested",
      testCurrent: true,
    });
    // Routine sensor states and refresh timestamps must not erase a room test.
    h.fetchedAt = "later";
    h.entities["binary_sensor.living_pir"].state = "on";
    expect(assessHouse(h, EMPTY_INVENTORY, naming, EMPTY_PARAMETERS, testedGuide, installed, [])[0].stage).toBe("tested");
    h.entities["automation.taxis_occupancy_living"].state = "off";
    expect(assessHouse(h, EMPTY_INVENTORY, naming, EMPTY_PARAMETERS, testedGuide, installed, [])[0]).toMatchObject({
      stage: "check",
      testCurrent: false,
    });
    h.entities["automation.taxis_occupancy_living"].state = "on";
    h.entities["binary_sensor.living_pir"].deviceId = "replacement_sensor";
    const changed = assessHouse(h, EMPTY_INVENTORY, naming, EMPTY_PARAMETERS, testedGuide, installed, [])[0];
    expect(changed.configuration).not.toBe(ready.configuration);
    expect(changed.testCurrent).toBe(false);
    expect(changed.testRecord?.notes).toBe("Observed in the room.");
    const proposedMove: Change = {
      id: 3,
      kind: "entity",
      op: "update",
      targetId: "binary_sensor.living_pir",
      scope: null,
      before: { area_id: "other_room" },
      after: { area_id: "living_room" },
      createdAt: "now",
    };
    expect(assessHouse(h, EMPTY_INVENTORY, naming, EMPTY_PARAMETERS, guide(["occupancy"]), installed, [proposedMove])[0].stage).toBe("changes");
  });
});

it("requires explicit bedroom classification before sleep-sensitive room setup without changing inventory", () => {
  const h = house().get();
  const settings = { areas: { living_room: { profile: "bedroom" as const, goals: ["night" as const] } } };
  const first = assessHouse(h, EMPTY_INVENTORY, naming, EMPTY_PARAMETERS, settings, NOTHING_INSTALLED, [])[0];
  expect(first.equipment.find((check) => check.key === "bedroom_behavior")).toMatchObject({
    status: "review",
    required: true,
    entityIds: [],
  });
  const classified = assessHouse(h, setBedroom(EMPTY_INVENTORY, "living_room", true), naming, EMPTY_PARAMETERS, settings, NOTHING_INSTALLED, [])[0];
  expect(classified.equipment.some((check) => check.key === "bedroom_behavior")).toBe(false);
  expect(EMPTY_INVENTORY.areas).toEqual({});
});

describe("TV occupancy equipment", () => {
  it("accepts only a healthy counted starts TV while retaining other goal equipment", () => {
    const fixture = house();
    fixture.raw.entities = [];
    fixture.raw.states = [];
    fixture.add("media_player.tv", "demo", "tv", undefined, "playing");
    const h = fixture.get();
    const activity = (inv: typeof EMPTY_INVENTORY) => assessHouse(h, inv, naming, EMPTY_PARAMETERS, guide(["occupancy"]), NOTHING_INSTALLED, [])[0];
    expect(activity(EMPTY_INVENTORY).equipment.find((e) => e.key === "activity")?.status).not.toBe("ready");
    const starts = setTvOccupancyRole(h, EMPTY_INVENTORY, "media_player.tv", "starts");
    const row = activity(starts);
    expect(row.equipment.find((e) => e.key === "activity")).toMatchObject({ status: "ready", entityIds: ["media_player.tv"] });
    expect(row.stage).not.toBe("equipment");
    expect(activity(setTvOccupancyRole(h, starts, "media_player.tv", "holds")).equipment.find((e) => e.key === "activity")?.status).not.toBe("ready");
    expect(activity(setCounts(h, starts, "media_player.tv", false)).equipment.find((e) => e.key === "activity")?.status).not.toBe("ready");
    expect(
      assessHouse(h, starts, naming, EMPTY_PARAMETERS, guide(["lighting"]), NOTHING_INSTALLED, [])[0].equipment.find((e) => e.key === "lights")?.status,
    ).toBe("missing");
    h.entities["media_player.tv"].state = "unavailable";
    expect(activity(starts).equipment.find((e) => e.key === "activity")?.status).toBe("review");
  });
});

it("treats opted-out goal recipes as unplanned without changing saved goals", () => {
  const choice = guide(["lighting"]);
  const inventory = setRecipeWanted(EMPTY_INVENTORY, "living_room", "motion_lights", false);
  const row = assessHouse(house().get(), inventory, naming, EMPTY_PARAMETERS, choice, NOTHING_INSTALLED, [])[0];
  expect(row.stage).toBe("unplanned");
  expect(row.recipes).toEqual([]);
  expect(row.equipment).toEqual([]);
  expect(choice.areas.living_room.goals).toEqual(["lighting"]);
});

it("keeps guidance for a chosen goal with no equipment unless manually disabled", () => {
  const fixture = house();
  fixture.raw.entities = [];
  fixture.raw.states = [];
  const h = fixture.get();
  const assess = (inventory: typeof EMPTY_INVENTORY) => assessHouse(h, inventory, naming, EMPTY_PARAMETERS, guide(["lighting"]), NOTHING_INSTALLED, [])[0];
  expect(assess(EMPTY_INVENTORY).equipment.find((item) => item.key === "lights")?.status).toBe("missing");
  expect(assess(setRecipeWanted(EMPTY_INVENTORY, "living_room", "motion_lights", false)).stage).toBe("unplanned");
  expect(assess(setRecipeWanted(EMPTY_INVENTORY, "living_room", "motion_lights", true)).equipment.find((item) => item.key === "lights")?.status).toBe(
    "missing",
  );
});

describe("independent room automation records", () => {
  const room = (
    h: ReturnType<ReturnType<typeof house>["get"]>,
    inventory = EMPTY_INVENTORY,
    saved: import("./guide.ts").GuideSettings = guide(["lighting", "night", "ventilation"]),
    installed: import("./recipes.ts").RecipeInstalled | null = NOTHING_INSTALLED,
    changes: Change[] = [],
  ) => assessHouse(h, inventory, naming, EMPTY_PARAMETERS, saved, installed, changes)[0];
  const record = (area: ReturnType<typeof room>, key: RoomAutomationKey) => area.automations.find((item) => item.key === key)!;
  const check = (area: ReturnType<typeof room>, key: RoomAutomationKey, name: string) => {
    const automation = record(area, key);
    return [...automation.required, ...automation.optional].find((item) => item.key === name);
  };
  it("groups day and night as one native record with Occupancy dependency and reports only its own required readiness", () => {
    const fixture = house();
    fixture.add("sensor.living_lux", "demo", "illuminance", undefined, "250");
    fixture.add("binary_sensor.living_presence", "demo", "presence");
    fixture.add("binary_sensor.living_door", "demo", "door");
    const area = room(fixture.get());
    expect(area.automations.filter((item) => item.selected).map((item) => item.key)).toEqual(["motion_lights", "bathroom_fan"]);
    expect(record(area, "motion_lights")).toMatchObject({ selected: true, goals: ["lighting", "night"], totalRequired: 2, readyRequired: 2, stage: "recipes" });
    expect(record(area, "motion_lights").recipes.map(({ key }) => key)).toEqual(["occupancy", "motion_lights"]);
    expect(record(area, "motion_lights").optional.map(({ key, status }) => [key, status])).toEqual([
      ["holds", "ready"],
      ["lux", "ready"],
    ]);
    expect(record(area, "bathroom_fan")).toMatchObject({ readyRequired: 0, totalRequired: 2, stage: "equipment" });
  });

  it("counts only a live motion or presence start source or a counted opted-in TV", () => {
    const fixture = house();
    fixture.raw.entities = [];
    fixture.raw.states = [];
    fixture.add("binary_sensor.living_presence", "demo", "presence");
    fixture.add("media_player.living_tv", "demo", "tv", undefined, "playing");
    const h = fixture.get();
    const activity = (inventory = EMPTY_INVENTORY) => check(room(h, inventory), "occupancy", "activity");
    expect(activity()).toMatchObject({ status: "ready", usableEntityIds: ["binary_sensor.living_presence"] });
    const hold = setRole(h, EMPTY_INVENTORY, "binary_sensor.living_presence", "holds");
    expect(activity(hold)).toMatchObject({ status: "review", usableEntityIds: [] });
    const optedIn = setTvOccupancyRole(h, hold, "media_player.living_tv", "starts");
    expect(activity(optedIn)).toMatchObject({ status: "ready", usableEntityIds: ["media_player.living_tv"] });
    expect(activity(setTvOccupancyNotApplicable(optedIn, "living_room", true))).toMatchObject({ status: "review", usableEntityIds: [] });
    h.entities["media_player.living_tv"].state = "unavailable";
    expect(activity(optedIn)).toMatchObject({ status: "unavailable", usableEntityIds: [] });
  });

  it("separates a queued room assignment from a live candidate and ignores unrelated queued automations", () => {
    const h = house().get();
    const queuedMove: Change = {
      id: 1,
      kind: "entity",
      op: "update",
      targetId: "binary_sensor.living_pir",
      scope: null,
      before: { area_id: null },
      after: { area_id: "living_room" },
      createdAt: "now",
    };
    const otherRecipe: Change = {
      id: 2,
      kind: "automation",
      op: "create",
      targetId: "taxis_bathroom_fan_living",
      scope: null,
      before: {},
      after: { area_id: "living_room", recipe: "bathroom_fan" },
      createdAt: "now",
    };
    const read = (changes: Change[]) => room(h, EMPTY_INVENTORY, guide(["lighting", "ventilation"]), NOTHING_INSTALLED, changes);
    expect(record(read([otherRecipe]), "motion_lights").stage).toBe("recipes");
    const pending = read([queuedMove, otherRecipe]);
    expect(record(pending, "motion_lights")).toMatchObject({ readyRequired: 1, totalRequired: 2, stage: "changes" });
    expect(check(pending, "motion_lights", "activity")).toMatchObject({
      status: "queued",
      usableEntityIds: [],
      queuedEntityIds: ["binary_sensor.living_pir"],
    });
  });

  it("only counts an appliance-marked power sensor and uses doors for climate when requested", () => {
    const fixture = house();
    fixture.add("sensor.washer_power", "demo", "power", undefined, "90");
    fixture.add("climate.living", "demo", undefined, undefined, "heat");
    fixture.add("binary_sensor.living_door", "demo", "door");
    const h = fixture.get();
    const saved = guide(["climate", "appliances"]);
    const area = room(h, EMPTY_INVENTORY, saved);
    expect(check(area, "appliance_done", "power")).toMatchObject({ status: "review", candidateRole: "appliance", usableEntityIds: [] });
    expect(record(area, "area_climate")).toMatchObject({ readyRequired: 1, totalRequired: 1 });
    expect(check(area, "area_climate", "doors")).toBeUndefined();
    const marked = setAppliance(EMPTY_INVENTORY, "sensor.washer_power", true);
    expect(check(room(h, marked, saved), "appliance_done", "power")?.usableEntityIds).toEqual(["sensor.washer_power"]);
    const doors = setParameter(EMPTY_PARAMETERS, { level: "area", id: "living_room" }, "doors_open_count", true);
    const withDoors = assessHouse(h, EMPTY_INVENTORY, naming, doors, saved, NOTHING_INSTALLED, [])[0];
    expect(check(withDoors, "area_climate", "doors")).toMatchObject({ status: "ready", usableEntityIds: ["binary_sensor.living_door"] });
  });

  it("lets a reporting thermostat reach Parameters before the native planner validates the season", () => {
    const fixture = house();
    fixture.add("climate.living_heater", "demo", undefined, undefined, "heat");
    const h = fixture.get();
    const cooling = setParameter(EMPTY_PARAMETERS, { level: "house" }, "season", "cooling");
    const saved = guide(["climate"]);
    const read = (parameters: typeof EMPTY_PARAMETERS) =>
      record(assessHouse(h, EMPTY_INVENTORY, naming, parameters, saved, NOTHING_INSTALLED, [])[0], "area_climate");
    const mismatched = read(cooling);
    expect(mismatched).toMatchObject({ totalRequired: 1, readyRequired: 1, stage: "recipes" });
    expect(mismatched.recipes[0].cell).toMatchObject({ status: "missing", actionable: false, missing: [expect.stringContaining("cooling season")] });
    expect(read(EMPTY_PARAMETERS).recipes[0].cell).toMatchObject({ status: "ready", actionable: true });
    h.entities["climate.living_heater"].state = "unavailable";
    expect(read(cooling)).toMatchObject({ totalRequired: 1, readyRequired: 0, stage: "equipment" });
  });

  it("offers outdoor lighting for exterior areas and preserves existing indoor work", () => {
    const h = house().get();
    expect(room(h, EMPTY_INVENTORY, EMPTY_GUIDE).automations.some(({ key }) => key === "exterior_lights")).toBe(false);
    const exterior = setAreaType(EMPTY_INVENTORY, "living_room", "exterior");
    expect(record(room(h, exterior, EMPTY_GUIDE), "exterior_lights")).toMatchObject({ readyRequired: 1, totalRequired: 1 });

    const selected = record(room(h, EMPTY_INVENTORY, guide(["exterior"])), "exterior_lights");
    expect(selected.recipes[0].cell).toMatchObject({ status: "missing", actionable: false, missing: [expect.stringContaining("exterior area")] });
    const queued: Change = {
      id: 1,
      kind: "automation",
      op: "create",
      targetId: "taxis_exterior_lights_living",
      scope: null,
      before: {},
      after: { area_id: "living_room", recipe: "exterior_lights" },
      createdAt: "now",
    };
    const pending = record(room(h, EMPTY_INVENTORY, EMPTY_GUIDE, NOTHING_INSTALLED, [queued]), "exterior_lights");
    expect(pending.recipes[0].cell?.status).toBe("in-changes");
    const installed = {
      ...NOTHING_INSTALLED,
      automations: {
        [queued.targetId]: { alias: "Living exterior", path: blueprintForRecipe("exterior_lights").path, input: {} },
      },
    };
    expect(record(room(h, EMPTY_INVENTORY, EMPTY_GUIDE, installed), "exterior_lights")).toMatchObject({ installed: true });
  });

  it("retains a current test when unrelated choices change and preserves stale observations when a used source changes", () => {
    const fixture = house();
    fixture.add("timer.living_hold", "timer", undefined, undefined, "idle");
    fixture.add("input_boolean.living_paused", "input_boolean");
    fixture.add("binary_sensor.living_occupied", "template", "occupancy");
    fixture.add("automation.taxis_occupancy_living", "automation");
    const h = fixture.get();
    const initial = planRecipes(h, EMPTY_INVENTORY, naming, EMPTY_PARAMETERS, NOTHING_INSTALLED, []).find((cell) => cell.recipe === "occupancy")!;
    const fields = initial.inputs.find((input) => input.kind === "automation")!.fields!;
    const bp = fields.use_blueprint as { path: string; input: Record<string, unknown> };
    const installed = {
      ...NOTHING_INSTALLED,
      blueprints: { [bp.path]: blueprintForRecipe("occupancy").version },
      automations: { taxis_occupancy_living: { alias: fields.alias as string, path: bp.path, input: bp.input } },
    };
    const off = record(room(h, EMPTY_INVENTORY, guide(["occupancy", "ventilation"]), installed), "occupancy");
    expect(off).toMatchObject({ configured: true, installed: true, runtime: "disabled", stage: "check", testCurrent: false });
    expect(record(room(h, EMPTY_INVENTORY, guide(["occupancy"]), null), "occupancy")).toMatchObject({ configured: null, installed: null, stage: "unread" });
    h.entities["automation.taxis_occupancy_living"].state = "on";
    const ready = record(room(h, EMPTY_INVENTORY, guide(["occupancy", "ventilation"]), installed), "occupancy");
    expect(ready).toMatchObject({ configured: true, installed: true, runtime: "enabled", stage: "test", testCurrent: false });
    const test = {
      configuration: ready.configuration,
      checked: ready.checks.map(({ key }) => key),
      notes: "Observed here.",
      testedAt: "2026-10-28T00:00:00.000Z",
    };
    const saved = { ...guide(["occupancy", "openings"]), automationTests: { living_room: { occupancy: test } } };
    expect(validateGuide(saved)).toEqual({ ok: true, value: saved });
    expect(validateGuide({ ...saved, automationTests: { living_room: { arbitrary: test } } })).toMatchObject({ ok: false });
    expect(record(room(h, EMPTY_INVENTORY, saved, installed), "occupancy")).toMatchObject({ stage: "tested", testCurrent: true, testRecord: test });
    expect(record(room(h, EMPTY_INVENTORY, saved, installed), "left_open").testRecord).toBeNull();
    h.entities["binary_sensor.living_pir"].deviceId = "replacement";
    expect(record(room(h, EMPTY_INVENTORY, saved, installed), "occupancy")).toMatchObject({ stage: "test", testCurrent: false, testRecord: test });
  });
});
