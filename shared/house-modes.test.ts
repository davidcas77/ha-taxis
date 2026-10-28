import { describe, expect, it } from "vitest";
import { buildMockRegistry } from "../scripts/mock-ha-core.ts";
import { buildHierarchy } from "../server/model/hierarchy.ts";
import { EMPTY_INVENTORY } from "./inventory.ts";
import { EMPTY_PARAMETERS, setParameter } from "./parameters.ts";
import { validateInput } from "./changes.ts";
import { HOUSE_MODES, planHouseModes, recipeHouseModes } from "./house-modes.ts";
import type { Change, Hierarchy } from "./types.ts";

function house() {
  const h = buildHierarchy(buildMockRegistry(), "fixture");
  for (const mode of HOUSE_MODES) delete h.entities[mode.id];
  return h;
}
const rows = (h: Hierarchy, changes: Change[] = []) => planHouseModes(h, EMPTY_PARAMETERS, EMPTY_INVENTORY, changes);
const queued = (fields: Record<string, unknown>, op: Change["op"] = "create"): Change => ({
  id: 1,
  kind: "helper",
  op,
  targetId: "new:helper:1",
  scope: null,
  before: {},
  after: fields,
  createdAt: "fixture",
});

describe("guided house switches", () => {
  it("only proposes native input booleans, without activating modes or touching devices", () => {
    const plan = rows(house());
    expect(plan.map((row) => row.status)).toEqual(["create", "create", "create"]);
    for (const row of plan)
      expect(row.inputs).toEqual([
        {
          kind: "helper",
          op: "create",
          fields: {
            helper: "input_boolean",
            name: `Taxis ${row.key} mode`,
            entity_id: row.id,
            icon: HOUSE_MODES.find((mode) => mode.key === row.key)!.icon,
          },
        },
      ]);
    for (const row of plan) for (const input of row.inputs) expect(validateInput(input)).toBeNull();
    expect(recipeHouseModes(plan)).toEqual({ away: "", sleep: "", guest: "" });
  });
  it("recognizes a compatible queued create but not a delete or unrelated helper", () => {
    const h = house();
    const id = "input_boolean.taxis_guest";
    expect(rows(h, [queued({ entity_id: id, helper: "input_boolean" })])[2].status).toBe("in-changes");
    expect(rows(h, [queued({ entity_id: id, helper: "input_boolean" }, "delete")])[2].status).toBe("create");
    expect(rows(h, [queued({ entity_id: id, helper: "timer" })])[2].status).toBe("create");
  });
  it("uses an existing switch, rejects unavailable or incompatible ones, and never proposes a replacement over it", () => {
    const h = house();
    const source = Object.values(h.entities)[0];
    h.entities[HOUSE_MODES[2].id] = {
      ...source,
      entityId: HOUSE_MODES[2].id,
      domain: "input_boolean",
      platform: "input_boolean",
      state: "off",
      disabled: false,
    };
    expect(rows(h)[2]).toMatchObject({ status: "present", inputs: [] });
    h.entities[HOUSE_MODES[2].id].state = "unavailable";
    expect(rows(h)[2]).toMatchObject({ status: "review", inputs: [] });
    h.entities[HOUSE_MODES[2].id].state = "off";
    h.entities[HOUSE_MODES[2].id].disabled = true;
    expect(rows(h)[2].status).toBe("review");
    h.entities[HOUSE_MODES[2].id].platform = "template";
    expect(rows(h)[2].status).toBe("review");
  });
  it("honors area overrides and requires the chosen existing switch rather than creating a different one", () => {
    const h = house();
    const houseParams = setParameter(
      EMPTY_PARAMETERS,
      { level: "house" },
      "guest_mode_entity",
      "input_boolean.visitors",
    );
    const params = setParameter(
      houseParams,
      { level: "area", id: "living_room" },
      "guest_mode_entity",
      "input_boolean.guest_room",
    );
    expect(planHouseModes(h, params, EMPTY_INVENTORY, [])[2]).toMatchObject({
      id: "input_boolean.visitors",
      status: "review",
      inputs: [],
    });
    expect(planHouseModes(h, params, EMPTY_INVENTORY, [], "living_room")[2]).toMatchObject({
      id: "input_boolean.guest_room",
      status: "review",
      inputs: [],
    });
  });
});
