import { describe, expect, it } from "vitest";
import type { Change, ChangeInput, Hierarchy } from "../../shared/types.ts";
import { helperCreateInput } from "./recipe-helper-action.ts";

const h = { entities: {} } as Hierarchy;
const create: ChangeInput = { kind: "helper", op: "create", fields: { helper: "timer", entity_id: "timer.kitchen_hold" } };
const queued = { kind: "helper", op: "create", targetId: null, after: { helper: "timer", entity_id: "timer.kitchen_hold" } } as unknown as Change;

describe("recipe helper create action", () => {
  it("queues only the matching planner proposal and prevents a second create after it is queued", () => {
    expect(helperCreateInput(h, [], "timer.kitchen_hold", false, [create])).toEqual([create]);
    expect(helperCreateInput(h, [queued], "timer.kitchen_hold", false, [create])).toEqual([]);
  });
  it("queues an occupancy template with its timer, and blocks a missing or unavailable dependency", () => {
    const template: ChangeInput = {
      kind: "helper",
      op: "create",
      fields: { helper: "template", entity_id: "binary_sensor.kitchen_occupied", state_template: "{{ is_state('timer.kitchen_hold','active') }}" },
    };
    expect(helperCreateInput(h, [], "binary_sensor.kitchen_occupied", false, [template, create])).toEqual([create, template]);
    expect(helperCreateInput(h, [], "binary_sensor.kitchen_occupied", false, [template])).toEqual([]);
    const unavailable = {
      entities: { "timer.kitchen_hold": { domain: "timer", platform: "timer", inRegistry: true, state: "unavailable" } },
    } as unknown as Hierarchy;
    expect(helperCreateInput(unavailable, [], "binary_sensor.kitchen_occupied", false, [template, create])).toEqual([]);
  });
  it("queues the humidity group before its derivative and rejects an unavailable or conflicting prerequisite", () => {
    const group: ChangeInput = {
      kind: "helper",
      op: "create",
      fields: { helper: "min_max", entity_id: "sensor.kitchen_humidity", entities: ["sensor.humidity_source"] },
    };
    const rate: ChangeInput = {
      kind: "helper",
      op: "create",
      fields: { helper: "derivative", entity_id: "sensor.kitchen_rate", entities: ["sensor.kitchen_humidity"] },
    };
    expect(helperCreateInput(h, [], "sensor.kitchen_rate", false, [rate, group])).toEqual([group, rate]);
    expect(helperCreateInput(h, [], "sensor.kitchen_rate", false, [rate])).toEqual([]);
    const incompatible = {
      entities: { "sensor.kitchen_humidity": { domain: "sensor", platform: "demo", inRegistry: true, state: "50" } },
    } as unknown as Hierarchy;
    expect(helperCreateInput(incompatible, [], "sensor.kitchen_rate", false, [rate, group])).toEqual([]);
  });
  it("rejects existing entities, external selections, wrong IDs and compound changes", () => {
    expect(helperCreateInput({ entities: { "timer.kitchen_hold": {} } } as unknown as Hierarchy, [], "timer.kitchen_hold", false, [create])).toEqual([]);
    expect(helperCreateInput(h, [], "timer.kitchen_hold", true, [create])).toEqual([]);
    expect(helperCreateInput(h, [], "timer.other", false, [create])).toEqual([]);
    expect(helperCreateInput(h, [], "timer.kitchen_hold", false, [create, create])).toEqual([create]);
  });
});
