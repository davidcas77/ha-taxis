import { describe, expect, it } from "vitest";
import { buildHierarchy, type RawRegistry } from "../server/model/hierarchy.ts";
import { overlayChanges } from "../server/changes/overlay.ts";
import type { Change } from "./types.ts";
import { deviceAreaAssignments, unassignedDevices } from "./unassigned-devices.ts";

const raw: RawRegistry = {
  config: {},
  floors: [],
  labels: [],
  areas: [
    { area_id: "one", name: "Workshop" },
    { area_id: "two", name: "Library" },
  ],
  devices: [
    { id: "bridge", name: "Bridge" },
    { id: "empty", name: "Empty", entry_type: "service" },
    { id: "disabled", name: "Disabled", disabled_by: "user" },
    { id: "placed", name: "Placed", area_id: "one" },
  ],
  entities: [
    { entity_id: "sensor.follows", platform: "fixture", device_id: "bridge" },
    { entity_id: "sensor.override", platform: "fixture", device_id: "bridge", area_id: "two" },
  ],
  states: [],
};
describe("unassigned device assignment", () => {
  it("includes service and zero-entity devices without conflating entity membership", () => {
    const h = buildHierarchy(raw, "now");
    expect(unassignedDevices(h, false).map((d) => d.id)).toEqual(["bridge", "empty"]);
    expect(unassignedDevices(h, true).map((d) => d.id)).toEqual(["bridge", "empty", "disabled"]);
    expect(h.unassignedEntityIds).toEqual(["sensor.follows"]);
  });
  it("plans only device-area changes and ignores stale, placed or duplicate selections", () => {
    const h = buildHierarchy(raw, "now");
    expect(deviceAreaAssignments(h, ["bridge", "bridge", "missing", "placed"], "one")).toEqual([
      { kind: "device", op: "update", targetId: "bridge", fields: { area_id: "one" } },
    ]);
    expect(deviceAreaAssignments(h, ["bridge"], "missing")).toEqual([]);
  });
  it("moves inheriting entities in preview while retaining explicit entity areas", () => {
    const h = buildHierarchy(raw, "now");
    const changes: Change[] = deviceAreaAssignments(h, ["bridge"], "one").map((input, id) => ({
      id,
      kind: "device",
      op: "update",
      targetId: input.targetId!,
      scope: null,
      before: {},
      after: input.fields!,
      createdAt: "now",
    }));
    const next = buildHierarchy(overlayChanges(raw, changes), "later");
    expect(next.devices.bridge.areaId).toBe("one");
    expect(next.entities["sensor.follows"].areaId).toBe("one");
    expect(next.entities["sensor.follows"].ownAreaId).toBeNull();
    expect(next.entities["sensor.override"].areaId).toBe("two");
    expect(next.entities["sensor.override"].ownAreaId).toBe("two");
    expect(next.unassignedEntityIds).toEqual([]);
  });
});
