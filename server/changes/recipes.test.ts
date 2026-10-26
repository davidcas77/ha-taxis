// Installing a recipe over the fake Home Assistant: the blueprint, the helpers it
// needs and its automation, in the order Apply runs them, and what is checked
// afterwards. Every call is recorded, so the tests say what was sent and, as
// important, what was not.

import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

import { buildMockRegistry, withRecipeDemo } from "../../scripts/mock-ha-core.ts";
import { blueprintForRecipe } from "../../shared/blueprints.ts";
import { validateInput } from "../../shared/changes.ts";
import { helperChangeInputs, planHelpers } from "../../shared/helpers.ts";
import { EMPTY_INVENTORY } from "../../shared/inventory.ts";
import { DEFAULT_NAMING } from "../../shared/naming.ts";
import { EMPTY_PARAMETERS, setParameter, type ParameterSettings } from "../../shared/parameters.ts";
import { canonicalLightGroups, planRecipes, recipeChangeInputs, type RecipeCell } from "../../shared/recipes.ts";
import type { Change, ChangeInput } from "../../shared/types.ts";
import { WRITE_COMMANDS } from "../ha/socket.ts";
import { buildHierarchy, type RawRegistry } from "../model/hierarchy.ts";
import { fakeHa } from "../references/fake-ha.ts";
import { applyAll } from "./all.ts";
import { applyAutomationChanges, applyBlueprintChanges, readInstalled } from "./recipes.ts";
import { changeStore } from "./store.ts";

const OCC = blueprintForRecipe("occupancy");
const MOT = blueprintForRecipe("motion_lights");
const MEDIA = blueprintForRecipe("media_off");

function setup(home = buildMockRegistry()) {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE changes (id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, op TEXT NOT NULL, target_id TEXT NOT NULL,
    scope TEXT, before TEXT NOT NULL, after TEXT NOT NULL, created_at TEXT NOT NULL)`);
  const store = changeStore(db);
  const fake = fakeHa(home);
  const live = () => buildHierarchy(structuredClone(fake.home), "now");
  const installed = () => readInstalled({ ha: fake.ha, rest: fake.api }, fake.home as RawRegistry, canonicalLightGroups(live(), DEFAULT_NAMING));
  const plan = async (params: ParameterSettings = EMPTY_PARAMETERS) => planRecipes(live(), EMPTY_INVENTORY, DEFAULT_NAMING, params, await installed(), store.list());
  const add = (inputs: ChangeInput[]) => {
    for (const input of inputs) {
      expect(validateInput(input), JSON.stringify(input).slice(0, 100)).toBeNull();
      expect(store.add(input, live()), JSON.stringify(input).slice(0, 100)).toBeNull();
    }
  };
  const apply = (changes: Change[] = store.list(), extra: Partial<Parameters<typeof applyAll>[1]> = {}) =>
    applyAll(changes, { ha: fake.ha, rest: fake.api, readFresh: fake.readFresh, sleep: async () => {}, ...extra });
  const cell = (cells: RecipeCell[], recipe: string, area: string) => cells.find((c) => c.recipe === recipe && c.areaId === area)!;
  const entity = (id: string) => fake.home.entities.find((e) => e.entity_id === id);
  const state = (id: string) => fake.home.states.find((s) => s.entity_id === id);
  const index = (call: string) => fake.order.findIndex((o) => o === call);
  return { db, store, fake, live, installed, plan, add, apply, cell, entity, state, index };
}

// Study has one presence sensor and one light: the occupancy recipe's case.
const AUTOMATION_PATH = (id: string) => `POST /config/automation/config/${id}`;

describe("installing occupancy", () => {
  it("writes the blueprint, then the helpers, then the automation, and Home Assistant ends up as planned", async () => {
    const t = setup();
    const c = t.cell(await t.plan(), "occupancy", "study");
    expect(c.status).toBe("ready");
    t.add(recipeChangeInputs([c]));
    expect(t.store.list().map((x) => `${x.kind}:${x.op}:${x.targetId}`)).toEqual([
      "blueprint:create:taxis/occupancy.yaml",
      "helper:create:timer.study_hold",
      "helper:create:input_boolean.study_paused",
      "helper:create:binary_sensor.study_occupied",
      "automation:create:taxis_occupancy_study",
    ]);

    const { results } = await t.apply();
    expect(results.map((r) => r.ok), results.map((r) => r.message).join(" | ")).toEqual([true, true, true, true, true]);

    // The order: blueprint, timer and toggle, the template flow, the automation.
    const at = (call: string) => t.index(call);
    expect(at("write blueprint/save")).toBeGreaterThan(-1);
    expect(at("write blueprint/save")).toBeLessThan(at("write timer/create"));
    expect(at("write timer/create")).toBeLessThan(at("write input_boolean/create"));
    expect(at("write input_boolean/create")).toBeLessThan(at("POST /config/config_entries/flow"));
    expect(at("POST /config/config_entries/flow")).toBeLessThan(at(AUTOMATION_PATH("taxis_occupancy_study")));

    // What was sent.
    const writes = t.fake.ws.filter((x) => x.kind === "write");
    expect(writes.find((x) => x.type === "blueprint/save")!.payload).toEqual({ domain: "automation", path: OCC.path, yaml: OCC.yaml, allow_override: true });
    expect(writes.find((x) => x.type === "timer/create")!.payload).toEqual({ name: "Study hold", duration: "00:05:00", restore: true });
    expect(writes.find((x) => x.type === "input_boolean/create")!.payload).toEqual({ name: "Study automations paused", icon: "mdi:pause-circle-outline" });
    const flow = t.fake.rest.filter((x) => x.method === "POST" && x.path.includes("config_entries")).map((x) => x.body);
    expect(flow).toEqual([
      { handler: "template", show_advanced_options: false },
      { next_step_id: "binary_sensor" },
      { name: "Study occupied", state: "{{ is_state('timer.study_hold','active') }}", device_class: "occupancy" },
    ]);

    // What Home Assistant holds now.
    expect(t.fake.home.blueprints[OCC.path]).toBe(OCC.yaml);
    expect(t.entity("timer.study_hold")).toMatchObject({ platform: "timer", area_id: "study" });
    expect(t.state("timer.study_hold")!.attributes).toMatchObject({ duration: "0:05:00", restore: true });
    expect(t.entity("input_boolean.study_paused")).toMatchObject({ platform: "input_boolean", area_id: "study" });
    // No initial state: it starts off, so the area's recipes run.
    expect(t.state("input_boolean.study_paused")!.state).toBe("off");
    expect(t.entity("binary_sensor.study_occupied")).toMatchObject({ platform: "template", area_id: "study" });
    expect(t.fake.home.configEntries.find((e) => e.entry_id === t.entity("binary_sensor.study_occupied")!.config_entry_id)).toMatchObject({ domain: "template", device_class: "occupancy" });
    expect(t.fake.home.automations.taxis_occupancy_study).toMatchObject({
      id: "taxis_occupancy_study",
      alias: "Study – Occupancy (Taxis)",
      use_blueprint: {
        path: OCC.path,
        input: {
          starts_entities: ["binary_sensor.study_presence"],
          holds_entities: [],
          hold_timer: "timer.study_hold",
          hold_minutes: 5,
          pause_switch: "input_boolean.study_paused",
        },
      },
    });
    expect(t.fake.home.states.find((s) => (s.attributes as { id?: string }).id === "taxis_occupancy_study")!.state).toBe("on");

    // The plan has nothing left to do for it, and everything the recipe made stays out of the area's sensors.
    t.store.list().forEach((x) => t.store.done(x.id));
    const again = t.cell(await t.plan(), "occupancy", "study");
    expect(again).toMatchObject({ status: "installed", inputs: [] });

    // Only ever the allowed writes, never a delete.
    expect(writes.every((x) => WRITE_COMMANDS.has(x.type))).toBe(true);
    expect(t.fake.rest.every((x) => x.method === "GET" || x.method === "POST")).toBe(true);
  });

  it("applying the same changes again makes nothing twice", async () => {
    const t = setup();
    t.add(recipeChangeInputs([t.cell(await t.plan(), "occupancy", "study")]));
    const changes = t.store.list();
    expect((await t.apply(changes)).results.every((r) => r.ok)).toBe(true);
    const before = { ws: t.fake.ws.length, rest: t.fake.rest.length };

    const second = await t.apply(changes);
    expect(second.results.map((r) => r.ok), second.results.map((r) => r.message).join(" | ")).toEqual([true, true, true, true, true]);
    const fresh = t.fake.ws.slice(before.ws).filter((x) => x.kind === "write");
    // No blueprint, no timer, no toggle, no flow, no automation write.
    expect(fresh.map((x) => x.type)).toEqual([]);
    expect(t.fake.rest.slice(before.rest).filter((x) => x.method === "POST")).toEqual([]);
    expect(second.results.map((r) => r.message)).toEqual([
      "Applied (the blueprint was already this version).",
      "Applied (it was already there).",
      "Applied (it was already there).",
      "Applied (it was already there).",
      "Applied (it was already like this).",
    ]);
    expect(t.fake.home.entities.filter((e) => e.platform === "timer")).toHaveLength(1);
  });

  it("changes the timer and the automation when the hold timeout changes, and nothing else", async () => {
    const t = setup();
    t.add(recipeChangeInputs([t.cell(await t.plan(), "occupancy", "study")]));
    await t.apply();
    t.store.list().forEach((x) => t.store.done(x.id));

    const params = setParameter(EMPTY_PARAMETERS, { level: "house" }, "hold_timeout", 8);
    const c = t.cell(await t.plan(params), "occupancy", "study");
    expect(c.status).toBe("out-of-date");
    expect(c.reasons).toEqual(["Hold timeout (min): 5 → 8", "The hold timer is 5 min, the hold timeout says 8"]);
    t.add(recipeChangeInputs([c]));
    expect(t.store.list().map((x) => `${x.kind}:${x.op}`)).toEqual(["helper:update", "automation:update"]);
    const mark = t.fake.ws.length;
    const { results } = await t.apply();
    expect(results.map((r) => r.ok), results.map((r) => r.message).join(" | ")).toEqual([true, true]);
    expect(t.fake.ws.slice(mark).filter((x) => x.kind === "write").map((x) => [x.type, x.payload])).toEqual([["timer/update", { timer_id: "study_hold", duration: "00:08:00" }]]);
    expect(t.state("timer.study_hold")!.attributes).toMatchObject({ duration: "0:08:00" });
    expect((t.fake.home.automations.taxis_occupancy_study.use_blueprint as { input: { hold_minutes: number } }).input.hold_minutes).toBe(8);
    t.store.list().forEach((x) => t.store.done(x.id));
    expect(t.cell(await t.plan(params), "occupancy", "study").status).toBe("installed");
  });

  it("rewrites an older blueprint and says why the area is out of date", async () => {
    const t = setup();
    t.add(recipeChangeInputs([t.cell(await t.plan(), "occupancy", "study")]));
    await t.apply();
    t.store.list().forEach((x) => t.store.done(x.id));
    t.fake.home.blueprints[OCC.path] = OCC.yaml.replace(`Taxis blueprint version ${OCC.version}.`, "Taxis blueprint version 0.");
    const c = t.cell(await t.plan(), "occupancy", "study");
    expect(c.status).toBe("out-of-date");
    expect(c.reasons).toEqual([`The blueprint is version 0, Taxis has ${OCC.version}`]);
    t.add(recipeChangeInputs([c]));
    expect(t.store.list().map((x) => `${x.kind}:${x.op}`)).toEqual(["blueprint:update", "automation:update"]);
    expect((await t.apply()).results.every((r) => r.ok)).toBe(true);
    expect(t.fake.home.blueprints[OCC.path]).toBe(OCC.yaml);
  });
});

describe("installing motion lights", () => {
  it("makes the light group, the occupancy recipe and the motion lights automation in one Apply", async () => {
    const t = setup();
    // The stage 3 light group for the study, then the recipes that use it.
    const group = planHelpers(t.live(), EMPTY_INVENTORY, DEFAULT_NAMING).find((r) => r.canonicalId === "light.study_all")!;
    expect(group.status).toBe("create");
    t.add(helperChangeInputs(group));
    t.add(recipeChangeInputs([t.cell(await t.plan(), "occupancy", "study")]));
    const motion = t.cell(await t.plan(), "motion_lights", "study");
    expect(motion.status).toBe("ready");
    t.add(recipeChangeInputs([motion]));
    expect(t.store.list().map((x) => `${x.kind}:${x.targetId}`)).toEqual([
      "helper:light.study_all",
      "blueprint:taxis/occupancy.yaml",
      "helper:timer.study_hold",
      "helper:input_boolean.study_paused",
      "helper:binary_sensor.study_occupied",
      "automation:taxis_occupancy_study",
      "blueprint:taxis/motion_lights.yaml",
      "helper:timer.study_override",
      "automation:taxis_motion_lights_study",
    ]);

    const { results } = await t.apply();
    expect(results.map((r) => r.ok), results.map((r) => r.message).join(" | ")).toEqual(Array(9).fill(true));
    const flowAt = t.index("POST /config/config_entries/flow");
    expect(flowAt).toBeGreaterThan(-1);
    // Both blueprints before any helper; both automations after every helper; occupancy's first.
    expect(t.index("write blueprint/save")).toBeLessThan(flowAt);
    expect(t.fake.order.lastIndexOf("write blueprint/save")).toBeLessThan(t.index("write timer/create"));
    // The override timer is made with the other helpers, before the automation whose input names it.
    expect(t.fake.order.lastIndexOf("write timer/create")).toBeLessThan(t.index(AUTOMATION_PATH("taxis_occupancy_study")));
    expect(t.fake.order.lastIndexOf("POST /config/config_entries/flow")).toBeLessThan(t.index(AUTOMATION_PATH("taxis_occupancy_study")));
    expect(t.index(AUTOMATION_PATH("taxis_occupancy_study"))).toBeLessThan(t.index(AUTOMATION_PATH("taxis_motion_lights_study")));

    expect(t.fake.home.blueprints[MOT.path]).toBe(MOT.yaml);
    expect(t.fake.ws.filter((x) => x.type === "timer/create").map((x) => x.payload)).toEqual([
      { name: "Study hold", duration: "00:05:00", restore: true },
      { name: "Study override", duration: "01:00:00", restore: true },
    ]);
    expect(t.entity("timer.study_override")).toMatchObject({ platform: "timer", area_id: "study" });
    expect(t.state("timer.study_override")!.attributes).toMatchObject({ duration: "1:00:00", restore: true });
    expect(t.fake.home.automations.taxis_motion_lights_study).toMatchObject({
      alias: "Study – Motion lights (Taxis)",
      use_blueprint: {
        path: MOT.path,
        input: {
          occupied_entity: "binary_sensor.study_occupied",
          light_target: "light.study_all",
          pause_switch: "input_boolean.study_paused",
          night_start: "23:00:00",
          dim_before_off: 15,
          main_lights: ["light.desk"],
          accent_lights: [],
          night_lights: [],
          bed_entities: [],
          extended_after: 30,
          override_timer: "timer.study_override",
          override_minutes: 0,
        },
      },
    });
    t.store.list().forEach((x) => t.store.done(x.id));
    const cells = await t.plan();
    expect(cell(cells, "occupancy", "study")?.status).toBe("installed");
    expect(cell(cells, "motion_lights", "study")?.status).toBe("installed");
    // The occupied sensor, which is a template helper, is not one of the area's presence sensors.
    expect(t.live().entities["binary_sensor.study_occupied"].platform).toBe("template");
  });
});

describe("installing media off, and the override timer", () => {
  const demo = () => setup(withRecipeDemo(buildMockRegistry()));

  it("is ready where Occupancy is installed and a player counts, and installs: the blueprint, then the automation", async () => {
    const t = demo();
    const cells = await t.plan();
    const status = (area: string) => cell(cells, "media_off", area)!.status;
    // The living room's TV and the kitchen's speaker; Occupancy is installed in both (the kitchen's is out of date, which is enough).
    expect([status("living_room"), status("kitchen")]).toEqual(["ready", "ready"]);
    expect(cell(cells, "media_off", "study")!.missing).toEqual(["Occupancy (install it first)", "A speaker or a TV that counts (Capabilities)"]);
    expect(cell(cells, "media_off", "garage")!.missing).toEqual(["Occupancy (install it first)", "A speaker or a TV that counts (Capabilities)"]);

    t.add(recipeChangeInputs([cell(cells, "media_off", "living_room")!, cell(cells, "media_off", "kitchen")!]));
    expect(t.store.list().map((x) => `${x.kind}:${x.op}:${x.targetId}`)).toEqual([
      "blueprint:create:taxis/media_off.yaml",
      "automation:create:taxis_media_off_living",
      "automation:create:taxis_media_off_kitchen",
    ]);
    const { results } = await t.apply();
    expect(results.map((r) => r.ok), results.map((r) => r.message).join(" | ")).toEqual([true, true, true]);
    expect(t.fake.home.blueprints[MEDIA.path]).toBe(MEDIA.yaml);
    expect(t.fake.home.automations.taxis_media_off_living).toMatchObject({
      alias: "Living room – Media off (Taxis)",
      use_blueprint: {
        path: MEDIA.path,
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
    expect((t.fake.home.automations.taxis_media_off_kitchen.use_blueprint as { input: Record<string, unknown> }).input).toMatchObject({ speaker_entities: ["media_player.kitchen_speaker"], tv_entities: [] });
    // No helper of its own: it uses Occupancy's. Only the allowed writes, and nothing deleted.
    const writes = t.fake.ws.filter((x) => x.kind === "write");
    expect(writes.map((x) => x.type)).toEqual(["blueprint/save"]);
    expect(writes.every((x) => WRITE_COMMANDS.has(x.type))).toBe(true);
    expect(t.fake.rest.every((x) => x.method === "GET" || x.method === "POST")).toBe(true);

    t.store.list().forEach((x) => t.store.done(x.id));
    const again = await t.plan();
    expect(cell(again, "media_off", "living_room")).toMatchObject({ status: "installed", inputs: [] });
    expect(cell(again, "media_off", "kitchen")).toMatchObject({ status: "installed", inputs: [] });
  });

  it("changes only the automation when a media time changes", async () => {
    const t = demo();
    t.add(recipeChangeInputs([cell(await t.plan(), "media_off", "living_room")!]));
    await t.apply();
    t.store.list().forEach((x) => t.store.done(x.id));
    const params = setParameter(EMPTY_PARAMETERS, { level: "area", id: "living_room" }, "tv_off_after", 45);
    const c = cell(await t.plan(params), "media_off", "living_room")!;
    expect(c.reasons).toEqual(["TVs off when clear for (min): 30 → 45"]);
    t.add(recipeChangeInputs([c]));
    const mark = t.fake.ws.length;
    const { results } = await t.apply();
    expect(results.every((r) => r.ok), results.map((r) => r.message).join(" | ")).toBe(true);
    expect(t.fake.ws.slice(mark).filter((x) => x.kind === "write")).toEqual([]);
    expect((t.fake.home.automations.taxis_media_off_living.use_blueprint as { input: { tv_minutes: number } }).input.tv_minutes).toBe(45);
  });

  it("makes the override timer with the motion lights, and follows the override setting with a timer update", async () => {
    const t = demo();
    t.add(recipeChangeInputs([cell(await t.plan(), "motion_lights", "living_room")!]));
    expect((await t.apply()).results.every((r) => r.ok)).toBe(true);
    expect(t.fake.ws.filter((x) => x.type === "timer/create").map((x) => x.payload)).toEqual([{ name: "Living room override", duration: "01:00:00", restore: true }]);
    expect(t.entity("timer.living_override")).toMatchObject({ platform: "timer", area_id: "living_room" });
    t.store.list().forEach((x) => t.store.done(x.id));
    expect(cell(await t.plan(), "motion_lights", "living_room")).toMatchObject({ status: "installed", inputs: [] });

    const params = setParameter(EMPTY_PARAMETERS, { level: "house" }, "override_duration", 30);
    const c = cell(await t.plan(params), "motion_lights", "living_room")!;
    expect(c.reasons).toEqual(["Manual override lasts (min): 0 → 30", "The override timer is 60 min, the override setting says 30"]);
    t.add(recipeChangeInputs([c]));
    const mark = t.fake.ws.length;
    const { results } = await t.apply();
    expect(results.every((r) => r.ok), results.map((r) => r.message).join(" | ")).toBe(true);
    expect(t.fake.ws.slice(mark).filter((x) => x.kind === "write").map((x) => [x.type, x.payload])).toEqual([["timer/update", { timer_id: "living_room_override", duration: "00:30:00" }]]);
    expect((t.fake.home.automations.taxis_motion_lights_living.use_blueprint as { input: { override_minutes: number } }).input.override_minutes).toBe(30);
    t.store.list().forEach((x) => t.store.done(x.id));
    expect(cell(await t.plan(params), "motion_lights", "living_room")!.status).toBe("installed");
  });

  it("brings an area installed with the older blueprints up to date: new blueprint text, new inputs", async () => {
    const t = demo();
    // The living room as version 2 left it: the older blueprint and an automation without the newer inputs.
    t.fake.home.blueprints[OCC.path] = OCC.yaml.replace(`Taxis blueprint version ${OCC.version}.`, "Taxis blueprint version 2.");
    const input = (t.fake.home.automations.taxis_occupancy_living.use_blueprint as { input: Record<string, unknown> }).input;
    for (const key of ["bed_entities", "occupied_entity", "extended_after", "extended_hold", "sleep_hold"]) delete input[key];
    const c = cell(await t.plan(), "occupancy", "living_room")!;
    expect(c.status).toBe("out-of-date");
    expect(c.reasons).toEqual([
      "Extended after (min): none → 30",
      "Extended hold timeout (min): none → 15",
      "Sleep hold timeout (min): none → 60",
      "Occupied sensor: none → binary_sensor.living_occupied",
      "The blueprint is version 2, Taxis has 3",
    ]);
    t.add(recipeChangeInputs([c]));
    expect(t.store.list().map((x) => `${x.kind}:${x.op}`)).toEqual(["blueprint:update", "automation:update"]);
    const { results } = await t.apply();
    expect(results.every((r) => r.ok), results.map((r) => r.message).join(" | ")).toBe(true);
    expect(t.fake.home.blueprints[OCC.path]).toBe(OCC.yaml);
    expect((t.fake.home.automations.taxis_occupancy_living.use_blueprint as { input: Record<string, unknown> }).input).toMatchObject({
      occupied_entity: "binary_sensor.living_occupied",
      extended_after: 30,
      extended_hold: 15,
      sleep_hold: 60,
      bed_entities: [],
    });
    t.store.list().forEach((x) => t.store.done(x.id));
    expect(cell(await t.plan(), "occupancy", "living_room")!.status).toBe("installed");
  });
});

const cell = (cells: RecipeCell[], recipe: string, area: string) => cells.find((c) => c.recipe === recipe && c.areaId === area);

describe("when a step fails", () => {
  it("reports the automation, not a silent half-install, when its blueprint couldn't be written", async () => {
    const t = setup();
    t.add(recipeChangeInputs([t.cell(await t.plan(), "occupancy", "study")]));
    const ha = {
      command: t.fake.ha.command,
      write: async <T,>(type: string, payload: Record<string, unknown>): Promise<T> => {
        if (type === "blueprint/save") throw new Error("disk full");
        return t.fake.ha.write<T>(type, payload);
      },
    };
    const { results } = await t.apply(t.store.list(), { ha });
    expect(results.map((r) => r.ok)).toEqual([false, true, true, true, false]);
    expect(results[0].message).toBe("Home Assistant refused it: disk full");
    expect(results[4].message).toMatch(/doesn't have the current version of the blueprint/);
    expect(t.fake.rest.filter((x) => x.method === "POST" && x.path.includes("/automation/"))).toEqual([]);
    expect(t.fake.home.automations.taxis_occupancy_study).toBeUndefined();
  });

  it("doesn't send anything when the blueprints can't be read first", async () => {
    const t = setup();
    t.add(recipeChangeInputs([t.cell(await t.plan(), "occupancy", "study")]));
    t.fake.failRead.add("blueprint/list");
    const { results } = await t.apply();
    expect(results[0]).toMatchObject({ ok: false, message: expect.stringContaining("couldn't read Home Assistant's blueprints first") });
    expect(results[4]).toMatchObject({ ok: false, message: expect.stringContaining("couldn't read Home Assistant first") });
    expect(t.fake.ws.some((x) => x.type === "blueprint/save")).toBe(false);
    expect(t.fake.rest.some((x) => x.method === "POST" && x.path.includes("/automation/"))).toBe(false);
  });

  it("stops at a helper that already exists under another id, and the automation says what it lacks", async () => {
    const home = buildMockRegistry();
    // A timer called "Study hold" that isn't at the id Taxis wants.
    home.entities.push({ entity_id: "timer.old_study", platform: "timer", unique_id: "old_study", original_name: "Study hold" });
    home.states.push({ entity_id: "timer.old_study", state: "idle", attributes: { friendly_name: "Study hold", duration: "0:05:00" } });
    const t = setup(home);
    t.add(recipeChangeInputs([t.cell(await t.plan(), "occupancy", "study")]));
    const { results } = await t.apply();
    expect(results.map((r) => r.ok)).toEqual([true, false, true, true, false]);
    expect(results[1].message).toMatch(/timer named “Study hold” already exists as timer.old_study/);
    expect(results[1].message).toMatch(/Rename it to timer.study_hold/);
    expect(results[4].message).toMatch(/“timer.study_hold” isn't in Home Assistant/);
    expect(t.fake.home.entities.filter((e) => e.platform === "timer")).toHaveLength(1);
  });

  it("reports an automation Home Assistant saved but couldn't load", async () => {
    const t = setup();
    t.add(recipeChangeInputs([t.cell(await t.plan(), "occupancy", "study")]));
    t.fake.after = ({ rest }) => {
      if (rest?.method === "POST" && rest.path.endsWith("taxis_occupancy_study")) {
        const s = t.fake.home.states.find((x) => (x.attributes as { id?: string }).id === "taxis_occupancy_study");
        if (s) s.state = "unavailable";
      }
    };
    const { results } = await t.apply();
    expect(results[4]).toMatchObject({ ok: false, message: expect.stringContaining("couldn't load it") });
  });

  it("reports a stored config that is not what was sent", async () => {
    const t = setup();
    t.add(recipeChangeInputs([t.cell(await t.plan(), "occupancy", "study")]));
    t.fake.after = ({ rest }) => {
      if (rest?.method === "POST" && rest.path.endsWith("taxis_occupancy_study")) t.fake.home.automations.taxis_occupancy_study.alias = "Something else";
    };
    const { results } = await t.apply();
    expect(results[4]).toMatchObject({ ok: false, message: "Home Assistant stored something different from what Taxis sent." });
  });

  it("follows a sensor that is renamed in the same Apply", async () => {
    const t = setup();
    t.add(recipeChangeInputs([t.cell(await t.plan(), "occupancy", "study")]));
    const rename: Change = { id: 900, kind: "entity", op: "update", targetId: "binary_sensor.study_presence", scope: null, before: { new_entity_id: "binary_sensor.study_presence" }, after: { new_entity_id: "binary_sensor.study_mmwave" }, createdAt: "" };
    const { results } = await t.apply([rename, ...t.store.list()]);
    expect(results.every((r) => r.ok), results.map((r) => r.message).join(" | ")).toBe(true);
    expect((t.fake.home.automations.taxis_occupancy_study.use_blueprint as { input: { starts_entities: string[] } }).input.starts_entities).toEqual(["binary_sensor.study_mmwave"]);
  });
});

describe("the change list", () => {
  const blueprint = (): ChangeInput => ({ kind: "blueprint", op: "create", fields: { path: OCC.path, version: OCC.version } });

  it("holds one change per blueprint and per automation, keyed by what it makes", async () => {
    const t = setup();
    const c = t.cell(await t.plan(), "occupancy", "study");
    t.add(recipeChangeInputs([c]));
    t.add(recipeChangeInputs([c]).filter((i) => i.kind === "blueprint" || i.kind === "automation"));
    t.add([blueprint()]);
    expect(t.store.list().map((x) => x.targetId)).toEqual([
      "taxis/occupancy.yaml",
      "timer.study_hold",
      "input_boolean.study_paused",
      "binary_sensor.study_occupied",
      "taxis_occupancy_study",
    ]);
    // None of them has a temporary id, and removing one leaves the rest alone.
    expect(t.store.list().some((x) => x.targetId.startsWith("new:"))).toBe(false);
    t.store.remove(t.store.list()[0].id);
    expect(t.store.list()).toHaveLength(4);
  });

  it("refuses an automation for an area that is gone, and a duration for something that isn't a UI timer", async () => {
    const t = setup(withRecipeDemo(buildMockRegistry()));
    const auto = (t.cell(await t.plan(), "occupancy", "study").inputs.find((i) => i.kind === "automation"))!;
    expect(t.store.add({ ...auto, fields: { ...auto.fields, area_id: "nowhere" } }, t.live())).toBe("That area isn't in Home Assistant any more.");
    expect(t.store.add({ kind: "helper", op: "update", targetId: "timer.nowhere", fields: { duration: 600 } }, t.live())).toBe("That timer isn't in Home Assistant any more.");
    expect(t.store.add({ kind: "helper", op: "update", targetId: "light.desk", fields: { duration: 600 } }, t.live())).toBe("Taxis only changes the duration of a timer.");
    // A timer written in YAML has no registry entry.
    t.fake.home.states.push({ entity_id: "timer.yaml_one", state: "idle", attributes: { duration: "0:05:00" } });
    expect(t.store.add({ kind: "helper", op: "update", targetId: "timer.yaml_one", fields: { duration: 600 } }, t.live())).toMatch(/isn't set up in the Home Assistant UI/);
    expect(t.store.add({ kind: "helper", op: "update", targetId: "timer.living_hold", fields: { duration: 600 } }, buildHierarchy(structuredClone(t.fake.home), "now"))).toBeNull();
    // A second edit of the same timer replaces the first.
    expect(t.store.add({ kind: "helper", op: "update", targetId: "timer.living_hold", fields: { duration: 900 } }, t.live())).toBeNull();
    expect(t.store.list().filter((x) => x.targetId === "timer.living_hold").map((x) => x.after)).toEqual([{ duration: 900 }]);
  });
});

describe("what Taxis reads to plan the recipes", () => {
  const demo = () => setup(withRecipeDemo(buildMockRegistry()));

  it("reads only: blueprint versions, Taxis's own automations, timer durations and who else controls each light group", async () => {
    const t = demo();
    const installed = await t.installed();
    expect(installed.blueprints).toEqual({ [OCC.path]: OCC.version, [MOT.path]: null, [MEDIA.path]: null });
    expect(Object.keys(installed.automations).sort()).toEqual(["taxis_occupancy_kitchen", "taxis_occupancy_living"]);
    expect(installed.automations.taxis_occupancy_kitchen).toMatchObject({ alias: "Kitchen – Occupancy (Taxis)", path: OCC.path });
    expect(installed.timers["timer.living_hold"]).toBe(300);
    expect(installed.timers["timer.kitchen_hold"]).toBe(180);
    // The household's own automation is listed; Taxis's own is not.
    expect(installed.controllers).toEqual({ "light.living_all": [{ entityId: "automation.living_room_evening_lights", name: "Living room evening lights" }] });
    expect(t.fake.writes()).toEqual({ ws: [], rest: [] });
    // Only GETs of automations Taxis made: nothing else was read over REST.
    expect(t.fake.rest.map((x) => x.path)).toEqual(expect.arrayContaining(["/api/config/automation/config/taxis_occupancy_living", "/api/config/automation/config/taxis_occupancy_kitchen"]));
    expect(t.fake.rest.every((x) => /^\/api\/config\/automation\/config\/taxis_/.test(x.path))).toBe(true);
  });

  it("shows every status in the demo house", async () => {
    const t = demo();
    const cells = await t.plan();
    const status = (recipe: string, area: string) => cell(cells, recipe, area)!.status;
    expect(status("occupancy", "living_room")).toBe("installed");
    expect(status("motion_lights", "living_room")).toBe("ready");
    expect(status("occupancy", "kitchen")).toBe("out-of-date");
    expect(cell(cells, "occupancy", "kitchen")!.reasons).toEqual(["Hold timeout (min): 3 → 5", "The hold timer is 3 min, the hold timeout says 5"]);
    expect(status("motion_lights", "kitchen")).toBe("missing");
    expect(cell(cells, "motion_lights", "kitchen")!.missing).toEqual(["A light group (make it on the Helpers tab)"]);
    expect(status("occupancy", "study")).toBe("ready");
    expect(cell(cells, "motion_lights", "study")!.missing).toEqual(["Occupancy (install it first)", "A light group (make it on the Helpers tab)"]);
    expect(status("occupancy", "hallway")).toBe("ready");
    expect(status("occupancy", "bedroom")).toBe("missing");
    expect(status("occupancy", "garage")).toBe("missing");
    expect(new Set(cells.map((c) => c.status))).toEqual(new Set(["installed", "ready", "out-of-date", "missing"]));
    // The living room lights are used by another automation: a warning, not a block.
    expect(cell(cells, "motion_lights", "living_room")!.controlledBy.map((c) => c.name)).toEqual(["Living room evening lights"]);
    // Adding a cell puts it "in changes".
    t.add(recipeChangeInputs([cell(cells, "occupancy", "study")!]));
    expect(cell(await t.plan(), "occupancy", "study")!.status).toBe("in-changes");
  });

  it("installs the demo's motion lights: the blueprint is written, the automation made, and the warning stays true", async () => {
    const t = demo();
    t.add(recipeChangeInputs([cell(await t.plan(), "motion_lights", "living_room")!]));
    expect(t.store.list().map((x) => `${x.kind}:${x.op}:${x.targetId}`)).toEqual([
      "blueprint:create:taxis/motion_lights.yaml",
      "helper:create:timer.living_override",
      "automation:create:taxis_motion_lights_living",
    ]);
    const { results } = await t.apply();
    expect(results.map((r) => r.ok), results.map((r) => r.message).join(" | ")).toEqual([true, true, true]);
    expect(Object.keys(t.fake.home.blueprints).sort()).toEqual([MOT.path, OCC.path].sort());
    expect(t.fake.home.automations.taxis_motion_lights_living.use_blueprint).toMatchObject({ input: { override_timer: "timer.living_override", main_lights: ["light.living_lamp", "light.living_spots"] } });
  });
});

describe("blueprints and automations on their own", () => {
  it("applyBlueprintChanges and applyAutomationChanges ignore other kinds, and send nothing for an empty list", async () => {
    const t = setup();
    const helper: Change = { id: 1, kind: "helper", op: "create", targetId: "timer.x", scope: null, before: {}, after: {}, createdAt: "" };
    const io = { ha: t.fake.ha, rest: t.fake.api, readFresh: t.fake.readFresh, sleep: async () => {} };
    expect(await applyBlueprintChanges([helper], io)).toEqual([]);
    expect(await applyAutomationChanges([helper], io)).toEqual([]);
    expect(t.fake.ws).toEqual([]);
    expect(t.fake.rest).toEqual([]);
  });

  it("refuses to write a blueprint Taxis does not hold, and one with a version it no longer has", async () => {
    const t = setup();
    const io = { ha: t.fake.ha, rest: t.fake.api, readFresh: t.fake.readFresh, sleep: async () => {} };
    const odd: Change = { id: 1, kind: "blueprint", op: "create", targetId: "taxis/other.yaml", scope: null, before: {}, after: { path: "taxis/other.yaml", version: 1 }, createdAt: "" };
    expect(await applyBlueprintChanges([odd], io)).toEqual([{ changeId: 1, ok: false, message: "Taxis has no blueprint at that path any more." }]);
    expect(t.fake.ws.filter((x) => x.kind === "write")).toEqual([]);
  });
});
