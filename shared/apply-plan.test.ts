import { describe, expect, it } from "vitest";

import { closureFor, dependenciesOf, names, provides, renameGate, type RenameKnowledge } from "./apply-plan.ts";
import type { Change, ChangeKind, ChangeOp } from "./types.ts";

let next = 0;
const change = (kind: ChangeKind, op: ChangeOp, targetId: string, after: Record<string, unknown> = {}): Change => ({ id: ++next, kind, op, targetId, scope: null, before: {}, after, createdAt: "now" });
const ids = (list: readonly Change[]) => list.map((c) => c.id);

// An invented list: a new area with a light moved into it, a pause switch, a
// schedule and a blueprint a recipe is made from, and two changes that need none.
const area = change("area", "create", "new:area:1", { name: "Attic" });
const moveLight = change("entity", "update", "light.desk", { area_id: "new:area:1" });
const rename = change("entity", "update", "light.lamp", { new_entity_id: "light.floor_lamp" });
const group = change("helper", "create", "new:helper:4", { helper: "group", entity_id: "light.attic_all", entities: ["light.floor_lamp", "light.desk"], area_id: "new:area:1" });
const floorGroup = change("helper", "create", "new:helper:5", { helper: "group", entity_id: "light.top_floor", entities: ["light.attic_all"] });
const blueprint = change("blueprint", "create", "taxis/motion_lights.yaml", { path: "taxis/motion_lights.yaml", version: 4 });
const toggle = change("helper", "create", "new:helper:7", { helper: "input_boolean", entity_id: "input_boolean.attic_paused", area_id: "new:area:1" });
const automation = change("automation", "create", "taxis_motion_lights_attic", {
  recipe: "motion_lights",
  area_id: "new:area:1",
  use_blueprint: { path: "taxis/motion_lights.yaml", input: { light_target: "light.attic_all", pause_switch: "input_boolean.attic_paused", bed_entities: [] } },
});
const alone = change("label", "update", "kids", { name: "Children" });
const all = [area, moveLight, rename, group, floorGroup, blueprint, toggle, automation, alone];

describe("what a change provides and names", () => {
  it("provides the temporary id of what it creates, a new helper's entity id, a new id for a rename and a blueprint's path", () => {
    expect([...provides(area)]).toEqual(["new:area:1"]);
    expect([...provides(group)].sort()).toEqual(["light.attic_all", "new:helper:4"]);
    expect([...provides(rename)]).toEqual(["light.floor_lamp"]);
    expect([...provides(blueprint)].sort()).toEqual(["taxis/motion_lights.yaml"]);
    expect([...provides(alone)]).toEqual([]);
  });

  it("names what it holds whole, however deep, and what it targets, but not what it provides itself", () => {
    expect(names(moveLight).has("new:area:1")).toBe(true);
    expect(names(automation).has("input_boolean.attic_paused")).toBe(true);
    expect(names(automation).has("taxis/motion_lights.yaml")).toBe(true);
    expect(names(group).has("light.attic_all")).toBe(false);
    expect(names(change("helper", "update", "new:helper:4", {})).has("new:helper:4")).toBe(true);
  });
});

describe("what a change needs", () => {
  it("needs the area it is moved into", () => {
    expect(ids(dependenciesOf(all, moveLight.id))).toEqual([area.id]);
  });

  it("needs the rename whose new id a group lists, and the area it sits in", () => {
    expect(ids(dependenciesOf(all, group.id))).toEqual([area.id, rename.id]);
  });

  it("goes through the changes it needs: a floor group needs the area group, and that one its own", () => {
    expect(ids(dependenciesOf(all, floorGroup.id))).toEqual([area.id, rename.id, group.id]);
  });

  it("needs, for a recipe, its blueprint, its helpers and everything they need", () => {
    expect(ids(dependenciesOf(all, automation.id))).toEqual([area.id, rename.id, group.id, blueprint.id, toggle.id]);
  });

  it("needs nothing when nothing in the list is named", () => {
    expect(dependenciesOf(all, alone.id)).toEqual([]);
    expect(dependenciesOf(all, area.id)).toEqual([]);
    expect(dependenciesOf(all, rename.id)).toEqual([]);
  });

  it("is empty for an id that isn't in the list, and never lists the change itself", () => {
    expect(dependenciesOf(all, 9999)).toEqual([]);
    for (const c of all) expect(ids(dependenciesOf(all, c.id))).not.toContain(c.id);
  });

  it("matches whole strings only: a similar id is not a dependency", () => {
    const similar = change("helper", "update", "light.attic_all_2", { entities: ["light.attic_all_2", "light.floor_lamp_2"] });
    expect(dependenciesOf([group, rename, similar], similar.id)).toEqual([]);
  });

  it("does not loop when two changes name each other", () => {
    const a = change("helper", "create", "new:helper:20", { entity_id: "switch.a", entities: ["switch.b"] });
    const b = change("helper", "create", "new:helper:21", { entity_id: "switch.b", entities: ["switch.a"] });
    expect(ids(dependenciesOf([a, b], a.id))).toEqual([b.id]);
    expect(ids(dependenciesOf([a, b], b.id))).toEqual([a.id]);
  });
});

describe("applying one change", () => {
  it("is the change and what it needs, in the order of the list", () => {
    expect(ids(closureFor(all, [automation.id]))).toEqual([area.id, rename.id, group.id, blueprint.id, toggle.id, automation.id]);
    expect(ids(closureFor(all, [alone.id]))).toEqual([alone.id]);
  });

  it("lets a change that others depend on be applied alone", () => {
    expect(ids(closureFor(all, [area.id]))).toEqual([area.id]);
    expect(ids(closureFor(all, [rename.id]))).toEqual([rename.id]);
  });

  it("counts a change both asked for and needed once, and leaves out an id that isn't in the list", () => {
    expect(ids(closureFor(all, [group.id, moveLight.id, 9999]))).toEqual([area.id, moveLight.id, rename.id, group.id]);
    expect(closureFor(all, [])).toEqual([]);
  });

  it("does not touch the list it was given", () => {
    const before = ids(all);
    closureFor(all, [automation.id]);
    expect(ids(all)).toEqual(before);
  });
});

describe("what a rename needs before it is applied", () => {
  const known = (renames: { changeId: number; manual: number }[], over: Partial<RenameKnowledge> = {}): RenameKnowledge => ({ loading: false, error: null, renames, ...over });
  const other = change("entity", "update", "light.hall", { new_entity_id: "light.hallway" });
  const list = [rename, other, alone];

  it("waits for what is known about each rename in the scope", () => {
    expect(renameGate(list, known([{ changeId: rename.id, manual: 0 }]), new Set())).toEqual({ waiting: [other.id], needsAck: [], unacknowledged: [] });
    expect(renameGate([alone], known([]), new Set())).toEqual({ waiting: [], needsAck: [], unacknowledged: [] });
  });

  it("needs an I understand for a rename with places left to update by hand, until it is given", () => {
    const refs = known([{ changeId: rename.id, manual: 2 }, { changeId: other.id, manual: 0 }]);
    expect(renameGate(list, refs, new Set())).toEqual({ waiting: [], needsAck: [rename.id], unacknowledged: [rename.id] });
    expect(renameGate(list, refs, new Set([rename.id]))).toEqual({ waiting: [], needsAck: [rename.id], unacknowledged: [] });
    // Only what is about to be applied counts.
    expect(renameGate([other], refs, new Set())).toEqual({ waiting: [], needsAck: [], unacknowledged: [] });
  });

  it("needs it for every rename when Taxis could not look", () => {
    const refs = known([], { error: "Home Assistant did not answer" });
    expect(renameGate(list, refs, new Set()).unacknowledged).toEqual([rename.id, other.id]);
  });
});
