import { describe, expect, it } from "vitest";
import { buildHierarchy, type RawRegistry } from "../model/hierarchy.ts";
import { DEFAULT_NAMING } from "../../shared/naming.ts";
import { EMPTY_INVENTORY, setCounts, setRole } from "../../shared/inventory.ts";
import { EMPTY_PARAMETERS } from "../../shared/parameters.ts";
import { NOTHING_INSTALLED } from "../../shared/recipes.ts";
import { settingEffects } from "./direct-settings.ts";

function home() {
  const raw: RawRegistry = {
    config: {},
    floors: [],
    areas: [{ area_id: "living_room", name: "Living room" }],
    devices: [],
    labels: [],
    entities: [],
    states: [],
  };
  for (const id of ["binary_sensor.living_pir", "binary_sensor.living_pir2"]) {
    raw.entities.push({ entity_id: id, platform: "demo", area_id: "living_room", unique_id: id });
    raw.states.push({ entity_id: id, state: "off", attributes: { device_class: "motion" } });
  }
  raw.entities.push({
    entity_id: "binary_sensor.living_motion_all",
    platform: "group",
    area_id: "living_room",
    config_entry_id: "fixture",
    unique_id: "group",
  });
  raw.states.push({
    entity_id: "binary_sensor.living_motion_all",
    state: "off",
    attributes: { device_class: "motion", entity_id: ["binary_sensor.living_pir", "binary_sensor.living_pir2", "binary_sensor.unrelated"] },
  });
  return buildHierarchy(raw, "now");
}
const naming = { ...DEFAULT_NAMING, areaCodes: { living_room: "living" } };
const base = { inventory: EMPTY_INVENTORY, parameters: EMPTY_PARAMETERS };

describe("direct setting effects", () => {
  it("applies only the intended membership delta while retaining pre-existing drift", () => {
    const h = home();
    const next = { ...base, inventory: setCounts(h, base.inventory, "binary_sensor.living_pir2", false) };
    const result = settingEffects(h, naming, base, next, NOTHING_INSTALLED);
    expect("inputs" in result && result.inputs).toEqual([
      {
        kind: "helper",
        op: "update",
        targetId: "binary_sensor.living_motion_all",
        fields: { entities: ["binary_sensor.living_pir", "binary_sensor.unrelated"] },
      },
    ]);
  });
  it("does not silently remove the last source from an installed group", () => {
    const h = home();
    const one = setCounts(h, base.inventory, "binary_sensor.living_pir2", false);
    const none = setCounts(h, one, "binary_sensor.living_pir", false);
    const result = settingEffects(h, naming, { ...base, inventory: one }, { ...base, inventory: none }, NOTHING_INSTALLED);
    expect(result).toHaveProperty("error");
  });
  it("does not install new recipes for a role change", () => {
    const h = home();
    const inventory = setRole(h, base.inventory, "binary_sensor.living_pir", "holds");
    const result = settingEffects(h, naming, base, { ...base, inventory }, NOTHING_INSTALLED);
    expect("inputs" in result && result.inputs).toEqual([]);
    expect("notes" in result && result.notes.join(" ")).toContain("binary_sensor.living_pir");
  });
});
