// Regression tests for the problems an independent review found in the first
// version of editing (0.2.0 before release). Each test names the finding.

import { describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";

import { buildMockRegistry, handleMock } from "../../scripts/mock-ha-core.ts";
import { validateInput } from "../../shared/changes.ts";
import type { ChangeInput } from "../../shared/types.ts";
import { buildHierarchy, type RawRegistry } from "../model/hierarchy.ts";
import { applyChanges, type Writer } from "./apply.ts";
import { changeStore } from "./store.ts";

function setup() {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE changes (id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, op TEXT NOT NULL, target_id TEXT NOT NULL,
    scope TEXT, before TEXT NOT NULL, after TEXT NOT NULL, created_at TEXT NOT NULL)`);
  const store = changeStore(db);
  const ha = buildMockRegistry();
  const writes: string[] = [];
  const writer = (refuse?: (type: string, p: Record<string, unknown>) => string | null): Writer => ({
    async write<T>(type: string, payload: Record<string, unknown>): Promise<T> {
      const refused = refuse?.(type, payload);
      if (refused) throw new Error(refused);
      writes.push(`${type} ${JSON.stringify(payload)}`);
      const reply = handleMock(ha, type, payload);
      if (!reply.success) throw new Error(reply.message);
      return reply.result as T;
    },
  });
  const live = () => buildHierarchy(structuredClone(ha), "now");
  const add = (input: ChangeInput) => validateInput(input) ?? store.add(input, live());
  // What the server does after Apply: done changes leave, temp ids are swapped.
  const apply = async (w: Writer = writer()) => {
    const out = await applyChanges(store.list(), w, async () => structuredClone(ha) as RawRegistry);
    for (const id of out.appliedIds) store.done(id);
    for (const [temp, real] of out.realIds) store.swapTempId(temp, real);
    return out;
  };
  return { store, ha, writes, writer, live, add, apply };
}

describe("review finding 1: a creation that applied doesn't take failed changes with it", () => {
  it("keeps the failed change in the list, now pointing at the real id", async () => {
    const t = setup();
    t.add({ kind: "label", op: "create", fields: { name: "Night" } });
    t.add({ kind: "entity", op: "update", targetId: "light.desk", fields: { labels: [t.store.list()[0].targetId], name: "Renamed" } });
    const { results } = await t.apply(t.writer((type) => (type === "config/entity_registry/update" ? "busy" : null)));
    expect(results.map((r) => r.ok)).toEqual([true, false]);
    const left = t.store.list();
    expect(left).toHaveLength(1);
    expect(left[0].after).toEqual({ labels: ["night"], name: "Renamed" });
    // And the next Apply goes through.
    const again = await t.apply();
    expect(again.results.every((r) => r.ok)).toBe(true);
  });
});

describe("review finding 2: labels and categories apply as a difference, not a stale full list", () => {
  it("keeps a label added in Home Assistant after the edit was made", async () => {
    const t = setup();
    t.add({ kind: "entity", op: "update", targetId: "light.desk", fields: { labels: ["kids"] } });
    // Meanwhile someone adds another label in Home Assistant.
    t.ha.labels.push({ label_id: "outdoor", name: "Outdoor" });
    t.ha.entities.find((e) => e.entity_id === "light.desk")!.labels = ["outdoor"];
    const { results } = await t.apply();
    expect(results[0].ok).toBe(true);
    expect(t.live().entities["light.desk"].labels.sort()).toEqual(["kids", "outdoor"]);
  });

  it("stores and sends only the category scopes that change", () => {
    const t = setup();
    t.add({ kind: "entity", op: "update", targetId: "automation.lights_on_at_sunset", fields: { categories: { automation: "cat_lighting", helpers: null } } });
    expect(t.add({ kind: "entity", op: "update", targetId: "automation.lights_on_at_sunset", fields: { categories: { automation: "cat_lighting" } } })).toMatch(/already is/);
  });

  it("refuses to overwrite a field Home Assistant changed after the edit", async () => {
    const t = setup();
    t.add({ kind: "area", op: "update", targetId: "study", fields: { name: "Office" } });
    t.ha.areas.find((a) => a.area_id === "study")!.name = "Workroom";
    const { results } = await t.apply();
    expect(results[0]).toMatchObject({ ok: false });
    expect(results[0].message).toMatch(/changed in Home Assistant after you made this edit/);
    expect(t.live().areas.study.name).toBe("Workroom");
  });
});

describe("review finding 4: no references to items that are gone or going", () => {
  it("refuses to delete an area other changes move things into", () => {
    const t = setup();
    t.add({ kind: "device", op: "update", targetId: "plug", fields: { area_id: "study" } });
    expect(t.add({ kind: "area", op: "delete", targetId: "study" })).toMatch(/1 change in the list uses this area/);
  });

  it("refuses to move something into an area that is set to be deleted, or doesn't exist", () => {
    const t = setup();
    t.add({ kind: "area", op: "delete", targetId: "garage" });
    expect(t.add({ kind: "device", op: "update", targetId: "plug", fields: { area_id: "garage" } })).toMatch(/set to be deleted/);
    expect(t.add({ kind: "device", op: "update", targetId: "plug", fields: { area_id: "nowhere" } })).toMatch(/isn't in Home Assistant/);
    expect(t.add({ kind: "device", op: "update", targetId: "plug", fields: { area_id: "new:area:99" } })).toMatch(/isn't in Home Assistant or in the list/);
  });

  it("fails, rather than writes, a change whose area disappeared in Home Assistant", async () => {
    const t = setup();
    t.add({ kind: "device", op: "update", targetId: "plug", fields: { area_id: "garage" } });
    t.ha.areas = t.ha.areas.filter((a) => a.area_id !== "garage");
    const { results } = await t.apply();
    expect(results[0].message).toMatch(/no longer in Home Assistant/);
    expect(t.writes).toEqual([]);
  });
});

describe("review finding 5: a creation that happened is never sent twice", () => {
  it("refuses to create a name Home Assistant already has", async () => {
    const t = setup();
    t.add({ kind: "area", op: "create", fields: { name: "kitchen" } });
    const { results } = await t.apply();
    expect(results[0].message).toMatch(/already has an area named “kitchen”/);
  });

  it("counts a creation as done when Home Assistant made it, even if a detail differs", async () => {
    const t = setup();
    t.add({ kind: "label", op: "create", fields: { name: "Night", color: "indigo" } });
    // This Home Assistant ignores the color.
    const ignoresColor: Writer = {
      async write<T>(type: string, p: Record<string, unknown>) {
        const { color: _c, ...rest } = p;
        const reply = handleMock(t.ha, type, type.endsWith("/create") ? rest : p);
        if (!reply.success) throw new Error(reply.message);
        return reply.result as T;
      },
    };
    const { results } = await t.apply(ignoresColor);
    expect(results[0]).toMatchObject({ ok: true });
    expect(results[0].message).toMatch(/^Created, but/);
    expect(t.store.list()).toHaveLength(0);
  });
});

describe("review finding 7: removing a creation keeps the rest of the edits", () => {
  it("strips the reference and keeps other fields, across levels", () => {
    const t = setup();
    t.add({ kind: "floor", op: "create", fields: { name: "Loft" } });
    const floor = t.store.list()[0].targetId;
    t.add({ kind: "area", op: "create", fields: { name: "Attic", floor_id: floor } });
    const area = t.store.list()[1].targetId;
    t.add({ kind: "device", op: "update", targetId: "hub", fields: { area_id: area, name_by_user: "Hub!" } });
    t.add({ kind: "floor", op: "delete", targetId: floor });
    const left = t.store.list();
    expect(left.map((c) => `${c.op} ${c.kind}`)).toEqual(["create area", "update device"]);
    expect(left[0].after).toEqual({ name: "Attic" });
    expect(left[1].after).toEqual({ area_id: area, name_by_user: "Hub!" });
    // Removing the area creation keeps the rename.
    t.store.remove(left[0].id);
    expect(t.store.list()[0].after).toEqual({ name_by_user: "Hub!" });
  });
});

describe("review finding 8: only id fields are treated as temporary ids", () => {
  it("applies a label named “new:gadgets”", async () => {
    const t = setup();
    t.add({ kind: "label", op: "create", fields: { name: "new:gadgets" } });
    const { results } = await t.apply();
    expect(results[0].ok).toBe(true);
  });
});

describe("review finding 9: a device's main entity needs a name for an area of its own", () => {
  it("refuses the area without a name, and accepts it with one", () => {
    const t = setup();
    t.ha.entities.find((e) => e.entity_id === "light.desk")!.has_entity_name = true;
    t.ha.entities.find((e) => e.entity_id === "light.desk")!.original_name = null;
    expect(t.add({ kind: "entity", op: "update", targetId: "light.desk", fields: { area_id: "kitchen" } })).toMatch(/once it has a name/);
    expect(t.add({ kind: "entity", op: "update", targetId: "light.desk", fields: { area_id: "kitchen", name: "Desk lamp" } })).toBeNull();
  });
});

describe("review finding 10: delete-and-recreate and rename-and-reuse work in one Apply", () => {
  it("deletes or renames the old item first when a new one needs its name", async () => {
    const t = setup();
    t.add({ kind: "area", op: "delete", targetId: "garage" });
    t.add({ kind: "area", op: "create", fields: { name: "Garage" } });
    t.add({ kind: "label", op: "update", targetId: "kids", fields: { name: "Children" } });
    t.add({ kind: "label", op: "create", fields: { name: "Kids" } });
    const { results } = await t.apply();
    expect(results.filter((r) => !r.ok)).toEqual([]);
    expect(t.writes.findIndex((w) => w.startsWith("config/area_registry/delete"))).toBeLessThan(t.writes.findIndex((w) => w.startsWith("config/area_registry/create")));
  });
});

describe("review finding 11: before values, and scope only on categories", () => {
  it("records who hid an entity, and only categories take a scope", () => {
    const t = setup();
    t.ha.entities.find((e) => e.entity_id === "light.desk")!.hidden_by = "integration";
    t.add({ kind: "entity", op: "update", targetId: "light.desk", fields: { hidden_by: null } });
    expect(t.store.list()[0].before).toEqual({ hidden_by: "integration" });
    expect(validateInput({ kind: "entity", op: "update", targetId: "light.desk", scope: "automation", fields: { name: "x" } })).toMatch(/Only a category change has a scope/);
  });
});

// ---------------------------------------------------------------------------
// Second review.
// ---------------------------------------------------------------------------

describe("second review 1+2: a second edit keeps the first edit's before, and labels stay a difference", () => {
  it("doesn't remove a label Home Assistant gained between two edits", async () => {
    const t = setup();
    t.add({ kind: "entity", op: "update", targetId: "light.desk", fields: { labels: ["kids"] } });
    t.ha.labels.push({ label_id: "night", name: "Night" });
    t.ha.entities.find((e) => e.entity_id === "light.desk")!.labels = ["night"];
    t.add({ kind: "entity", op: "update", targetId: "light.desk", fields: { name: "Desk" } });
    expect(t.store.list()[0].before.labels).toEqual([]);
    const { results } = await t.apply();
    expect(results[0].ok).toBe(true);
    expect(t.live().entities["light.desk"].labels.sort()).toEqual(["kids", "night"]);
  });

  it("still reports a conflict when a second edit touches another field", async () => {
    const t = setup();
    t.add({ kind: "area", op: "update", targetId: "study", fields: { name: "Office" } });
    t.ha.areas.find((a) => a.area_id === "study")!.name = "Workroom";
    t.add({ kind: "area", op: "update", targetId: "study", fields: { icon: "mdi:desk" } });
    const { results } = await t.apply();
    expect(results[0].message).toMatch(/changed in Home Assistant after you made this edit/);
  });
});

describe("second review 5: the main-entity rule only applies to area and name edits", () => {
  it("allows an icon edit on a main entity that has its own area and no name", () => {
    const t = setup();
    const desk = t.ha.entities.find((e) => e.entity_id === "light.desk")!;
    desk.original_name = null;
    desk.area_id = "kitchen";
    expect(t.add({ kind: "entity", op: "update", targetId: "light.desk", fields: { icon: "mdi:lamp" } })).toBeNull();
  });
});

describe("second review 6: deleting a label only counts changes that add it", () => {
  it("lets you delete a label that pending edits merely keep", () => {
    const t = setup();
    t.ha.entities.find((e) => e.entity_id === "light.desk")!.labels = ["kids"];
    t.ha.labels.push({ label_id: "night", name: "Night" });
    t.add({ kind: "entity", op: "update", targetId: "light.desk", fields: { labels: ["kids", "night"] } });
    expect(t.add({ kind: "label", op: "delete", targetId: "kids" })).toBeNull();
  });

  it("applies both, without a false failure for the label that was deleted", async () => {
    const t = setup();
    t.ha.entities.find((e) => e.entity_id === "light.desk")!.labels = ["kids"];
    t.ha.labels.push({ label_id: "night", name: "Night" });
    t.add({ kind: "entity", op: "update", targetId: "light.desk", fields: { labels: ["kids", "night"] } });
    t.add({ kind: "label", op: "delete", targetId: "kids" });
    const { results } = await t.apply();
    expect(results.filter((r) => !r.ok)).toEqual([]);
    expect(t.live().entities["light.desk"].labels).toEqual(["night"]);
  });
});

describe("second review 7: labels and categories that vanished in Home Assistant", () => {
  it("fails a change that adds a label deleted in Home Assistant since", async () => {
    const t = setup();
    t.add({ kind: "entity", op: "update", targetId: "light.desk", fields: { labels: ["kids"] } });
    t.ha.labels = [];
    const { results } = await t.apply();
    expect(results[0].message).toMatch(/label “kids” it adds is no longer in Home Assistant/);
    expect(t.writes).toEqual([]);
  });

  it("fails a change that sets a category deleted in Home Assistant since", async () => {
    const t = setup();
    t.add({ kind: "entity", op: "update", targetId: "input_boolean.guest_mode", fields: { categories: { helpers: "cat_modes" } } });
    t.ha.categories!.helpers = [];
    const { results } = await t.apply();
    expect(results[0].message).toMatch(/helpers category it sets is no longer in Home Assistant/);
  });
});

describe("second review 8: name clashes follow Home Assistant's rules", () => {
  it("lets a category named LivingRoom sit next to one named Living Room", async () => {
    const t = setup();
    t.ha.categories!.automation!.push({ category_id: "cat_lr", name: "Living Room" });
    t.add({ kind: "category", op: "create", scope: "automation", fields: { name: "LivingRoom" } });
    const { results } = await t.apply();
    expect(results[0].ok).toBe(true);
  });

  it("but treats Living Room and LivingRoom as the same area name", async () => {
    const t = setup();
    t.add({ kind: "area", op: "create", fields: { name: "LivingRoom" } });
    const { results } = await t.apply();
    expect(results[0].message).toMatch(/already has an area named/);
  });
});
