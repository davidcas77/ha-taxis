import { describe, expect, it } from "vitest";
import { buildHierarchy, type RawRegistry } from "../server/model/hierarchy.ts";
import { helperChangeInputs, planHelpers, planSpaceLightGroup } from "./helpers.ts";
import { planHouseModes } from "./house-modes.ts";
import { EMPTY_INVENTORY } from "./inventory.ts";
import { DEFAULT_NAMING } from "./naming.ts";
import { EMPTY_PARAMETERS, paramRows, resolve, setParameter } from "./parameters.ts";
import { NOTHING_INSTALLED, planRecipes } from "./recipes.ts";
import { planHouseRecipes } from "./recipes-house.ts";
import { areaSpace, planSpaceLabels, resolveSpaces, spaceIds } from "./spaces.ts";
import type { Change } from "./types.ts";

const raw: RawRegistry = {
  config: { location_name: "Space test" },
  floors: [{ floor_id: "first", name: "First" }],
  areas: [
    { area_id: "office_a", name: "Office coffee", floor_id: "first", labels: ["office", "room"] },
    { area_id: "office_b", name: "Office work", floor_id: "first", labels: ["office"] },
    { area_id: "home", name: "Home", floor_id: "first", labels: ["home"] },
    { area_id: "free", name: "Free" },
  ],
  devices: [],
  labels: [
    { label_id: "office", name: "Space: Office" },
    { label_id: "home", name: "Space: Home" },
    { label_id: "room", name: "Kitchen" },
  ],
  entities: [
    { entity_id: "light.office_a_lamp", platform: "mqtt", area_id: "office_a" },
    { entity_id: "light.office_a_all", platform: "group", area_id: "office_a" },
    { entity_id: "light.office_b_lamp", platform: "mqtt", area_id: "office_b" },
    { entity_id: "light.office_b_all", platform: "group", area_id: "office_b" },
    { entity_id: "light.home_lamp", platform: "mqtt", area_id: "home" },
    { entity_id: "light.home_all", platform: "group", area_id: "home" },
    { entity_id: "media_player.office_speaker", platform: "mqtt", area_id: "office_a" },
    { entity_id: "media_player.home_speaker", platform: "mqtt", area_id: "home" },
    { entity_id: "climate.office_heat", platform: "mqtt", area_id: "office_a" },
    { entity_id: "person.outside", platform: "person" },
  ],
  states: [
    { entity_id: "light.office_a_lamp", state: "on", attributes: {} },
    { entity_id: "light.office_a_all", state: "on", attributes: { entity_id: ["light.office_a_lamp"] } },
    { entity_id: "light.office_b_lamp", state: "on", attributes: {} },
    { entity_id: "light.office_b_all", state: "on", attributes: { entity_id: ["light.office_b_lamp"] } },
    { entity_id: "light.home_lamp", state: "on", attributes: {} },
    { entity_id: "light.home_all", state: "on", attributes: { entity_id: ["light.home_lamp"] } },
    { entity_id: "media_player.office_speaker", state: "on", attributes: {} },
    { entity_id: "media_player.home_speaker", state: "on", attributes: {} },
    { entity_id: "climate.office_heat", state: "heat", attributes: {} },
    { entity_id: "person.outside", state: "home", attributes: {} },
  ],
};
const h = () => buildHierarchy(structuredClone(raw), "now");
const naming = { ...DEFAULT_NAMING, areaCodes: { office_a: "office_a", office_b: "office_b", home: "home", free: "free" } };
const office = (tree: ReturnType<typeof h>) => resolveSpaces(tree).find((space) => space.id === "office")!;

describe("native label Spaces", () => {
  it("identifies membership by label ID and preserves unrelated labels, with safe pending and duplicate handling", () => {
    const tree = h();
    expect(office(tree).areaIds).toEqual(["office_a", "office_b"]);
    expect(areaSpace(tree, "free").kind).toBe("legacy");
    expect(planSpaceLabels(tree, "office_a", "home")).toEqual({ ok: true, labels: ["room", "home"] });
    tree.areas.office_a.labels.push("home");
    expect(areaSpace(tree, "office_a").kind).toBe("conflict");
    expect(planSpaceLabels(tree, "office_a", "home")).toEqual({ ok: true, labels: ["room", "home"] });
    tree.areas.office_a.labels = ["office", "room"];
    expect(
      paramRows(tree, EMPTY_INVENTORY)
        .fixed.filter((row) => row.scope.level === "space")
        .map((row) => row.label),
    ).toEqual(["Space · Home", "Space · Office"]);
    const pending = [
      { id: 1, kind: "area", op: "update", targetId: "free", scope: null, before: { labels: [] }, after: { labels: ["office"] }, createdAt: "" },
    ] as Change[];
    expect(areaSpace(tree, "free", pending).kind).toBe("conflict");
    tree.labels["new:label:44"] = { ...tree.labels.office, id: "new:label:44", name: "Space: New" };
    expect(planSpaceLabels(tree, "free", "new:label:44")).toEqual({ ok: true, labels: ["new:label:44"] });
    expect(resolveSpaces(tree).find((space) => space.id === "new:label:44")?.blocked).toBeTruthy();
    expect(resolveSpaces(tree, pending).find((space) => space.id === "office")?.blocked).toContain("pending");
    const before = spaceIds("office").lights;
    tree.labels.office.name = "Space: Renamed office";
    expect(spaceIds("office").lights).toBe(before);
    tree.labels.dupe = { ...tree.labels.office, id: "dupe", name: "space: RENAMED OFFICE" };
    expect(resolveSpaces(tree).find((space) => space.id === "office")?.blocked).toContain("More than one");
  });

  it("makes a Space group only from its own safe area groups, even on a shared floor", () => {
    const tree = h();
    const planned = planSpaceLightGroup(tree, EMPTY_INVENTORY, naming, [], office(tree));
    expect(planned.status, planned.reason ?? "").toBe("create");
    expect(planned.members).toEqual(["light.office_a_all", "light.office_b_all"]);
    expect(planned.members).not.toContain("light.home_all");
    tree.entities["light.office_a_all"].members.push("light.home_lamp");
    expect(planSpaceLightGroup(tree, EMPTY_INVENTORY, naming, [], office(tree))).toMatchObject({ status: "blocked" });
    tree.entities["light.office_a_all"].members = ["light.office_a_lamp"];
    const pending = [
      { id: 1, kind: "helper", op: "update", targetId: "light.office_a_all", scope: null, before: {}, after: { entities: ["light.home_lamp"] }, createdAt: "" },
    ] as Change[];
    expect(planSpaceLightGroup(tree, EMPTY_INVENTORY, naming, pending, office(tree))).toMatchObject({
      status: "blocked",
      reason: expect.stringContaining("pending"),
    });
  });

  it("tags standalone area helpers and modes, and blocks them while membership is pending", () => {
    const tree = h();
    delete tree.entities["light.office_a_all"];
    tree.areas.office_a.entityIds = tree.areas.office_a.entityIds.filter((id) => id !== "light.office_a_all");
    const row = planHelpers(tree, EMPTY_INVENTORY, naming).find((item) => item.areaId === "office_a" && item.key === "lights")!;
    expect(helperChangeInputs(row)[0]).toMatchObject({ space: { labelId: "office", areaIds: ["office_a", "office_b"] } });
    tree.entities["sensor.office_raw_temperature"] = {
      ...tree.entities["light.office_a_lamp"],
      entityId: "sensor.office_raw_temperature",
      domain: "sensor",
      deviceClass: "temperature",
      areaId: "office_a",
    };
    tree.areas.office_a.entityIds.push("sensor.office_raw_temperature");
    const tempCreate = planHelpers(tree, EMPTY_INVENTORY, naming).find((item) => item.areaId === "office_a" && item.key === "temperature")!;
    expect(tempCreate.status).toBe("create");
    expect(helperChangeInputs(tempCreate)[0]).toMatchObject({ space: { labelId: "office" }, fields: { set_area_sensor: "temperature" } });
    tree.entities["sensor.office_a_temperature"] = {
      ...tree.entities["sensor.office_raw_temperature"],
      entityId: "sensor.office_a_temperature",
      platform: "min_max",
      configEntryId: "fixture",
    };
    tree.areas.office_a.entityIds.push("sensor.office_a_temperature");
    tree.areas.office_a.temperatureEntityId = "sensor.office_a_temperature";
    const alreadyAssigned = planHelpers(tree, EMPTY_INVENTORY, naming).find((item) => item.areaId === "office_a" && item.key === "temperature")!;
    expect(alreadyAssigned.status).toBe("in-place");
    expect(alreadyAssigned.actionable).toBe(false);
    expect(helperChangeInputs(alreadyAssigned)).toEqual([]);
    tree.areas.office_a.temperatureEntityId = null;
    const tempExisting = planHelpers(tree, EMPTY_INVENTORY, naming).find((item) => item.areaId === "office_a" && item.key === "temperature")!;
    expect(tempExisting.scopeBlocked).toContain("sources cannot be verified");
    expect(helperChangeInputs(tempExisting)).toEqual([]);
    tree.entities["sensor.office_a_temperature"].members = ["sensor.office_raw_temperature"];
    const verifiedTemp = planHelpers(tree, EMPTY_INVENTORY, naming).find((item) => item.areaId === "office_a" && item.key === "temperature")!;
    expect(verifiedTemp.status).toBe("in-place");
    expect(helperChangeInputs(verifiedTemp)[0]).toMatchObject({
      kind: "area",
      targetId: "office_a",
      space: { labelId: "office" },
      fields: { temperature_entity_id: "sensor.office_a_temperature" },
    });
    const away = planHouseModes(tree, EMPTY_PARAMETERS, EMPTY_INVENTORY, [], "office_a").find((mode) => mode.key === "away")!;
    expect(away.inputs[0]).toMatchObject({ space: { labelId: "office", areaIds: ["office_a", "office_b"] } });
    const pending = [
      {
        id: 1,
        kind: "area",
        op: "update",
        targetId: "office_a",
        scope: null,
        before: { labels: ["office", "room"] },
        after: { labels: ["home", "room"] },
        createdAt: "",
      },
    ] as Change[];
    const blocked = planHelpers(tree, EMPTY_INVENTORY, naming, pending).find((item) => item.areaId === "office_a" && item.key === "lights")!;
    expect(blocked.scopeBlocked).toContain("pending");
    expect(helperChangeInputs(blocked)).toEqual([]);
    expect(
      planHouseModes(tree, EMPTY_PARAMETERS, EMPTY_INVENTORY, pending, "office_a").every((mode) => mode.status === "review" && mode.inputs.length === 0),
    ).toBe(true);
  });

  it("isolates Space control defaults while preserving explicit area and Space bindings", () => {
    const tree = h();
    let params = setParameter(EMPTY_PARAMETERS, { level: "house" }, "away_mode_entity", "input_boolean.global");
    params = setParameter(params, { level: "house" }, "notify_targets", ["notify.global"]);
    expect(resolve(params, tree, EMPTY_INVENTORY, "office_a", "away_mode_entity").value).toBe("");
    expect(resolve(params, tree, EMPTY_INVENTORY, "office_a", "notify_targets").value).toEqual([]);
    expect(resolve(params, tree, EMPTY_INVENTORY, "free", "away_mode_entity").value).toBe("input_boolean.global");
    params = setParameter(params, { level: "space", id: "office" }, "away_mode_entity", "input_boolean.office_away");
    expect(resolve(params, tree, EMPTY_INVENTORY, "office_a", "away_mode_entity").value).toBe("input_boolean.office_away");
    params = setParameter(params, { level: "area", id: "office_a" }, "away_mode_entity", "input_boolean.office_room");
    expect(resolve(params, tree, EMPTY_INVENTORY, "office_a", "away_mode_entity").value).toBe("input_boolean.office_room");
    expect(planHouseModes(tree, EMPTY_PARAMETERS, EMPTY_INVENTORY, [], "office_a").find((x) => x.key === "away")?.id).toBe(spaceIds("office").away);
    params = setParameter(params, { level: "area", id: "office_a" }, "away_mode_entity", spaceIds("home").away);
    expect(planHouseModes(tree, params, EMPTY_INVENTORY, [], "office_a").find((x) => x.key === "away")).toMatchObject({
      status: "review",
      detail: expect.stringContaining("another Space"),
    });
    tree.entities["input_boolean.other_custom"] = {
      ...tree.entities["light.home_lamp"],
      entityId: "input_boolean.other_custom",
      domain: "input_boolean",
      platform: "input_boolean",
      areaId: "home",
      state: "off",
    };
    params = setParameter(params, { level: "area", id: "office_a" }, "away_mode_entity", "input_boolean.other_custom");
    expect(planHouseModes(tree, params, EMPTY_INVENTORY, [], "office_a").find((x) => x.key === "away")).toMatchObject({
      status: "review",
      detail: expect.stringContaining("another Space"),
    });
    const climate = planRecipes(tree, EMPTY_INVENTORY, naming, params, NOTHING_INSTALLED, []).find(
      (cell) => cell.areaId === "office_a" && cell.recipe === "area_climate",
    )!;
    expect(climate.status).toBe("missing");
    expect(climate.inputs).toEqual([]);
    params = setParameter(params, { level: "area", id: "office_a" }, "sleep_mode_entity", "input_boolean.other_custom");
    params = setParameter(params, { level: "area", id: "office_a" }, "fan_suppress_in_sleep", true);
    const fan = planRecipes(tree, EMPTY_INVENTORY, naming, params, NOTHING_INSTALLED, []).find(
      (cell) => cell.areaId === "office_a" && cell.recipe === "bathroom_fan",
    )!;
    expect(fan.missing.join(" ")).toContain("another Space");
    expect(fan.inputs).toEqual([]);
  });

  it("uses Space-specific, selection-based wording in scoped guidance", () => {
    const tree = h();
    for (const id of ["office_a", "office_b"]) tree.areas[id].entityIds = tree.areas[id].entityIds.filter((entityId) => !entityId.startsWith("light."));
    const scope = { kind: "space" as const, space: office(tree) };
    expect(planSpaceLightGroup(tree, EMPTY_INVENTORY, naming, [], scope.space).reason).toBe("This Space has no selected lights.");
    const params = setParameter(EMPTY_PARAMETERS, { level: "space", id: "office" }, "away_mode_entity", "input_boolean.missing");
    const cells = planHouseRecipes(tree, EMPTY_INVENTORY, naming, params, NOTHING_INSTALLED, [], false, scope);
    expect(cells.find((cell) => cell.recipe === "goodbye")!.missing.join(" ")).toContain("Parameters, Space");
    expect(cells.find((cell) => cell.recipe === "announce")!.missing.join(" ")).toContain("Parameters, Space");
    expect(cells.find((cell) => cell.recipe === "announce")!.missing.join(" ")).toContain("selected speaker");
  });

  it("plans scoped House recipes independently and never falls back to global targets", () => {
    const tree = h();
    const scopes = resolveSpaces(tree);
    const plans = scopes.map((space) =>
      planHouseRecipes(tree, EMPTY_INVENTORY, naming, EMPTY_PARAMETERS, NOTHING_INSTALLED, [], false, { kind: "space", space }),
    );
    const goodbyes = plans.map((cells) => cells.find((cell) => cell.recipe === "goodbye")!);
    expect(goodbyes.map((cell) => cell.targetId)).toEqual(scopes.map((space) => spaceIds(space.id).goodbye));
    expect(goodbyes.every((cell) => cell.status === "missing" && cell.inputs.length === 0)).toBe(true); // group must be live and verified
    expect(plans.every((cells) => cells.find((cell) => cell.recipe === "battery_low")?.missing[0].includes("whole Home Assistant"))).toBe(true);
    const area = planRecipes(tree, EMPTY_INVENTORY, naming, EMPTY_PARAMETERS, NOTHING_INSTALLED, []);
    const exterior = area.find((cell) => cell.areaId === "office_a" && cell.recipe === "exterior_lights")!;
    expect(exterior.inputs.every((input) => input.kind === "blueprint" || input.space?.labelId === "office")).toBe(true);
  });
  it("builds independent Goodbye, presence, announcement and climate inputs for two Spaces", () => {
    const tree = h();
    const spaces = resolveSpaces(tree);
    const idsA = spaceIds("office");
    const idsB = spaceIds("home");
    const copyEntity = (id: string, domain: string, platform: string, members: string[] = []) => {
      tree.entities[id] = {
        ...tree.entities["light.office_a_all"],
        entityId: id,
        name: id,
        domain,
        platform,
        areaId: null,
        members,
        state: "off",
        inRegistry: true,
        configEntryId: "fixture",
      };
    };
    copyEntity(idsA.lights, "light", "group", ["light.office_a_all", "light.office_b_all"]);
    copyEntity(idsB.lights, "light", "group", ["light.home_all"]);
    copyEntity("binary_sensor.office_a_occupied", "binary_sensor", "template");
    copyEntity("binary_sensor.home_occupied", "binary_sensor", "template");
    copyEntity("input_boolean.office_a_paused", "input_boolean", "input_boolean");
    copyEntity("input_boolean.home_paused", "input_boolean", "input_boolean");
    tree.entities["binary_sensor.office_a_occupied"].areaId = "office_a";
    tree.entities["binary_sensor.home_occupied"].areaId = "home";
    tree.entities["input_boolean.office_a_paused"].areaId = "office_a";
    tree.entities["input_boolean.home_paused"].areaId = "home";
    copyEntity("tts.office", "tts", "tts");
    copyEntity("tts.home", "tts", "tts");
    const installed = structuredClone(NOTHING_INSTALLED);
    installed.automations.taxis_occupancy_office_a = { alias: "Office", path: "taxis/occupancy.yaml", input: {} };
    installed.automations.taxis_occupancy_home = { alias: "Home", path: "taxis/occupancy.yaml", input: {} };
    let params = setParameter(EMPTY_PARAMETERS, { level: "space", id: "office" }, "tts_entity", "tts.office");
    params = setParameter(params, { level: "space", id: "home" }, "tts_entity", "tts.home");
    const plan = (id: string) =>
      planHouseRecipes(tree, EMPTY_INVENTORY, naming, params, installed, [], false, { kind: "space", space: spaces.find((space) => space.id === id)! });
    const input = (cells: ReturnType<typeof plan>, key: string) =>
      (
        cells.find((cell) => cell.recipe === key)!.inputs.find((change) => change.kind === "script" || change.kind === "automation")!.fields!.use_blueprint as {
          input: Record<string, unknown>;
        }
      ).input;
    const officePlan = plan("office");
    const homePlan = plan("home");
    expect(input(officePlan, "goodbye")).toMatchObject({ light_target: idsA.lights, media_entities: ["media_player.office_speaker"], away_entity: idsA.away });
    expect(input(homePlan, "goodbye")).toMatchObject({ light_target: idsB.lights, media_entities: ["media_player.home_speaker"], away_entity: idsB.away });
    expect(
      officePlan.find((cell) => cell.recipe === "house_presence")?.status,
      JSON.stringify(officePlan.find((cell) => cell.recipe === "house_presence")?.missing),
    ).toBe("ready");
    expect(input(officePlan, "house_presence")).toMatchObject({ occupied_entity: idsA.areasOccupied, away_entity: idsA.away, pause_switch: idsA.pause });
    expect(input(homePlan, "house_presence")).toMatchObject({ occupied_entity: idsB.areasOccupied, away_entity: idsB.away, pause_switch: idsB.pause });
    const helperNames = (cells: ReturnType<typeof plan>, recipe: string) =>
      cells
        .find((cell) => cell.recipe === recipe)!
        .inputs.filter((change) => change.kind === "helper" && change.op === "create")
        .map((change) => change.fields?.name);
    expect(helperNames(officePlan, "house_presence")).toContain("Taxis Office Space areas occupied");
    expect(helperNames(homePlan, "house_presence")).toContain("Taxis Home Space areas occupied");
    expect(helperNames(officePlan, "house_presence")).toContain("Taxis Office Space automations paused");
    expect(helperNames(homePlan, "house_presence")).toContain("Taxis Home Space automations paused");
    expect(input(officePlan, "announce")).toMatchObject({
      tts_entity: "tts.office",
      areas: [{ occupied: "binary_sensor.office_a_occupied", speakers: ["media_player.office_speaker"] }],
    });
    expect(input(homePlan, "announce")).toMatchObject({
      tts_entity: "tts.home",
      areas: [{ occupied: "binary_sensor.home_occupied", speakers: ["media_player.home_speaker"] }],
    });
    const climate = planRecipes(tree, EMPTY_INVENTORY, naming, params, installed, [], true).find(
      (cell) => cell.areaId === "office_a" && cell.recipe === "area_climate",
    )!;
    const automation = climate.inputs.find((change) => change.kind === "automation")!;
    expect((automation.fields!.use_blueprint as { input: Record<string, unknown> }).input).toMatchObject({ away_entity: idsA.away, sleep_entity: idsA.sleep });
    expect(automation.space?.labelId).toBe("office");
    expect(climate.inputs.filter((change) => change.kind === "helper").map((change) => change.fields?.name)).toContain("Taxis Office away mode");
    copyEntity(idsA.areasOccupied, "binary_sensor", "group", ["binary_sensor.home_occupied"]);
    const unsafePresence = plan("office").find((cell) => cell.recipe === "house_presence")!;
    expect(unsafePresence.status).toBe("missing");
    expect(unsafePresence.inputs).toEqual([]);
    tree.entities["valve.home_water"] = { ...tree.entities["light.home_lamp"], entityId: "valve.home_water", domain: "valve", areaId: "home" };
    tree.entities["binary_sensor.office_leak"] = {
      ...tree.entities["light.office_a_lamp"],
      entityId: "binary_sensor.office_leak",
      domain: "binary_sensor",
      deviceClass: "moisture",
      areaId: "office_a",
    };
    tree.areas.office_a.entityIds.push("binary_sensor.office_leak");
    params = setParameter(params, { level: "space", id: "office" }, "leak_valve_entity", "valve.home_water");
    const leak = planRecipes(tree, EMPTY_INVENTORY, naming, params, installed, []).find((cell) => cell.areaId === "office_a" && cell.recipe === "leak_alert")!;
    expect(leak.missing).toContain("The water valve “valve.home_water” is not assigned to an area in this Space. Review its assignment before using it.");
    tree.areas.office_a.labels.push("home");
    expect(
      planRecipes(tree, EMPTY_INVENTORY, naming, params, installed, []).find((cell) => cell.areaId === "office_a" && cell.recipe === "area_climate"),
    ).toMatchObject({ status: "missing", inputs: [] });
  });
});
