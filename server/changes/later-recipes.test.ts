// Installing the recipes after Area climate over the fake Home Assistant: the
// bathroom fan with its rate sensor, exterior lights, the two that notify, and the
// announce script. Every call is recorded, so the tests say what was sent and, as
// important, what was not.

import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

import { buildMockRegistry, withRecipeDemo, withSmartDemo, type MockHome } from "../../scripts/mock-ha-core.ts";
import { ANNOUNCE_PATH, blueprintForRecipe } from "../../shared/blueprints.ts";
import { validateInput } from "../../shared/changes.ts";
import { helperChangeInputs, planHelpers } from "../../shared/helpers.ts";
import { EMPTY_INVENTORY, setAppliance, setAreaType, type InventorySettings } from "../../shared/inventory.ts";
import { DEFAULT_NAMING } from "../../shared/naming.ts";
import { EMPTY_PARAMETERS, setParameter, type ParameterSettings } from "../../shared/parameters.ts";
import { areaThermostats, canonicalLightGroups, planAnnounce, planRecipes, recipeChangeInputs, type RecipeCell } from "../../shared/recipes.ts";
import type { Change, ChangeInput } from "../../shared/types.ts";
import { WRITE_COMMANDS } from "../ha/socket.ts";
import { buildHierarchy, type RawRegistry } from "../model/hierarchy.ts";
import { fakeHa } from "../references/fake-ha.ts";
import { applyAll } from "./all.ts";
import { readInstalled } from "./recipes.ts";
import { changeStore } from "./store.ts";

const house = () => withSmartDemo(withRecipeDemo(buildMockRegistry()));

function setup(home: MockHome = house(), inventory: InventorySettings = EMPTY_INVENTORY) {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE changes (id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, op TEXT NOT NULL, target_id TEXT NOT NULL,
    scope TEXT, before TEXT NOT NULL, after TEXT NOT NULL, created_at TEXT NOT NULL)`);
  const store = changeStore(db);
  const fake = fakeHa(home);
  const live = () => buildHierarchy(structuredClone(fake.home), "now");
  const installed = () => readInstalled({ ha: fake.ha, rest: fake.api }, fake.home as RawRegistry, canonicalLightGroups(live(), DEFAULT_NAMING), areaThermostats(live()));
  const plan = async (params: ParameterSettings = EMPTY_PARAMETERS) => planRecipes(live(), inventory, DEFAULT_NAMING, params, await installed(), store.list());
  const announce = async (params: ParameterSettings = EMPTY_PARAMETERS) => planAnnounce(live(), inventory, DEFAULT_NAMING, params, await installed(), store.list());
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
  const done = () => store.list().forEach((x) => store.done(x.id));
  return { store, fake, live, installed, plan, announce, add, apply, cell, entity, state, done };
}

const ok = (results: { ok: boolean; message: string }[]) => {
  expect(results.map((r) => r.ok), results.map((r) => r.message).join(" | ")).toEqual(results.map(() => true));
};

describe("installing the bathroom fan", () => {
  it("makes the humidity helper, the rate sensor, the switch and the automation in one Apply, and the rate follows the helper", async () => {
    const t = setup();
    const humidity = planHelpers(t.live(), EMPTY_INVENTORY, DEFAULT_NAMING).find((r) => r.canonicalId === "sensor.bathroom_humidity")!;
    expect(humidity.status).toBe("create");
    t.add(helperChangeInputs(humidity));
    const c = t.cell(await t.plan(), "bathroom_fan", "bathroom");
    expect(c.status).toBe("ready");
    t.add(recipeChangeInputs([c]));
    expect(t.store.list().map((x) => `${x.kind}:${x.targetId}`)).toEqual([
      "helper:sensor.bathroom_humidity",
      "blueprint:taxis/bathroom_fan.yaml",
      "helper:input_boolean.bathroom_paused",
      "helper:sensor.bathroom_humidity_rate",
      "automation:taxis_bathroom_fan_bathroom",
    ]);

    const { results } = await t.apply();
    ok(results);
    // The derivative conversation: the handler, then the form, in the Home Assistant dialog's own words.
    const flows = t.fake.rest.filter((x) => x.method === "POST" && x.path.includes("config_entries")).map((x) => x.body);
    expect(flows).toEqual([
      { handler: "min_max" },
      { name: "Bathroom humidity", entity_ids: ["sensor.bathroom_hygro_humidity"], type: "mean", round_digits: 1 },
      { handler: "derivative" },
      { name: "Bathroom humidity rate", source: "sensor.bathroom_humidity", round: 3, unit_time: "s", time_window: { hours: 0, minutes: 2, seconds: 0 } },
    ]);
    expect(t.entity("sensor.bathroom_humidity_rate")).toMatchObject({ platform: "derivative", area_id: "bathroom" });
    expect(t.fake.home.configEntries.find((e) => e.entry_id === t.entity("sensor.bathroom_humidity_rate")!.config_entry_id)).toMatchObject({ domain: "derivative", entities: ["sensor.bathroom_humidity"] });
    expect(t.state("sensor.bathroom_humidity_rate")!.attributes).toMatchObject({ unit_of_measurement: "%/s" });
    // The blueprint is the text Taxis holds, written as an automation blueprint.
    expect(t.fake.home.blueprints[blueprintForRecipe("bathroom_fan").path]).toBe(blueprintForRecipe("bathroom_fan").yaml);
    expect(t.fake.home.automations.taxis_bathroom_fan_bathroom).toMatchObject({
      alias: "Bathroom – Bathroom fan (Taxis)",
      use_blueprint: {
        path: "taxis/bathroom_fan.yaml",
        input: {
          humidity_entity: "sensor.bathroom_humidity",
          rate_entity: "sensor.bathroom_humidity_rate",
          fan_entities: ["fan.bathroom_extractor"],
          rate_on: 0.03,
          delta_on: 10,
          abs_on: 80,
          delta_off: 3,
          flat_rate: 0.001,
          flat_minutes: 20,
          max_minutes: 60,
          suppress_in_sleep: false,
          pause_switch: "input_boolean.bathroom_paused",
        },
      },
    });
    expect(t.fake.home.states.find((s) => (s.attributes as { id?: string }).id === "taxis_bathroom_fan_bathroom")!.state).toBe("on");

    // Only the allowed writes; the flow handlers are the ones the allowlist names; nothing deleted.
    const writes = t.fake.ws.filter((x) => x.kind === "write");
    expect(writes.every((x) => WRITE_COMMANDS.has(x.type))).toBe(true);
    expect(t.fake.rest.every((x) => x.method === "GET" || x.method === "POST")).toBe(true);

    // Nothing is left to do.
    t.done();
    expect(t.cell(await t.plan(), "bathroom_fan", "bathroom")).toMatchObject({ status: "installed", inputs: [] });
  });

  it("makes the rate sensor again when it is gone, and Occupancy follows it once the rise is set", async () => {
    const t = setup();
    t.add(helperChangeInputs(planHelpers(t.live(), EMPTY_INVENTORY, DEFAULT_NAMING).find((r) => r.canonicalId === "sensor.bathroom_humidity")!));
    t.add(recipeChangeInputs([t.cell(await t.plan(), "bathroom_fan", "bathroom")]));
    ok((await t.apply()).results);
    t.done();

    // The rate sensor is removed by hand.
    t.fake.home.entities = t.fake.home.entities.filter((e) => e.entity_id !== "sensor.bathroom_humidity_rate");
    t.fake.home.states = t.fake.home.states.filter((s) => s.entity_id !== "sensor.bathroom_humidity_rate");
    const c = t.cell(await t.plan(), "bathroom_fan", "bathroom");
    expect(c).toMatchObject({ status: "out-of-date", reasons: ["sensor.bathroom_humidity_rate is missing"] });
    t.add(recipeChangeInputs([c]));
    ok((await t.apply()).results);
    expect(t.entity("sensor.bathroom_humidity_rate")).toMatchObject({ platform: "derivative" });
    t.done();
    expect(t.cell(await t.plan(), "bathroom_fan", "bathroom").status).toBe("installed");

    // Occupancy for the bathroom, with a shower holding it.
    const p = setParameter(EMPTY_PARAMETERS, { level: "area", id: "bathroom" }, "humidity_hold_rate", 0.02);
    const occupancy = t.cell(await t.plan(p), "occupancy", "bathroom");
    expect(occupancy.status).toBe("ready");
    t.add(recipeChangeInputs([occupancy]));
    ok((await t.apply()).results);
    expect(t.fake.home.automations.taxis_occupancy_bathroom).toMatchObject({
      use_blueprint: { path: "taxis/occupancy.yaml", input: { rate_entities: ["sensor.bathroom_humidity_rate"], rate_hold: 0.02 } },
    });
  });

  it("stops at a rate sensor that already exists under another id, rather than making a second", async () => {
    const home = house();
    home.entities.push({ entity_id: "sensor.old_bathroom_rate", platform: "derivative", config_entry_id: "OLDRATE", original_name: "Bathroom humidity rate" });
    home.states.push({ entity_id: "sensor.old_bathroom_rate", state: "0", attributes: { friendly_name: "Bathroom humidity rate" } });
    const t = setup(home);
    t.add(helperChangeInputs(planHelpers(t.live(), EMPTY_INVENTORY, DEFAULT_NAMING).find((r) => r.canonicalId === "sensor.bathroom_humidity")!));
    t.add(recipeChangeInputs([t.cell(await t.plan(), "bathroom_fan", "bathroom")]));
    const { results } = await t.apply();
    const rate = results[t.store.list().findIndex((x) => x.targetId === "sensor.bathroom_humidity_rate")];
    expect(rate.ok).toBe(false);
    expect(rate.message).toMatch(/derivative sensor named “Bathroom humidity rate” already exists as sensor.old_bathroom_rate/);
    expect(t.fake.rest.filter((x) => x.method === "POST" && JSON.stringify(x.body).includes('"derivative"'))).toEqual([]);
  });
});

describe("installing exterior lights", () => {
  it("is for an exterior area: the light group first, then the recipe, with the sunset offset in seconds", async () => {
    const inv = setAreaType(EMPTY_INVENTORY, "garden", "exterior");
    const t = setup(house(), inv);
    t.add(helperChangeInputs(planHelpers(t.live(), inv, DEFAULT_NAMING).find((r) => r.canonicalId === "light.garden_all")!));
    const p = setParameter(setParameter(EMPTY_PARAMETERS, { level: "type", id: "exterior" }, "exterior_sunset_offset", -30), { level: "house" }, "exterior_clock", 90);
    const c = t.cell(await t.plan(p), "exterior_lights", "garden");
    expect(c.status).toBe("ready");
    expect(c.notes).toEqual([]);
    t.add(recipeChangeInputs([c]));
    ok((await t.apply()).results);
    expect(t.fake.home.automations.taxis_exterior_lights_garden).toMatchObject({
      alias: "Garden – Exterior lights (Taxis)",
      use_blueprint: {
        path: "taxis/exterior_lights.yaml",
        input: {
          light_target: "light.garden_all",
          // The camera's own sensor sits on a device with a camera, so it is listed and not counted.
          motion_entities: ["binary_sensor.garden_pir"],
          person_entities: ["person.alex", "person.sam"],
          sunset_offset: -1800,
          clock_minutes: 90,
          override_timer: "timer.garden_override",
          override_minutes: 0,
          pause_switch: "input_boolean.garden_paused",
        },
      },
    });
    expect(t.state("timer.garden_override")!.attributes).toMatchObject({ duration: "1:00:00" });
    t.done();
    expect(t.cell(await t.plan(p), "exterior_lights", "garden").status).toBe("installed");
    // An area that isn't exterior is not offered it.
    expect(t.cell(await t.plan(p), "exterior_lights", "kitchen")).toMatchObject({ status: "missing", missing: expect.arrayContaining(["An exterior area (Capabilities, Type)"]) });
  });
});

describe("installing the recipes that notify", () => {
  it("Left open: a notify service is a name, not an entity, so nothing looks for it in Home Assistant", async () => {
    const t = setup();
    const p = setParameter(setParameter(EMPTY_PARAMETERS, { level: "house" }, "notify_targets", ["notify.mobile_app_phone", "notify.family"]), { level: "house" }, "left_open_repeat", 15);
    const c = t.cell(await t.plan(p), "left_open", "laundry");
    expect(c.status).toBe("ready");
    t.add(recipeChangeInputs([c]));
    const { results } = await t.apply();
    ok(results);
    expect(t.fake.home.automations.taxis_left_open_laundry).toMatchObject({
      use_blueprint: {
        path: "taxis/left_open.yaml",
        input: {
          door_entities: ["binary_sensor.laundry_door"],
          window_entities: ["binary_sensor.laundry_window"],
          door_minutes: 10,
          window_minutes: 30,
          repeat_minutes: 15,
          notify_targets: ["notify.mobile_app_phone", "notify.family"],
          area_name: "Laundry",
        },
      },
    });
    t.done();
    expect(t.cell(await t.plan(p), "left_open", "laundry").status).toBe("installed");
    // Taking a service out is a difference, and Apply writes it.
    const q = setParameter(p, { level: "house" }, "notify_targets", ["notify.family"]);
    const again = t.cell(await t.plan(q), "left_open", "laundry");
    expect(again.reasons).toEqual(["Notify services: notify.mobile_app_phone, notify.family → notify.family"]);
    t.add(recipeChangeInputs([again]));
    ok((await t.apply()).results);
    expect((t.fake.home.automations.taxis_left_open_laundry.use_blueprint as { input: { notify_targets: string[] } }).input.notify_targets).toEqual(["notify.family"]);
  });

  it("Appliance done: one automation for the appliances marked on the Capabilities tab", async () => {
    const inv = setAppliance(setAppliance(EMPTY_INVENTORY, "sensor.washer_power", true), "sensor.dryer_power", true);
    const t = setup(house(), inv);
    expect(t.cell(await t.plan(), "appliance_done", "laundry").status).toBe("ready");
    const c = t.cell(await t.plan(setParameter(EMPTY_PARAMETERS, { level: "house" }, "notify_targets", ["notify.mobile_app_phone"])), "appliance_done", "laundry");
    t.add(recipeChangeInputs([c]));
    ok((await t.apply()).results);
    expect(t.fake.home.automations.taxis_appliance_done_laundry).toMatchObject({
      alias: "Laundry – Appliance done (Taxis)",
      use_blueprint: {
        path: "taxis/appliance_done.yaml",
        input: { power_entities: ["sensor.dryer_power", "sensor.washer_power"], run_watts: 10, run_minutes: 2, idle_watts: 5, idle_minutes: 3, notify_targets: ["notify.mobile_app_phone"], area_name: "Laundry" },
      },
    });
    // The pause switch the automation names was made first.
    expect(t.entity("input_boolean.laundry_paused")).toMatchObject({ platform: "input_boolean", area_id: "laundry" });
  });
});

describe("installing announce", () => {
  const tts = setParameter(EMPTY_PARAMETERS, { level: "house" }, "tts_entity", "tts.home_assistant_cloud");

  it("writes the script blueprint, then the script, for the areas that have a speaker and Occupancy", async () => {
    const t = setup();
    const c = await t.announce(tts);
    expect(c.status).toBe("ready");
    // The kitchen has Occupancy installed (the demo); the laundry has a speaker and not yet Occupancy.
    expect(c.notes[0]).toBe("Laundry has speakers but no Occupancy yet, so it is left out");
    t.add(recipeChangeInputs([c]));
    expect(t.store.list().map((x) => `${x.kind}:${x.op}:${x.targetId}`)).toEqual(["blueprint:create:taxis/announce.yaml", "script:create:taxis_announce"]);
    const { results } = await t.apply();
    ok(results);

    // The blueprint goes in as a script blueprint; the script is a use of it.
    const save = t.fake.ws.find((x) => x.type === "blueprint/save")!;
    expect(save.payload).toMatchObject({ domain: "script", path: ANNOUNCE_PATH, allow_override: true });
    expect(t.fake.home.scriptBlueprints[ANNOUNCE_PATH]).toBe(blueprintForRecipe("announce").yaml);
    expect(t.fake.home.blueprints[ANNOUNCE_PATH]).toBeUndefined();
    expect(t.fake.home.scripts.taxis_announce).toEqual({
      alias: "Announce (Taxis)",
      description: "Made by Taxis from the taxis/announce.yaml blueprint. Changes made here are overwritten when the recipe is installed again.",
      use_blueprint: {
        path: ANNOUNCE_PATH,
        input: {
          areas: [{ occupied: "binary_sensor.kitchen_occupied", paused: "input_boolean.kitchen_paused", bed: [], speakers: ["media_player.kitchen_speaker"] }],
          tts_entity: "tts.home_assistant_cloud",
          default_volume: 40,
        },
      },
    });
    expect(t.state("script.taxis_announce")!.state).toBe("off");
    // The calls: a config POST for a script, no service.
    expect(t.fake.rest.filter((x) => x.method === "POST").map((x) => x.path)).toEqual(["/api/config/script/config/taxis_announce"]);
    expect(t.fake.rest.every((x) => !x.path.includes("/services/"))).toBe(true);

    t.done();
    const after = await t.announce(tts);
    expect(after).toMatchObject({ status: "installed", inputs: [] });
    expect((await t.installed()).scripts.taxis_announce).toMatchObject({ alias: "Announce (Taxis)", path: ANNOUNCE_PATH });
  });

  it("applying again sends nothing, and a speaker added later is a difference that Apply writes", async () => {
    const t = setup();
    t.add(recipeChangeInputs([await t.announce(tts)]));
    const changes = t.store.list();
    ok((await t.apply(changes)).results);
    const mark = { ws: t.fake.ws.length, rest: t.fake.rest.length };
    const second = await t.apply(changes);
    ok(second.results);
    expect(second.results.map((r) => r.message)).toEqual(["Applied (the blueprint was already this version).", "Applied (it was already like this)."]);
    expect(t.fake.ws.slice(mark.ws).filter((x) => x.kind === "write")).toEqual([]);
    expect(t.fake.rest.slice(mark.rest).filter((x) => x.method === "POST")).toEqual([]);
    t.done();

    t.fake.home.entities.push({ entity_id: "media_player.kitchen_hub", platform: "demo", area_id: "kitchen", original_name: "Kitchen hub" });
    t.fake.home.states.push({ entity_id: "media_player.kitchen_hub", state: "idle", attributes: { friendly_name: "Kitchen hub" } });
    const c = await t.announce(tts);
    expect(c).toMatchObject({ status: "out-of-date", reasons: ["Kitchen: speakers or bed sensors changed"] });
    t.add(recipeChangeInputs([c]));
    ok((await t.apply()).results);
    expect((t.fake.home.scripts.taxis_announce.use_blueprint as { input: { areas: { speakers: string[] }[] } }).input.areas[0].speakers).toEqual(["media_player.kitchen_hub", "media_player.kitchen_speaker"]);
  });

  it("follows a speaker renamed in the same Apply, inside the list of areas", async () => {
    const t = setup();
    t.add(recipeChangeInputs([await t.announce(tts)]));
    // The speaker is renamed in the same list: it has a new id by the time the script is written.
    t.add([{ kind: "entity", op: "update", targetId: "media_player.kitchen_speaker", fields: { new_entity_id: "media_player.kitchen_homepod" } }]);
    const { results } = await t.apply();
    ok(results);
    expect(t.entity("media_player.kitchen_homepod")).toBeDefined();
    expect((t.fake.home.scripts.taxis_announce.use_blueprint as { input: { areas: { speakers: string[] }[] } }).input.areas[0].speakers).toEqual(["media_player.kitchen_homepod"]);
  });

  it("doesn't write a script whose speaker is gone, or whose blueprint couldn't be written", async () => {
    const t = setup();
    t.add(recipeChangeInputs([await t.announce(tts)]));
    // The speaker disappears between planning and applying.
    t.fake.home.entities = t.fake.home.entities.filter((e) => e.entity_id !== "media_player.kitchen_speaker");
    t.fake.home.states = t.fake.home.states.filter((s) => s.entity_id !== "media_player.kitchen_speaker");
    const { results } = await t.apply();
    expect(results[1]).toMatchObject({ ok: false, message: "“media_player.kitchen_speaker” isn't in Home Assistant, so the script would not work. Apply again once it is there." });
    expect(t.fake.rest.filter((x) => x.method === "POST")).toEqual([]);

    const u = setup();
    u.add(recipeChangeInputs([await u.announce(tts)]));
    const ha = {
      command: u.fake.ha.command,
      write: async <T,>(type: string, payload: Record<string, unknown>): Promise<T> => {
        if (type === "blueprint/save") throw new Error("disk full");
        return u.fake.ha.write<T>(type, payload);
      },
    };
    const failed = (await u.apply(u.store.list(), { ha })).results;
    expect(failed.map((r) => r.ok)).toEqual([false, false]);
    expect(failed[1].message).toMatch(/doesn't have the current version of the blueprint, so the script would not load/);
    expect(u.fake.home.scripts.taxis_announce).toBeUndefined();
  });

  it("keeps the script blueprint apart from the automation blueprints when Taxis reads them", async () => {
    const t = setup();
    expect((await t.installed()).blueprints[ANNOUNCE_PATH]).toBeNull();
    t.add(recipeChangeInputs([await t.announce(tts)]));
    ok((await t.apply()).results);
    const installed = await t.installed();
    expect(installed.blueprints[ANNOUNCE_PATH]).toBe(blueprintForRecipe("announce").version);
    // Reading asked for each domain's list, and wrote nothing.
    expect(t.fake.ws.filter((x) => x.type === "blueprint/list").slice(-2).map((x) => x.payload)).toEqual([{ domain: "automation" }, { domain: "script" }]);
  });
});
