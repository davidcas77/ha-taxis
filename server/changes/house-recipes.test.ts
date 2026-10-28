// Installing the recipes of the house, and the leak alert and covers recipes, over
// the fake Home Assistant. Every call is recorded, so the tests say what was sent
// and, as important, what was not: no service, no area on a house recipe.

import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

import { buildMockRegistry, withRecipeDemo, withSmartDemo, type MockHome } from "../../scripts/mock-ha-core.ts";
import { GOODBYE_PATH, blueprintForRecipe } from "../../shared/blueprints.ts";
import { validateInput } from "../../shared/changes.ts";
import { HOUSE_AREAS_OCCUPIED_ID, HOUSE_AWAY_ID, HOUSE_OCCUPIED_ID, HOUSE_PAUSE_ID } from "../../shared/climate.ts";
import { helperChangeInputs, planHelpers } from "../../shared/helpers.ts";
import { EMPTY_INVENTORY } from "../../shared/inventory.ts";
import { DEFAULT_NAMING } from "../../shared/naming.ts";
import { EMPTY_PARAMETERS, setParameter, type ParameterSettings } from "../../shared/parameters.ts";
import { areaThermostats, canonicalLightGroups, planRecipes, recipeChangeInputs, type RecipeCell } from "../../shared/recipes.ts";
import { planHouseRecipes } from "../../shared/recipes-house.ts";
import type { Change, ChangeInput } from "../../shared/types.ts";
import { WRITE_COMMANDS } from "../ha/socket.ts";
import { buildHierarchy, type RawRegistry } from "../model/hierarchy.ts";
import { fakeHa } from "../references/fake-ha.ts";
import { applyAll } from "./all.ts";
import { readInstalled } from "./recipes.ts";
import { changeStore } from "./store.ts";

const house = () => withSmartDemo(withRecipeDemo(buildMockRegistry()));

function setup(home: MockHome = house()) {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE changes (id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, op TEXT NOT NULL, target_id TEXT NOT NULL,
    scope TEXT, before TEXT NOT NULL, after TEXT NOT NULL, created_at TEXT NOT NULL)`);
  const store = changeStore(db);
  const fake = fakeHa(home);
  const live = () => buildHierarchy(structuredClone(fake.home), "now");
  const installed = () =>
    readInstalled({ ha: fake.ha, rest: fake.api }, fake.home as RawRegistry, canonicalLightGroups(live(), DEFAULT_NAMING), areaThermostats(live()));
  const plan = async (params: ParameterSettings = EMPTY_PARAMETERS) =>
    planRecipes(live(), EMPTY_INVENTORY, DEFAULT_NAMING, params, await installed(), store.list());
  const houseCells = async (params: ParameterSettings = EMPTY_PARAMETERS) =>
    planHouseRecipes(live(), EMPTY_INVENTORY, DEFAULT_NAMING, params, await installed(), store.list());
  const add = (inputs: ChangeInput[]) => {
    for (const input of inputs) {
      expect(validateInput(input), JSON.stringify(input).slice(0, 100)).toBeNull();
      expect(store.add(input, live()), JSON.stringify(input).slice(0, 100)).toBeNull();
    }
  };
  const apply = (changes: Change[] = store.list()) => applyAll(changes, { ha: fake.ha, rest: fake.api, readFresh: fake.readFresh, sleep: async () => {} });
  const entity = (id: string) => fake.home.entities.find((e) => e.entity_id === id);
  const state = (id: string) => fake.home.states.find((s) => s.entity_id === id);
  const done = () => store.list().forEach((x) => store.done(x.id));
  return { store, fake, live, installed, plan, houseCells, add, apply, entity, state, done };
}

const ok = (results: { ok: boolean; message: string }[]) => {
  expect(
    results.map((r) => r.ok),
    results.map((r) => r.message).join(" | "),
  ).toEqual(results.map(() => true));
};
const of = (cells: RecipeCell[], recipe: string) => cells.find((c) => c.recipe === recipe)!;
const noServiceCalls = (t: ReturnType<typeof setup>) => {
  expect(t.fake.rest.every((x) => !x.path.includes("/services/"))).toBe(true);
  expect(t.fake.rest.every((x) => x.method === "GET" || x.method === "POST")).toBe(true);
  expect(t.fake.ws.filter((x) => x.kind === "write").every((x) => WRITE_COMMANDS.has(x.type))).toBe(true);
};

describe("installing low batteries", () => {
  it("writes the blueprint, the house pause switch with no area, and an automation with no area", async () => {
    const t = setup();
    const c = of(await t.houseCells(), "battery_low");
    expect(c.status).toBe("ready");
    t.add(recipeChangeInputs([c]));
    expect(t.store.list().map((x) => `${x.kind}:${x.op}:${x.targetId}`)).toEqual([
      "blueprint:create:taxis/battery_low.yaml",
      `helper:create:${HOUSE_PAUSE_ID}`,
      "automation:create:taxis_battery_low_house",
    ]);
    ok((await t.apply()).results);

    expect(t.fake.home.blueprints["taxis/battery_low.yaml"]).toBe(blueprintForRecipe("battery_low").yaml);
    expect(t.entity(HOUSE_PAUSE_ID)).toMatchObject({ platform: "input_boolean" });
    expect(t.entity(HOUSE_PAUSE_ID)!.area_id ?? null).toBeNull();
    expect(t.fake.home.automations.taxis_battery_low_house).toMatchObject({
      alias: "House – Low batteries (Taxis)",
      use_blueprint: { path: "taxis/battery_low.yaml", input: { threshold: 15, report_time: "09:00:00", notify_targets: [], pause_switch: HOUSE_PAUSE_ID } },
    });
    expect(t.fake.home.automations.taxis_battery_low_house).not.toHaveProperty("area_id");
    noServiceCalls(t);

    t.done();
    expect(of(await t.houseCells(), "battery_low")).toMatchObject({ status: "installed", inputs: [] });
    expect((await t.installed()).automations.taxis_battery_low_house).toMatchObject({ alias: "House – Low batteries (Taxis)", path: "taxis/battery_low.yaml" });
  });

  it("writes the automation again, once, when the level changes", async () => {
    const t = setup();
    t.add(recipeChangeInputs([of(await t.houseCells(), "battery_low")]));
    ok((await t.apply()).results);
    t.done();
    const params = setParameter(EMPTY_PARAMETERS, { level: "house" }, "battery_threshold", 25);
    const stale = of(await t.houseCells(params), "battery_low");
    expect(stale).toMatchObject({ status: "out-of-date", reasons: ["Battery low below (%): 15 → 25"] });
    t.add(recipeChangeInputs([stale]));
    expect(t.store.list().map((x) => `${x.kind}:${x.op}`)).toEqual(["automation:update"]);
    ok((await t.apply()).results);
    expect((t.fake.home.automations.taxis_battery_low_house.use_blueprint as { input: { threshold: number } }).input.threshold).toBe(25);
  });
});

describe("installing house presence", () => {
  it("makes the group of the occupied sensors, the occupied sensor on top of it, the away switch and the automation", async () => {
    const t = setup();
    const c = of(await t.houseCells(), "house_presence");
    expect(c.status).toBe("ready");
    t.add(recipeChangeInputs([c]));
    ok((await t.apply()).results);

    // The group follows the rooms that have Occupancy; the sensor is the template over it and the people.
    const group = t.entity(HOUSE_AREAS_OCCUPIED_ID)!;
    expect(group).toMatchObject({ platform: "group" });
    expect(group.area_id ?? null).toBeNull();
    const entry = t.fake.home.configEntries.find((e) => e.entry_id === group.config_entry_id)!;
    expect(entry.domain).toBe("group");
    expect(entry.entities).toContain("binary_sensor.kitchen_occupied");
    const sensor = t.entity(HOUSE_OCCUPIED_ID)!;
    expect(sensor).toMatchObject({ platform: "template" });
    expect(t.fake.home.configEntries.find((e) => e.entry_id === sensor.config_entry_id)).toMatchObject({ domain: "template", device_class: "occupancy" });
    expect(t.entity(HOUSE_AWAY_ID)).toMatchObject({ platform: "input_boolean" });
    expect(t.fake.home.automations.taxis_house_presence_house).toMatchObject({
      alias: "House – House presence (Taxis)",
      use_blueprint: {
        path: "taxis/house_presence.yaml",
        input: { occupied_entity: HOUSE_OCCUPIED_ID, away_entity: HOUSE_AWAY_ID, away_after_minutes: 30, end_on_return: false, pause_switch: HOUSE_PAUSE_ID },
      },
    });
    noServiceCalls(t);

    t.done();
    expect(of(await t.houseCells(), "house_presence")).toMatchObject({ status: "installed", inputs: [] });
  });
});

describe("installing goodbye", () => {
  it("writes the script blueprint and the script, after the house light group exists, and calls nothing", async () => {
    const t = setup();
    expect(of(await t.houseCells(), "goodbye").missing).toEqual(["The house light group (Helpers tab)"]);
    const row = planHelpers(t.live(), EMPTY_INVENTORY, DEFAULT_NAMING).find((r) => r.canonicalId === "light.all")!;
    t.add(helperChangeInputs(row));
    const c = of(await t.houseCells(), "goodbye");
    expect(c.status).toBe("ready");
    t.add(recipeChangeInputs([c]));
    expect(t.store.list().map((x) => `${x.kind}:${x.op}:${x.targetId}`)).toEqual([
      "helper:create:light.all",
      "blueprint:create:taxis/goodbye.yaml",
      `helper:create:${HOUSE_AWAY_ID}`,
      "script:create:taxis_goodbye",
    ]);
    ok((await t.apply()).results);

    const save = t.fake.ws.find((x) => x.type === "blueprint/save" && (x.payload as { path?: string }).path === GOODBYE_PATH)!;
    expect(save.payload).toMatchObject({ domain: "script", path: GOODBYE_PATH, allow_override: true });
    expect(t.fake.home.scriptBlueprints[GOODBYE_PATH]).toBe(blueprintForRecipe("goodbye").yaml);
    expect(t.fake.home.blueprints[GOODBYE_PATH]).toBeUndefined();
    expect(t.fake.home.scripts.taxis_goodbye).toMatchObject({
      alias: "Goodbye (Taxis)",
      use_blueprint: { path: GOODBYE_PATH, input: { light_target: "light.all", away_entity: HOUSE_AWAY_ID } },
    });
    expect((t.fake.home.scripts.taxis_goodbye.use_blueprint as { input: { media_entities: string[] } }).input.media_entities).toContain(
      "media_player.kitchen_speaker",
    );
    expect(t.state("script.taxis_goodbye")!.state).toBe("off");
    expect(t.fake.rest.filter((x) => x.method === "POST").map((x) => x.path)).toContain("/api/config/script/config/taxis_goodbye");
    noServiceCalls(t);

    t.done();
    expect(of(await t.houseCells(), "goodbye")).toMatchObject({ status: "installed", inputs: [] });
    expect((await t.installed()).scripts.taxis_goodbye).toMatchObject({ alias: "Goodbye (Taxis)", path: GOODBYE_PATH });
  });
});

describe("installing not reporting", () => {
  it("watches the counted sensors, and a sensor counted later makes it out of date", async () => {
    const t = setup();
    const c = of(await t.houseCells(), "unavailable_watch");
    expect(c.status).toBe("ready");
    t.add(recipeChangeInputs([c]));
    ok((await t.apply()).results);
    const input = (t.fake.home.automations.taxis_unavailable_watch_house.use_blueprint as { input: { watch_entities: string[]; unavailable_minutes: number } })
      .input;
    expect(input.unavailable_minutes).toBe(60);
    expect(input.watch_entities).toContain("binary_sensor.kitchen_motion");
    expect(input.watch_entities).toContain("binary_sensor.kitchen_leak");
    expect(input.watch_entities.some((id) => id.startsWith("light."))).toBe(false);
    expect([...input.watch_entities].sort()).toEqual(input.watch_entities);
    t.done();
    expect(of(await t.houseCells(), "unavailable_watch").status).toBe("installed");

    t.fake.home.entities.push({ entity_id: "binary_sensor.kitchen_door_new", platform: "demo", area_id: "kitchen" });
    t.fake.home.states.push({ entity_id: "binary_sensor.kitchen_door_new", state: "off", attributes: { device_class: "door" } });
    expect(of(await t.houseCells(), "unavailable_watch")).toMatchObject({ status: "out-of-date", reasons: ["Watched entities: 1 added, 0 no longer counted"] });
  });
});

describe("installing the leak alert and covers and sun", () => {
  it("installs the leak alert for the kitchen and the covers recipe for the bedroom with the settings of the house", async () => {
    const t = setup();
    let params = setParameter(EMPTY_PARAMETERS, { level: "house" }, "notify_targets", ["notify.mobile_app_phone"]);
    params = setParameter(params, { level: "house" }, "leak_repeat", 5);
    const cells = await t.plan(params);
    const leak = cells.find((c) => c.recipe === "leak_alert" && c.areaId === "kitchen")!;
    const covers = cells.find((c) => c.recipe === "covers_sun" && c.areaId === "bedroom")!;
    expect([leak.status, covers.status]).toEqual(["ready", "ready"]);
    t.add(recipeChangeInputs([leak, covers]));
    ok((await t.apply()).results);
    expect(t.fake.home.automations.taxis_leak_alert_kitchen).toMatchObject({
      alias: "Kitchen – Leak alert (Taxis)",
      use_blueprint: {
        path: "taxis/leak_alert.yaml",
        input: {
          leak_entities: ["binary_sensor.kitchen_leak"],
          notify_targets: ["notify.mobile_app_phone"],
          repeat_minutes: 5,
          area_name: "Kitchen",
          pause_switch: "input_boolean.kitchen_paused",
        },
      },
    });
    expect(t.fake.home.automations.taxis_covers_sun_bedroom).toMatchObject({
      alias: "Bedroom – Covers and sun (Taxis)",
      use_blueprint: {
        path: "taxis/covers_sun.yaml",
        input: { cover_entities: ["cover.bedroom_blind"], sun_elevation: 25, sunrise_offset: 1800, pause_switch: "input_boolean.bedroom_paused" },
      },
    });
    noServiceCalls(t);
    t.done();
    const after = await t.plan(params);
    expect(after.find((c) => c.recipe === "leak_alert" && c.areaId === "kitchen")).toMatchObject({ status: "installed", inputs: [] });
    expect(after.find((c) => c.recipe === "covers_sun" && c.areaId === "bedroom")).toMatchObject({ status: "installed", inputs: [] });
  });
});
