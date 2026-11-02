import { expect, it } from "vitest";
import { validateInput } from "../../shared/changes.ts";
import { buildHierarchy, type RawRegistry } from "../model/hierarchy.ts";
import { DEFAULT_NAMING } from "../../shared/naming.ts";
import { EMPTY_INVENTORY, setCounts } from "../../shared/inventory.ts";
import { EMPTY_PARAMETERS, setParameter } from "../../shared/parameters.ts";
import { NOTHING_INSTALLED } from "../../shared/recipes.ts";
import { planHouseRecipes } from "../../shared/recipes-house.ts";
import { resolveSpaces, spaceIds } from "../../shared/spaces.ts";
import { settingEffects } from "./direct-settings.ts";

function house() {
  const raw: RawRegistry = {
    config: {},
    floors: [],
    areas: [
      { area_id: "office", name: "Office", labels: ["sp_office"] },
      { area_id: "studio", name: "Studio", labels: ["sp_studio"] },
    ],
    labels: [
      { label_id: "sp_office", name: "Space: Office" },
      { label_id: "sp_studio", name: "Space: Studio" },
    ],
    devices: [],
    entities: [],
    states: [],
  };
  for (const area of ["office", "studio"]) {
    const ids = [`media_player.${area}_speaker`, `binary_sensor.${area}_occupied`, `input_boolean.${area}_paused`];
    for (const id of ids) {
      const platform = id.startsWith("binary_sensor") ? "template" : id.startsWith("input_boolean") ? "input_boolean" : "mqtt";
      raw.entities.push({ entity_id: id, platform, area_id: area, config_entry_id: "fixture", unique_id: id });
      raw.states.push({ entity_id: id, state: "off", attributes: {} });
    }
  }
  raw.entities.push({ entity_id: "tts.office", platform: "tts" }, { entity_id: "tts.studio", platform: "tts" });
  raw.states.push({ entity_id: "tts.office", state: "idle", attributes: {} }, { entity_id: "tts.studio", state: "idle", attributes: {} });
  return buildHierarchy(raw, "now");
}

it("projects only the changed Space script, preserving its existing unrelated drift", () => {
  const h = house();
  const naming = { ...DEFAULT_NAMING, areaCodes: { office: "office", studio: "studio" } };
  let params = setParameter(EMPTY_PARAMETERS, { level: "house" }, "tts_entity", "tts.office");
  params = setParameter(params, { level: "space", id: "sp_office" }, "tts_entity", "tts.office");
  params = setParameter(params, { level: "space", id: "sp_studio" }, "tts_entity", "tts.studio");
  const installed = structuredClone(NOTHING_INSTALLED);
  for (const area of ["office", "studio"]) installed.automations[`taxis_occupancy_${area}`] = { alias: area, path: "taxis/occupancy.yaml", input: {} };
  for (const space of resolveSpaces(h)) {
    const cell = planHouseRecipes(h, EMPTY_INVENTORY, naming, params, installed, [], true, { kind: "space", space }).find((x) => x.recipe === "announce")!;
    const script = cell.inputs.find((x) => x.kind === "script")!;
    const blueprint = script.fields!.use_blueprint as { path: string; input: Record<string, unknown> };
    installed.scripts[spaceIds(space.id).announce] = {
      alias: String(script.fields!.alias),
      path: blueprint.path,
      input: { ...blueprint.input, tts_entity: "tts.preserved" },
    };
  }
  const legacy = planHouseRecipes(h, EMPTY_INVENTORY, naming, params, installed, [], true).find((x) => x.recipe === "announce")!;
  const legacyScript = legacy.inputs.find((x) => x.kind === "script")!;
  const legacyBlueprint = legacyScript.fields!.use_blueprint as { path: string; input: Record<string, unknown> };
  installed.scripts.taxis_announce = { alias: String(legacyScript.fields!.alias), path: legacyBlueprint.path, input: legacyBlueprint.input };
  const after = setParameter(params, { level: "space", id: "sp_office" }, "announce_volume", 65);
  const result = settingEffects(h, naming, { inventory: EMPTY_INVENTORY, parameters: params }, { inventory: EMPTY_INVENTORY, parameters: after }, installed);
  expect(result).toHaveProperty("inputs");
  if (!("inputs" in result)) return;
  expect(result.inputs).toHaveLength(1);
  const update = result.inputs[0];
  expect(update).toMatchObject({ kind: "script", space: { labelId: "sp_office", areaIds: ["office"] }, fields: { script_id: spaceIds("sp_office").announce } });
  expect((update.fields!.use_blueprint as { input: Record<string, unknown> }).input).toMatchObject({
    default_volume: 65,
    tts_entity: "tts.preserved",
  });
  expect(validateInput(update)).toBeNull();
});

it("projects only the safe member delta for a scoped area group", () => {
  const h = house();
  const naming = { ...DEFAULT_NAMING, areaCodes: { office: "office", studio: "studio" } };
  const example = h.entities["media_player.office_speaker"];
  for (const name of ["a", "b", "drift"]) {
    const id = `light.office_${name}`;
    h.entities[id] = { ...example, entityId: id, name: id, domain: "light", platform: "mqtt", areaId: "office", disabled: name === "drift" };
    h.areas.office.entityIds.push(id);
  }
  h.entities["light.office_all"] = {
    ...example,
    entityId: "light.office_all",
    name: "Office all",
    domain: "light",
    platform: "group",
    areaId: "office",
    configEntryId: "fixture",
    members: ["light.office_a", "light.office_b", "light.office_drift"],
  };
  h.areas.office.entityIds.push("light.office_all");
  const next = setCounts(h, EMPTY_INVENTORY, "light.office_b", false);
  const result = settingEffects(
    h,
    naming,
    { inventory: EMPTY_INVENTORY, parameters: EMPTY_PARAMETERS },
    { inventory: next, parameters: EMPTY_PARAMETERS },
    NOTHING_INSTALLED,
  );
  expect("inputs" in result && result.inputs).toContainEqual({
    kind: "helper",
    op: "update",
    targetId: "light.office_all",
    space: { labelId: "sp_office", areaIds: ["office"] },
    fields: { entities: ["light.office_a", "light.office_drift"] },
  });
  h.entities["light.office_drift"].areaId = "studio";
  expect(
    settingEffects(
      h,
      naming,
      { inventory: EMPTY_INVENTORY, parameters: EMPTY_PARAMETERS },
      { inventory: next, parameters: EMPTY_PARAMETERS },
      NOTHING_INSTALLED,
    ),
  ).toMatchObject({ error: expect.stringContaining("outside this area") });
});

it("does not reconcile a legacy whole-site script when only a Space area source changes", () => {
  const h = house();
  const naming = { ...DEFAULT_NAMING, areaCodes: { office: "office", studio: "studio" } };
  h.entities["media_player.office_extra"] = {
    ...h.entities["media_player.office_speaker"],
    entityId: "media_player.office_extra",
    name: "Extra",
    areaId: "office",
  };
  h.areas.office.entityIds.push("media_player.office_extra");
  let params = setParameter(EMPTY_PARAMETERS, { level: "house" }, "tts_entity", "tts.office");
  params = setParameter(params, { level: "space", id: "sp_office" }, "tts_entity", "tts.office");
  params = setParameter(params, { level: "space", id: "sp_studio" }, "tts_entity", "tts.studio");
  const installed = structuredClone(NOTHING_INSTALLED);
  for (const area of ["office", "studio"]) installed.automations[`taxis_occupancy_${area}`] = { alias: area, path: "taxis/occupancy.yaml", input: {} };
  const plans = [
    planHouseRecipes(h, EMPTY_INVENTORY, naming, params, installed, [], true),
    ...resolveSpaces(h).map((space) => planHouseRecipes(h, EMPTY_INVENTORY, naming, params, installed, [], true, { kind: "space", space })),
  ];
  for (const cells of plans) {
    const script = cells.find((cell) => cell.recipe === "announce")!.inputs.find((input) => input.kind === "script")!;
    const blueprint = script.fields!.use_blueprint as { path: string; input: Record<string, unknown> };
    installed.scripts[String(script.fields!.script_id)] = { alias: String(script.fields!.alias), path: blueprint.path, input: blueprint.input };
  }
  const next = setCounts(h, EMPTY_INVENTORY, "media_player.office_extra", false);
  const result = settingEffects(h, naming, { inventory: EMPTY_INVENTORY, parameters: params }, { inventory: next, parameters: params }, installed);
  expect(result).toHaveProperty("inputs");
  if (!("inputs" in result)) return;
  const scripts = result.inputs.filter((input) => input.kind === "script");
  expect(scripts).toHaveLength(1);
  expect(scripts[0]).toMatchObject({ space: { labelId: "sp_office" }, fields: { script_id: spaceIds("sp_office").announce } });
});
