import { describe, expect, it } from "vitest";
import { buildHierarchy, type RawRegistry } from "../server/model/hierarchy.ts";
import { planAreaMove } from "./area-move.ts";

const raw: RawRegistry = {
  config: {},
  floors: [
    { floor_id: "ground", name: "Ground" },
    { floor_id: "first", name: "First" },
  ],
  areas: [{ area_id: "room", name: "Room", floor_id: "ground", labels: ["old", "other"] }],
  labels: [
    { label_id: "old", name: "Space: Old" },
    { label_id: "new", name: "Space: New" },
    { label_id: "other", name: "Kitchen" },
  ],
  devices: [],
  entities: [],
  states: [],
};
const tree = () => buildHierarchy(structuredClone(raw), "now");

describe("area moves", () => {
  it("moves to a Space and floor while retaining unrelated labels", () => {
    expect(planAreaMove(tree(), "room", { floorId: "first", space: { kind: "set", labelId: "new" } })).toMatchObject({
      ok: true,
      membershipChanged: true,
      input: { kind: "area", op: "update", targetId: "room", fields: { floor_id: "first", labels: ["other", "new"] } },
      warning: expect.stringContaining("not changed"),
    });
  });
  it("keeps Space on floor-only drops, or clears it explicitly", () => {
    expect(planAreaMove(tree(), "room", { floorId: null, space: { kind: "keep" } })).toMatchObject({
      ok: true,
      membershipChanged: false,
      input: { fields: { floor_id: null } },
    });
    expect(planAreaMove(tree(), "room", { floorId: "first", space: { kind: "set", labelId: null } })).toMatchObject({
      ok: true,
      input: { fields: { floor_id: "first", labels: ["other"] } },
    });
  });
  it("accepts overlay temporary destinations and refuses missing, ambiguous and unchanged locations", () => {
    const h = tree();
    h.floors.push({ ...h.floors[0], id: "new:floor:1" });
    h.labels["new:label:2"] = { ...h.labels.new, id: "new:label:2", name: "Space: Pending" };
    expect(planAreaMove(h, "room", { floorId: "new:floor:1", space: { kind: "set", labelId: "new:label:2" } }).ok).toBe(true);
    expect(planAreaMove(h, "missing", { floorId: null, space: { kind: "keep" } }).ok).toBe(false);
    expect(planAreaMove(h, "room", { floorId: "missing", space: { kind: "keep" } }).ok).toBe(false);
    expect(planAreaMove(h, "room", { floorId: "ground", space: { kind: "set", labelId: "missing" } }).ok).toBe(false);
    expect(planAreaMove(h, "room", { floorId: "ground", space: { kind: "keep" } }).ok).toBe(false);
    h.areas.room.labels.push("new");
    expect(planAreaMove(h, "room", { floorId: "first", space: { kind: "keep" } }).ok).toBe(false);
    expect(planAreaMove(h, "room", { floorId: "first", space: { kind: "set", labelId: "new" } })).toMatchObject({
      ok: true,
      input: { fields: { labels: ["other", "new"] } },
    });
  });
});
