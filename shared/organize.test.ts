import { describe, expect, it } from "vitest";
import { buildHierarchy, type RawRegistry } from "../server/model/hierarchy.ts";
import { entityMatchesSection, organizeEntityType, ORGANIZE_ENTITY_TYPES } from "./organize.ts";

const raw: RawRegistry = {
  config: {}, floors: [], areas: [], devices: [], labels: [],
  entities: [
    { entity_id: "automation.arrival", platform: "automation" },
    { entity_id: "input_boolean.away", platform: "input_boolean" },
    { entity_id: "sensor.derived", platform: "template" },
    { entity_id: "light.group", platform: "group", disabled_by: "user" },
    { entity_id: "light.switch_light", platform: "switch_as_x" },
    { entity_id: "sensor.temperature", platform: "zigbee" },
    { entity_id: "script.announce", platform: "script" },
    { entity_id: "scene.evening", platform: "scene" },
  ],
  states: [
    { entity_id: "automation.yaml", state: "on" },
    { entity_id: "timer.yaml", state: "idle" },
    { entity_id: "light.room_group", state: "on", attributes: { entity_id: ["light.physical"] } },
  ],
};

describe("Organize entity sections", () => {
  const entities = Object.values(buildHierarchy(raw, "now").entities);
  const ids = (section: (typeof ORGANIZE_ENTITY_TYPES)[number]) => entities.filter(e => entityMatchesSection(e, section)).map(e => e.entityId).sort();

  it("puts registry and state-only automations exclusively under Automations", () => {
    expect(ids("automations")).toEqual(["automation.arrival", "automation.yaml"]);
  });

  it("puts helpers and groups exclusively under Helpers, including disabled and state-only helpers", () => {
    expect(ids("helpers")).toEqual(["input_boolean.away", "light.group", "light.room_group", "light.switch_light", "sensor.derived", "timer.yaml"]);
  });

  it("keeps ordinary entities, scripts and scenes in Entities", () => {
    expect(ids("entities")).toEqual(["scene.evening", "script.announce", "sensor.temperature"]);
  });

  it("assigns every entity to exactly one section without changing the hierarchy", () => {
    const all = ORGANIZE_ENTITY_TYPES.flatMap(ids);
    expect(all).toHaveLength(entities.length);
    expect(new Set(all).size).toBe(entities.length);
    for (const e of entities) expect(ORGANIZE_ENTITY_TYPES.filter(type => entityMatchesSection(e, type))).toEqual([organizeEntityType(e)]);
  });
});
