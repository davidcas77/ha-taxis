import { describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";

import { buildMockRegistry, handleMock } from "../../scripts/mock-ha-core.ts";
import { validateInput } from "../../shared/changes.ts";
import type { ChangeInput } from "../../shared/types.ts";
import { buildHierarchy, type RawRegistry } from "../model/hierarchy.ts";
import { applyChanges } from "./apply.ts";
import { overlayChanges } from "./overlay.ts";
import { changeStore } from "./store.ts";

// A change store on an in-memory database, and a fake HA whose registry the
// Apply step really edits (handleMock is the fake HA's own command handler).
function setup() {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE changes (id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, op TEXT NOT NULL, target_id TEXT NOT NULL,
    scope TEXT, before TEXT NOT NULL, after TEXT NOT NULL, created_at TEXT NOT NULL)`);
  const store = changeStore(db);
  const ha = buildMockRegistry();
  const writes: { type: string; payload: Record<string, unknown> }[] = [];
  const writer = {
    async write<T>(type: string, payload: Record<string, unknown>): Promise<T> {
      writes.push({ type, payload });
      const reply = handleMock(ha, type, payload);
      if (!reply.success) throw new Error(reply.message);
      return reply.result as T;
    },
  };
  const live = () => buildHierarchy(structuredClone(ha), "now");
  const add = (input: ChangeInput) => {
    const invalid = validateInput(input);
    if (invalid) return invalid;
    return store.add(input, live());
  };
  const apply = () => applyChanges(store.list(), writer, async () => structuredClone(ha) as RawRegistry);
  return { store, ha, writes, live, add, apply };
}

describe("validating edits", () => {
  it("refuses fields that can't be changed and values HA wouldn't take", () => {
    expect(validateInput({ kind: "entity", op: "update", targetId: "light.desk", fields: { platform: "x" } })).toMatch(/can't be changed/);
    expect(validateInput({ kind: "entity", op: "update", targetId: "light.desk", fields: { icon: "lightbulb" } })).toMatch(/wouldn't accept/);
    expect(validateInput({ kind: "entity", op: "update", targetId: "light.desk", fields: { disabled_by: "integration" } })).toMatch(/wouldn't accept/);
    expect(validateInput({ kind: "area", op: "create", fields: {} })).toMatch(/needs a name/);
    expect(validateInput({ kind: "category", op: "create", fields: { name: "X" } })).toMatch(/needs a scope/);
  });

  it("never creates or deletes devices and entities", () => {
    expect(validateInput({ kind: "entity", op: "delete", targetId: "light.desk" })).toMatch(/edited, not created or deleted/);
    expect(validateInput({ kind: "device", op: "create", fields: { name_by_user: "X" } })).toMatch(/edited, not created or deleted/);
  });
});

describe("the change list", () => {
  it("records before and after, and folds repeated edits of the same item into one", () => {
    const t = setup();
    expect(t.add({ kind: "entity", op: "update", targetId: "light.desk", fields: { name: "Desk" } })).toBeNull();
    expect(t.add({ kind: "entity", op: "update", targetId: "light.desk", fields: { labels: ["kids"] } })).toBeNull();
    const list = t.store.list();
    expect(list).toHaveLength(1);
    expect(list[0].before).toEqual({ name: null, labels: [] });
    expect(list[0].after).toEqual({ name: "Desk", labels: ["kids"] });
  });

  it("drops an edit that puts things back the way they were", () => {
    const t = setup();
    t.add({ kind: "area", op: "update", targetId: "study", fields: { name: "Office" } });
    expect(t.store.list()).toHaveLength(1);
    t.add({ kind: "area", op: "update", targetId: "study", fields: { name: "Study" } });
    expect(t.store.list()).toHaveLength(0);
    expect(t.add({ kind: "area", op: "update", targetId: "study", fields: { name: "Study" } })).toMatch(/already is/);
  });

  it("gives a new item a temporary id, and deleting it also drops edits that point at it", () => {
    const t = setup();
    t.add({ kind: "area", op: "create", fields: { name: "Attic", floor_id: "first" } });
    const area = t.store.list()[0];
    expect(area.targetId).toBe(`new:area:${area.id}`);
    t.add({ kind: "device", op: "update", targetId: "plug", fields: { area_id: area.targetId } });
    expect(t.store.list()).toHaveLength(2);
    t.add({ kind: "area", op: "delete", targetId: area.targetId });
    expect(t.store.list()).toHaveLength(0);
  });

  it("previews the result: a moved device takes its entities into the new area", () => {
    const t = setup();
    t.add({ kind: "area", op: "create", fields: { name: "Attic", floor_id: "first" } });
    const areaId = t.store.list()[0].targetId;
    t.add({ kind: "device", op: "update", targetId: "plug", fields: { area_id: areaId } });
    const preview = buildHierarchy(overlayChanges(t.ha, t.store.list()), "now");
    expect(preview.areas[areaId].name).toBe("Attic");
    t.add({ kind: "entity", op: "update", targetId: "light.desk", fields: { name: "Desk lamp" } });
    expect(buildHierarchy(overlayChanges(t.ha, t.store.list()), "now").entities["light.desk"].name).toBe("Desk lamp");
    expect(preview.areas[areaId].entityIds).toEqual(["switch.spare_plug"]);
    expect(preview.floors.find((f) => f.id === "first")!.areaIds).toContain(areaId);
    // The live read is untouched until Apply.
    expect(t.live().entities["switch.spare_plug"].areaId).toBeNull();
  });
});

describe("Apply", () => {
  it("creates first, swaps temporary ids for real ones, then verifies every change", async () => {
    const t = setup();
    t.add({ kind: "label", op: "create", fields: { name: "Night lights", color: "indigo" } });
    t.add({ kind: "area", op: "create", fields: { name: "Attic", floor_id: "first" } });
    const [label, area] = t.store.list();
    t.add({ kind: "device", op: "update", targetId: "plug", fields: { area_id: area.targetId } });
    t.add({ kind: "entity", op: "update", targetId: "light.bedside_left", fields: { name: "Left lamp", labels: [label.targetId] } });

    const { results, appliedIds } = await t.apply();
    expect(results.every((r) => r.ok)).toBe(true);
    expect(appliedIds).toHaveLength(4);
    expect(t.writes.map((w) => w.type)).toEqual([
      "config/label_registry/create",
      "config/area_registry/create",
      "config/device_registry/update",
      "config/entity_registry/update",
    ]);
    const h = t.live();
    expect(h.devices.plug.areaId).toBe("attic");
    expect(h.entities["light.bedside_left"]).toMatchObject({ customName: "Left lamp", labels: ["night_lights"] });
    expect(JSON.stringify(t.writes)).not.toContain("new:");
  });

  it("files automations and helpers in categories, one scope at a time", async () => {
    const t = setup();
    t.add({ kind: "category", op: "create", scope: "automation", fields: { name: "Security" } });
    const cat = t.store.list()[0];
    t.add({ kind: "entity", op: "update", targetId: "input_boolean.guest_mode", fields: { categories: { helpers: "cat_modes" } } });
    t.add({ kind: "entity", op: "update", targetId: "automation.lights_on_at_sunset", fields: { categories: { automation: cat.targetId } } });
    const { results } = await t.apply();
    expect(results.every((r) => r.ok)).toBe(true);
    const h = t.live();
    expect(h.entities["input_boolean.guest_mode"].categories).toEqual({ helpers: "cat_modes" });
    expect(h.entities["automation.lights_on_at_sunset"].categories.automation).toMatch(/^cat_security/);
  });

  it("reports a refused change and skips the ones that depend on it, applying the rest", async () => {
    const t = setup();
    t.add({ kind: "area", op: "create", fields: { name: "Attic" } });
    const area = t.store.list()[0];
    t.add({ kind: "device", op: "update", targetId: "plug", fields: { area_id: area.targetId } });
    t.add({ kind: "entity", op: "update", targetId: "light.desk", fields: { name: "Desk" } });
    // The fake HA refuses to create this area.
    const refuseAreas = { write: async <T,>(type: string, p: Record<string, unknown>) => {
      if (type === "config/area_registry/create") throw new Error("Name already in use");
      const reply = handleMock(t.ha, type, p);
      if (!reply.success) throw new Error(reply.message);
      return reply.result as T;
    } };
    const { results, appliedIds } = await applyChanges(t.store.list(), refuseAreas, async () => structuredClone(t.ha));
    expect(results.map((r) => r.ok)).toEqual([false, false, true]);
    expect(results[0].message).toMatch(/refused it: Name already in use/);
    expect(results[1].message).toMatch(/depends on a new area/);
    expect(appliedIds).toEqual([t.store.list()[2].id]);
  });

  it("only counts a change as applied when a fresh read shows it", async () => {
    const t = setup();
    t.add({ kind: "entity", op: "update", targetId: "light.desk", fields: { name: "Desk" } });
    // HA answers "success" but doesn't store anything.
    const liar = { write: async <T,>() => ({}) as T };
    const { results, appliedIds } = await applyChanges(t.store.list(), liar, async () => structuredClone(t.ha));
    expect(results[0]).toMatchObject({ ok: false });
    expect(results[0].message).toMatch(/Its name reads null in Home Assistant/);
    expect(appliedIds).toEqual([]);
  });

  it("deletes last, after anything that might still need the item", async () => {
    const t = setup();
    t.add({ kind: "label", op: "delete", targetId: "kids" });
    t.add({ kind: "floor", op: "create", fields: { name: "Basement", level: -1 } });
    await t.apply();
    expect(t.writes.map((w) => w.type)).toEqual(["config/floor_registry/create", "config/label_registry/delete"]);
    expect(t.live().labels.kids).toBeUndefined();
    expect(t.live().areas.study.labels).toEqual([]);
  });
});

describe("helper changes", () => {
  const group = (fields: Record<string, unknown> = {}): ChangeInput => ({
    kind: "helper",
    op: "create",
    fields: { helper: "group", group_type: "light", name: "Study lights", entity_id: "light.study_all", entities: ["light.desk"], area_id: "study", ...fields },
  });

  it("checks what a helper needs: its kind, its domain and members in it, and never a delete", () => {
    expect(validateInput(group())).toBeNull();
    expect(validateInput({ kind: "helper", op: "create", fields: { helper: "min_max", name: "Study temperature", entity_id: "sensor.study_temperature", entities: ["sensor.a"], area_id: "study", set_area_sensor: "temperature" } })).toBeNull();
    expect(validateInput({ kind: "helper", op: "delete", targetId: "light.garage_all" })).toMatch(/not deleted/);
    expect(validateInput(group({ group_type: "binary_sensor" }))).toMatch(/has to start with “binary_sensor/);
    expect(validateInput(group({ entities: ["sensor.a"] }))).toMatch(/members have to be light/);
    expect(validateInput(group({ entities: [] }))).toMatch(/wouldn't accept/);
    expect(validateInput(group({ entities: ["light.a", "light.a"] }))).toMatch(/wouldn't accept/);
    expect(validateInput(group({ group_type: undefined }))).toMatch(/wouldn't accept|needs a group type/);
    expect(validateInput(group({ helper: "template" }))).toMatch(/wouldn't accept/);
    expect(validateInput(group({ set_area_sensor: "temperature" }))).toMatch(/Only a min\/max/);
    expect(validateInput(group({ platform: "group" }))).toMatch(/can't be changed/);
    expect(validateInput({ kind: "helper", op: "create", fields: { helper: "min_max", name: "x", entity_id: "light.x", entities: ["sensor.a"], area_id: "study" } })).toMatch(/start with “sensor/);
    expect(validateInput({ kind: "helper", op: "create", fields: { helper: "min_max", group_type: "light", name: "x", entity_id: "sensor.x", entities: ["sensor.a"], area_id: "study" } })).toMatch(/Only a group has/);
    expect(validateInput({ kind: "helper", op: "update", targetId: "light.garage_all", fields: { entities: ["light.a"], name: "x" } })).toMatch(/can't be changed|only change its members/);
    expect(validateInput({ kind: "helper", op: "update", targetId: "light.garage_all", fields: { area_id: "study" } })).toMatch(/only change its members/);
  });

  it("keeps a creation under the entity id it will have, once", () => {
    const t = setup();
    expect(t.add(group())).toBeNull();
    const [made] = t.store.list();
    expect(made).toMatchObject({ kind: "helper", op: "create", targetId: "light.study_all", before: {} });
    expect(t.add(group())).toMatch(/already creates/);
    expect(t.add(group({ entity_id: "light.desk" }))).toMatch(/already has an entity/);
    expect(t.add(group({ entities: ["light.nope"] }))).toMatch(/isn't in Home Assistant/);
    expect(t.add(group({ entity_id: "light.study_2", area_id: "new:area:99" }))).toMatch(/isn't in Home Assistant or in the list/);
    // An entity can't be renamed onto the id, and removing the creation frees it.
    expect(t.add({ kind: "entity", op: "update", targetId: "light.desk", fields: { new_entity_id: "light.study_all" } })).toMatch(/already creates a helper/);
    t.store.remove(made.id);
    expect(t.store.list()).toEqual([]);
  });

  it("refuses a creation when the list renames an entity to its id", () => {
    const t = setup();
    expect(t.add({ kind: "entity", op: "update", targetId: "light.desk", fields: { new_entity_id: "light.study_all" } })).toBeNull();
    expect(t.add(group())).toMatch(/already renames an entity/);
  });

  it("updates a group's members, keeping the first before when edited again", () => {
    const t = setup();
    expect(t.add({ kind: "helper", op: "update", targetId: "light.garage_all", fields: { entities: ["light.garage_ceiling", "light.garage_bench"] } })).toBeNull();
    expect(t.store.list()[0]).toMatchObject({ kind: "helper", op: "update", targetId: "light.garage_all", before: { entities: ["light.garage_ceiling"] }, after: { entities: ["light.garage_ceiling", "light.garage_bench"] } });
    expect(t.add({ kind: "helper", op: "update", targetId: "light.garage_all", fields: { entities: ["light.garage_bench"] } })).toBeNull();
    expect(t.store.list()).toHaveLength(1);
    expect(t.store.list()[0]).toMatchObject({ before: { entities: ["light.garage_ceiling"] }, after: { entities: ["light.garage_bench"] } });
    // Back to how it was: the change goes.
    expect(t.add({ kind: "helper", op: "update", targetId: "light.garage_all", fields: { entities: ["light.garage_ceiling"] } })).toBeNull();
    expect(t.store.list()).toEqual([]);
    expect(t.add({ kind: "helper", op: "update", targetId: "light.garage_all", fields: { entities: ["light.garage_ceiling"] } })).toMatch(/already is/);
  });

  it("only updates a group set up in the UI", () => {
    const t = setup();
    expect(t.add({ kind: "helper", op: "update", targetId: "light.desk", fields: { entities: ["light.garage_bench"] } })).toMatch(/only updates the members of a group/);
    expect(t.add({ kind: "helper", op: "update", targetId: "light.living_all", fields: { entities: ["light.living_spots"] } })).toMatch(/isn't set up in the Home Assistant UI/);
    expect(t.add({ kind: "helper", op: "update", targetId: "light.nope", fields: { entities: ["light.desk"] } })).toMatch(/isn't in Home Assistant/);
  });

  it("aims a members update made under a pending rename at the id Home Assistant has now", () => {
    const t = setup();
    expect(t.add({ kind: "entity", op: "update", targetId: "light.hall_lights", fields: { new_entity_id: "light.hall_all" } })).toBeNull();
    expect(t.add({ kind: "helper", op: "update", targetId: "light.hall_all", fields: { entities: ["light.hall_ceiling"] } })).toBeNull();
    expect(t.store.list()[1]).toMatchObject({ kind: "helper", targetId: "light.hall_lights" });
  });

  it("is not in the preview, which leaves the rest of the house as it is", () => {
    const t = setup();
    t.add(group());
    t.add({ kind: "helper", op: "update", targetId: "light.garage_all", fields: { entities: ["light.garage_bench"] } });
    const preview = buildHierarchy(overlayChanges(t.ha, t.store.list()), "now");
    expect(preview.entities["light.study_all"]).toBeUndefined();
    expect(preview.entities["light.garage_all"].members).toEqual(["light.garage_ceiling"]);
  });

  it("points an area at a sensor: in the preview, in the validation, and on Apply", async () => {
    const t = setup();
    expect(validateInput({ kind: "area", op: "update", targetId: "study", fields: { temperature_entity_id: "Not an id" } })).toMatch(/wouldn't accept/);
    expect(t.add({ kind: "area", op: "update", targetId: "study", fields: { temperature_entity_id: "sensor.study_climate_temperature" } })).toBeNull();
    expect(t.store.list()[0]).toMatchObject({ before: { temperature_entity_id: null }, after: { temperature_entity_id: "sensor.study_climate_temperature" } });
    expect(buildHierarchy(overlayChanges(t.ha, t.store.list()), "now").areas.study.temperatureEntityId).toBe("sensor.study_climate_temperature");
    const { results } = await t.apply();
    expect(results[0]).toMatchObject({ ok: true });
    expect(t.live().areas.study.temperatureEntityId).toBe("sensor.study_climate_temperature");
    expect(t.writes.map((w) => w.type)).toEqual(["config/area_registry/update"]);
  });

  it("doesn't send an area a sensor Home Assistant no longer has", async () => {
    const t = setup();
    t.add({ kind: "area", op: "update", targetId: "study", fields: { humidity_entity_id: "sensor.living_humidity" } });
    t.ha.entities = t.ha.entities.filter((e) => e.entity_id !== "sensor.living_humidity");
    t.ha.states = t.ha.states.filter((s) => s.entity_id !== "sensor.living_humidity");
    const { results } = await t.apply();
    expect(results[0]).toMatchObject({ ok: false });
    expect(results[0].message).toMatch(/no longer in Home Assistant/);
    expect(t.writes).toEqual([]);
  });

  it("leaves helper changes to the helper step, with no result of its own", async () => {
    const t = setup();
    t.add(group());
    t.add({ kind: "entity", op: "update", targetId: "light.desk", fields: { name: "Desk" } });
    const { results } = await t.apply();
    expect(results).toHaveLength(1);
    expect(t.writes.map((w) => w.type)).toEqual(["config/entity_registry/update"]);
    expect(t.live().entities["light.study_all"]).toBeUndefined();
  });
});
