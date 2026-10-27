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

describe("placing a light that is in no area", () => {
  it("sets the entity's own area, the way the entity editor does", () => {
    const t = setup();
    expect(t.add({ kind: "entity", op: "update", targetId: "light.stair_lamp", fields: { area_id: "kitchen" } })).toBeNull();
    expect(t.store.list()[0]).toMatchObject({ kind: "entity", op: "update", targetId: "light.stair_lamp", before: { area_id: null }, after: { area_id: "kitchen" } });
    // The preview shows it in the area, so it drops out of the lights with no area.
    const h = buildHierarchy(overlayChanges(structuredClone(t.ha) as RawRegistry, t.store.list()), "now");
    expect(h.entities["light.stair_lamp"].areaId).toBe("kitchen");
  });

  it("refuses a device's main entity with no name of its own, until the same edit names it", () => {
    const t = setup();
    expect(t.add({ kind: "entity", op: "update", targetId: "light.porch_lamp", fields: { area_id: "kitchen" } })).toMatch(/only lets this entity have an area of its own once it has a name/);
    expect(t.add({ kind: "entity", op: "update", targetId: "light.porch_lamp", fields: { area_id: "kitchen", name: "Porch lamp" } })).toBeNull();
    expect(t.store.list()[0].after).toEqual({ area_id: "kitchen", name: "Porch lamp" });
  });
});

describe("showing an entity as another device class", () => {
  const show = (targetId: string, device_class: string | null): ChangeInput => ({ kind: "entity", op: "update", targetId, fields: { device_class } });

  it("accepts a class of the entity's own domain, or null to go back to the default", () => {
    expect(validateInput(show("binary_sensor.study_skylight", "window"))).toBeNull();
    expect(validateInput(show("binary_sensor.study_skylight", null))).toBeNull();
    expect(validateInput(show("sensor.study_climate_temperature", "humidity"))).toBeNull();
    expect(validateInput(show("cover.shutter", "shutter"))).toBeNull();
  });

  it("refuses a class the domain doesn't have, a domain with none, and anything that isn't a class", () => {
    expect(validateInput(show("binary_sensor.study_skylight", "temperature"))).toMatch(/isn't a device class for a binary_sensor/);
    expect(validateInput(show("light.desk", "window"))).toMatch(/no device class to choose/);
    expect(validateInput(show("binary_sensor.study_skylight", "Window"))).toMatch(/wouldn't accept/);
    expect(validateInput(show("binary_sensor.study_skylight", "window; drop"))).toMatch(/wouldn't accept/);
    expect(validateInput({ kind: "entity", op: "update", targetId: "binary_sensor.study_skylight", fields: { device_class: 3 as never } })).toMatch(/wouldn't accept/);
    // Only an entity has one: a device or an area can't be shown as anything.
    expect(validateInput({ kind: "device", op: "update", targetId: "plug", fields: { device_class: "outlet" } })).toMatch(/can't be changed/);
  });

  it("previews the new role at once, and Apply writes only the class and reads it back", async () => {
    const t = setup();
    expect(t.live().entities["binary_sensor.study_skylight"]).toMatchObject({ role: "opening", deviceClass: "opening", deviceClassOverride: null });
    expect(t.add(show("binary_sensor.study_skylight", "motion"))).toBeNull();
    expect(t.store.list()[0]).toMatchObject({ before: { device_class: null }, after: { device_class: "motion" } });
    const preview = buildHierarchy(overlayChanges(structuredClone(t.ha) as RawRegistry, t.store.list()), "now");
    expect(preview.entities["binary_sensor.study_skylight"]).toMatchObject({ role: "motion", deviceClass: "motion", deviceClassOverride: "motion" });
    // The live read is untouched until Apply.
    expect(t.live().entities["binary_sensor.study_skylight"].deviceClass).toBe("opening");

    const { results } = await t.apply();
    expect(results.every((r) => r.ok)).toBe(true);
    expect(t.writes).toEqual([{ type: "config/entity_registry/update", payload: { entity_id: "binary_sensor.study_skylight", device_class: "motion" } }]);
    expect(t.live().entities["binary_sensor.study_skylight"]).toMatchObject({ role: "motion", deviceClassOverride: "motion" });
  });

  it("refuses to apply over a class that changed in Home Assistant meanwhile", async () => {
    const t = setup();
    t.add(show("binary_sensor.study_skylight", "motion"));
    t.ha.entities.find((e) => e.entity_id === "binary_sensor.study_skylight")!.device_class = "door";
    const { results } = await t.apply();
    expect(results[0]).toMatchObject({ ok: false });
    expect(results[0].message).toMatch(/device class was changed in Home Assistant/);
    expect(t.writes).toEqual([]);
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
    expect(validateInput(group({ helper: "counter" }))).toMatch(/wouldn't accept/);
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

  it("lets a light group of a floor or the house have no area, and nothing else", () => {
    const floating = (fields: Record<string, unknown> = {}): ChangeInput => ({
      kind: "helper",
      op: "create",
      fields: { helper: "group", group_type: "light", name: "Ground floor lights", entity_id: "light.ground_all", entities: ["light.garage_all", "light.desk"], ...fields },
    });
    expect(validateInput(floating())).toBeNull();
    // Another kind of group, a min/max helper or a timer still needs an area.
    const { area_id: _a, ...noArea } = group().fields!;
    expect(validateInput({ kind: "helper", op: "create", fields: { ...noArea, group_type: "binary_sensor", entity_id: "binary_sensor.x", entities: ["binary_sensor.a"] } })).toMatch(/needs an area/);
    expect(validateInput({ kind: "helper", op: "create", fields: { helper: "min_max", name: "x", entity_id: "sensor.x", entities: ["sensor.a"] } })).toMatch(/needs an area/);
    expect(validateInput({ kind: "helper", op: "create", fields: { helper: "timer", name: "x", entity_id: "timer.x", duration: 60 } })).toMatch(/needs an area/);
    // A light group still can't set an area's sensor.
    expect(validateInput(floating({ set_area_sensor: "temperature" }))).toMatch(/Only a min\/max/);
  });

  it("accepts a group whose members are groups the list creates, or renames to that id, and no other missing member", () => {
    const t = setup();
    const floor = (entities: string[]): ChangeInput => ({
      kind: "helper",
      op: "create",
      fields: { helper: "group", group_type: "light", name: "Ground floor lights", entity_id: "light.ground_all", entities },
    });
    // Nothing in the list makes light.study_all yet.
    expect(t.add(floor(["light.study_all", "light.garage_all"]))).toMatch(/“light.study_all” isn't in Home Assistant/);
    expect(t.add(group())).toBeNull();
    expect(t.add(floor(["light.study_all", "light.garage_all"]))).toBeNull();
    expect(t.store.list().map((c) => c.targetId)).toEqual(["light.study_all", "light.ground_all"]);
    expect(t.store.list()[1].after).not.toHaveProperty("area_id");
    // A rename to the id counts the same.
    const r = setup();
    expect(r.add({ kind: "entity", op: "update", targetId: "light.downstairs", fields: { new_entity_id: "light.kitchen_all" } })).toBeNull();
    expect(r.add({ ...floor(["light.kitchen_all"]), fields: { ...floor(["light.kitchen_all"]).fields, entity_id: "light.first_all" } })).toBeNull();
    // A member that nothing makes is still refused.
    expect(r.add({ ...floor(["light.nope_all"]), fields: { ...floor(["light.nope_all"]).fields, entity_id: "light.loft_all" } })).toMatch(/isn't in Home Assistant/);
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

describe("a derivative sensor", () => {
  const rate = (fields: Record<string, unknown> = {}): ChangeInput => ({
    kind: "helper",
    op: "create",
    fields: { helper: "derivative", name: "Study humidity rate", entity_id: "sensor.study_humidity_rate", entities: ["sensor.study_climate_temperature"], area_id: "study", ...fields },
  });

  it("is a sensor in an area with the one sensor it derives from, and nothing a group or a min/max has", () => {
    expect(validateInput(rate())).toBeNull();
    expect(validateInput(rate({ entities: [] }))).toMatch(/wouldn't accept/);
    expect(validateInput(rate({ entities: ["sensor.a", "sensor.b"] }))).toMatch(/one sensor it derives from/);
    expect(validateInput(rate({ entities: ["binary_sensor.a"] }))).toMatch(/one sensor it derives from/);
    expect(validateInput(rate({ entity_id: "light.study_humidity_rate" }))).toMatch(/has to start with “sensor/);
    expect(validateInput(rate({ group_type: "light" }))).toMatch(/neither a group type/);
    expect(validateInput(rate({ set_area_sensor: "humidity" }))).toMatch(/neither a group type nor sets the area's sensor|Only a min\/max/);
    expect(validateInput(rate({ duration: 60 }))).toMatch(/Only a timer/);
    const { area_id: _area, ...noArea } = rate().fields!;
    expect(validateInput({ kind: "helper", op: "create", fields: noArea })).toMatch(/needs an area/);
    // Never deleted, and no other kind of helper is added by this one.
    expect(validateInput({ kind: "helper", op: "delete", targetId: "sensor.study_humidity_rate" })).toMatch(/not deleted/);
    expect(validateInput(rate({ helper: "threshold" }))).toMatch(/wouldn't accept/);
  });

  it("is kept under the entity id it will have, once, and its source may be a sensor the list makes", () => {
    const t = setup();
    expect(t.add(rate())).toBeNull();
    expect(t.store.list()[0]).toMatchObject({ kind: "helper", op: "create", targetId: "sensor.study_humidity_rate" });
    expect(t.add(rate())).toMatch(/already creates/);
    expect(t.add(rate({ entity_id: "sensor.study_other", entities: ["sensor.not_there"] }))).toMatch(/isn't in Home Assistant/);
    // A min/max the list creates is a source.
    const mean: ChangeInput = { kind: "helper", op: "create", fields: { helper: "min_max", name: "Study humidity", entity_id: "sensor.study_humidity", entities: ["sensor.study_climate_temperature"], area_id: "study" } };
    expect(t.add(mean)).toBeNull();
    expect(t.add(rate({ entity_id: "sensor.study_rate_2", entities: ["sensor.study_humidity"] }))).toBeNull();
  });
});

describe("the announce script", () => {
  const input = { areas: [], tts_entity: "tts.cloud", default_volume: 40 };
  const script = (fields: Record<string, unknown> = {}): ChangeInput => ({
    kind: "script",
    op: "create",
    fields: { script_id: "taxis_announce", alias: "Announce (Taxis)", use_blueprint: { path: "taxis/announce.yaml", input }, ...fields },
  });

  it("is one script, from the announce blueprint, never deleted", () => {
    expect(validateInput(script())).toBeNull();
    expect(validateInput({ ...script(), op: "update" })).toBeNull();
    expect(validateInput(script({ script_id: "taxis_other" }))).toMatch(/wouldn't accept/);
    expect(validateInput(script({ script_id: "movie_time" }))).toMatch(/wouldn't accept/);
    expect(validateInput(script({ use_blueprint: { path: "taxis/occupancy.yaml", input } }))).toMatch(/another blueprint|wouldn't accept/);
    expect(validateInput(script({ use_blueprint: { path: "taxis/announce.yaml", input: { ...input, extra: 1 } } }))).toMatch(/wouldn't accept/);
    expect(validateInput(script({ use_blueprint: { path: "taxis/announce.yaml", input: { tts_entity: "tts.cloud" } } }))).toMatch(/wouldn't accept/);
    expect(validateInput(script({ alias: "" }))).toMatch(/wouldn't accept/);
    expect(validateInput(script({ area_id: "study" }))).toMatch(/can't be changed/);
    expect(validateInput({ kind: "script", op: "delete", targetId: "taxis_announce" })).toMatch(/created or updated, not deleted/);
    const { alias: _a, ...noAlias } = script().fields!;
    expect(validateInput({ kind: "script", op: "create", fields: noAlias })).toMatch(/needs alias/);
  });

  it("takes the areas as objects with their four fields, and refuses anything else in them", () => {
    const area = { occupied: "binary_sensor.k_occupied", paused: "input_boolean.k_paused", bed: [], speakers: ["media_player.k"] };
    const use = (areas: unknown) => script({ use_blueprint: { path: "taxis/announce.yaml", input: { ...input, areas } } });
    expect(validateInput(use([area]))).toBeNull();
    expect(validateInput(use([{ ...area, speakers: ["light.k"] }]))).toMatch(/wouldn't accept/);
    expect(validateInput(use([{ ...area, extra: true }]))).toMatch(/wouldn't accept/);
    expect(validateInput(use("areas"))).toMatch(/wouldn't accept/);
  });

  it("an automation cannot be the announce recipe: it is a script", () => {
    const use = { path: "taxis/announce.yaml", input };
    expect(validateInput({ kind: "automation", op: "create", fields: { automation_id: "taxis_announce_study", recipe: "announce", area_id: "study", alias: "x", use_blueprint: use } })).toMatch(/a script, not an automation/);
  });

  it("is kept under its id, once: adding it again replaces it, and it has no temporary id", () => {
    const t = setup();
    expect(t.add(script())).toBeNull();
    expect(t.add(script({ alias: "Announce (Taxis) 2" }))).toBeNull();
    expect(t.store.list()).toHaveLength(1);
    expect(t.store.list()[0]).toMatchObject({ kind: "script", op: "create", targetId: "taxis_announce", after: { alias: "Announce (Taxis) 2" } });
    // Nothing for Apply's registry step: it leaves it to the script step.
    expect(t.writes).toEqual([]);
  });
});
