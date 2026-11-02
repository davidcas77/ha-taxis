import { describe, expect, it } from "vitest";
import { buildHierarchy, type RawRegistry } from "../../server/model/hierarchy.ts";
import { scopedAreaHelperInputs } from "./scoped-helper-inputs.ts";
import type { Change, ChangeInput } from "../../shared/types.ts";

const raw: RawRegistry = {
  config: { location_name: "Test" },
  floors: [],
  areas: [
    { area_id: "a", name: "A", labels: ["office"] },
    { area_id: "b", name: "B", labels: ["office"] },
    { area_id: "free", name: "Free" },
  ],
  labels: [{ label_id: "office", name: "Space: Office" }],
  devices: [],
  entities: [],
  states: [],
};
const input: ChangeInput = { kind: "helper", op: "create", fields: { helper: "group", group_type: "light", entity_id: "light.a_all", entities: ["light.a"] } };
describe("area helper Space metadata", () => {
  it("fences an area helper to its Space and leaves legacy inputs alone", () => {
    const h = buildHierarchy(raw, "now");
    expect(scopedAreaHelperInputs(h, [], "a", [input]).inputs[0]).toMatchObject({ ...input, space: { labelId: "office", areaIds: ["a", "b"] } });
    expect(scopedAreaHelperInputs(h, [], "free", [input]).inputs).toEqual([input]);
  });
  it("retains Space metadata on planner-verified helper adoption", () => {
    const h = buildHierarchy(raw, "now");
    const adoption: ChangeInput = { kind: "entity", op: "update", targetId: "light.old", fields: { new_entity_id: "light.a_all" } };
    expect(scopedAreaHelperInputs(h, [], "a", [adoption]).inputs[0]).toMatchObject({ ...adoption, space: { labelId: "office", areaIds: ["a", "b"] } });
  });
  it("blocks changes while membership is pending", () => {
    const h = buildHierarchy(raw, "now");
    const changes = [
      { id: 1, kind: "area", op: "update", targetId: "a", scope: null, createdAt: "", before: { labels: [] }, after: { labels: ["office"] } },
    ] as Change[];
    expect(scopedAreaHelperInputs(h, changes, "a", [input])).toMatchObject({ inputs: [], error: expect.any(String) });
  });
});
