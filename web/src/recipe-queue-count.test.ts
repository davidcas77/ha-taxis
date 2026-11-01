import { expect, it } from "vitest";
import type { Change } from "../../shared/types.ts";
import { countRelatedChanges } from "./recipe-queue-count.ts";
it("counts only related queued helpers and the selected configuration", () => {
  const changes = [
    { kind: "helper", targetId: null, after: { entity_id: "timer.kitchen_hold" } },
    { kind: "helper", targetId: null, after: { entity_id: "timer.bedroom_hold" } },
    { kind: "automation", targetId: "taxis_occupancy_kitchen", after: {} },
    { kind: "automation", targetId: "taxis_occupancy_bedroom", after: {} },
    { kind: "blueprint", targetId: "shared.yaml", after: {} },
  ] as unknown as Change[];
  expect(countRelatedChanges(changes, new Set(["timer.kitchen_hold"]), "taxis_occupancy_kitchen", false)).toBe(2);
  expect(countRelatedChanges(changes, new Set(["timer.bedroom_hold"]), "taxis_occupancy_bedroom", false)).toBe(2);
  expect(countRelatedChanges(changes, new Set(), null, false)).toBe(0);
});
