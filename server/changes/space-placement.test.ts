import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { buildMockRegistry, handleMock } from "../../scripts/mock-ha-core.ts";
import { resolveSpaces, spaceFloorDescription, spaceFloorFromDescription } from "../../shared/spaces.ts";
import { buildHierarchy, type RawRegistry } from "../model/hierarchy.ts";
import { applyChanges } from "./apply.ts";
import { overlayChanges } from "./overlay.ts";
import { changeStore } from "./store.ts";

function setup() {
  const db = new DatabaseSync(":memory:");
  db.exec(
    "CREATE TABLE changes (id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, op TEXT NOT NULL, target_id TEXT NOT NULL, scope TEXT, before TEXT NOT NULL, after TEXT NOT NULL, created_at TEXT NOT NULL)",
  );
  const store = changeStore(db);
  const ha = buildMockRegistry();
  const live = () => buildHierarchy(structuredClone(ha), "now");
  const writes: { type: string; payload: Record<string, unknown> }[] = [];
  const writer = {
    async write<T>(type: string, payload: Record<string, unknown>): Promise<T> {
      writes.push({ type, payload });
      const result = handleMock(ha, type, payload);
      if (!result.success) throw new Error(result.message);
      return result.result as T;
    },
  };
  return { store, ha, live, writes, apply: () => applyChanges(store.list(), writer, async () => structuredClone(ha) as RawRegistry) };
}

describe("Space floor placement", () => {
  it("persists and reloads an empty Space hint without changing area membership", async () => {
    const t = setup();
    const other = { label_id: "existing_space", name: "Space: Existing", description: "Existing notes" };
    t.ha.labels.push(other);
    expect(t.store.add({ kind: "label", op: "create", fields: { name: "Space: Empty", description: spaceFloorDescription("ground") } }, t.live())).toBeNull();
    expect((await t.apply()).results.every((result) => result.ok)).toBe(true);
    const reloaded = resolveSpaces(t.live());
    expect(reloaded.find((space) => space.name === "Empty")).toMatchObject({ areaIds: [], declaredFloorIds: ["ground"] });
    expect(other.description).toBe("Existing notes");
    expect(reloaded.find((space) => space.name === "Existing")?.declaredFloorIds).toEqual([]);
  });

  it("supports a pending floor and resolves its real ID before writing the label", async () => {
    const t = setup();
    expect(t.store.add({ kind: "floor", op: "create", fields: { name: "New floor" } }, t.live())).toBeNull();
    const temporary = t.store.list()[0].targetId;
    expect(t.store.add({ kind: "label", op: "create", fields: { name: "Space: Empty", description: spaceFloorDescription(temporary) } }, t.live())).toBeNull();
    const overlay = buildHierarchy(overlayChanges(structuredClone(t.ha) as RawRegistry, t.store.list()), "now");
    expect(resolveSpaces(overlay).find((space) => space.name === "Empty")?.declaredFloorIds).toEqual([temporary]);
    const result = await t.apply();
    expect(result.results.every((item) => item.ok)).toBe(true);
    expect(t.writes.find((write) => write.type === "config/label_registry/create")?.payload.description).toBe(spaceFloorDescription("new_floor"));
    expect(resolveSpaces(t.live()).find((space) => space.name === "Empty")?.declaredFloorIds).toEqual(["new_floor"]);
  });

  it("retargets the hint when only the floor succeeded", () => {
    const t = setup();
    t.store.add({ kind: "floor", op: "create", fields: { name: "New floor" } }, t.live());
    const floor = t.store.list()[0];
    t.store.add({ kind: "label", op: "create", fields: { name: "Space: Empty", description: spaceFloorDescription(floor.targetId) } }, t.live());
    t.store.settle({
      results: [{ changeId: floor.id, ok: true, message: "Applied" }],
      realIds: new Map([[floor.targetId, "new_floor"]]),
      retargets: [],
      renamed: new Map(),
    });
    expect(t.store.list()[0].after.description).toBe(spaceFloorDescription("new_floor"));
  });

  it("does not silently discard placement when its pending floor is removed", async () => {
    const t = setup();
    t.store.add({ kind: "floor", op: "create", fields: { name: "New floor" } }, t.live());
    const floor = t.store.list()[0];
    t.store.add({ kind: "label", op: "create", fields: { name: "Space: Empty", description: spaceFloorDescription(floor.targetId) } }, t.live());
    t.store.remove(floor.id);
    expect(t.store.list()[0].after.description).toBe(spaceFloorDescription(floor.targetId));
    expect((await t.apply()).results[0]).toMatchObject({ ok: false, message: expect.stringContaining("floor") });
    expect(t.writes).toEqual([]);
  });

  it("rejects missing floor references and stops when a floor disappears before Apply", async () => {
    const t = setup();
    expect(t.store.add({ kind: "label", op: "create", fields: { name: "Space: Missing", description: spaceFloorDescription("missing") } }, t.live())).toContain(
      "floor",
    );
    expect(t.store.add({ kind: "label", op: "create", fields: { name: "Space: Stale", description: spaceFloorDescription("ground") } }, t.live())).toBeNull();
    t.ha.floors = t.ha.floors.filter((floor) => floor.floor_id !== "ground");
    expect((await t.apply()).results[0]).toMatchObject({ ok: false, message: expect.stringContaining("floor") });
    expect(t.writes).toEqual([]);
  });

  it("ignores malformed or stale hints without altering the existing description", () => {
    const t = setup();
    t.ha.labels.push({ label_id: "invalid_space", name: "Space: Invalid", description: 'Taxis Space floor: "ground"\nOther notes' });
    t.ha.labels.push({ label_id: "stale_space", name: "Space: Stale", description: spaceFloorDescription("missing") });
    expect(spaceFloorFromDescription(t.ha.labels.find((label) => label.label_id === "invalid_space")!.description)).toBeNull();
    expect(
      resolveSpaces(t.live())
        .filter((space) => ["Invalid", "Stale"].includes(space.name))
        .every((space) => !space.declaredFloorIds.length),
    ).toBe(true);
  });

  it("keeps physical area membership independent of the placement hint", () => {
    const t = setup();
    t.ha.labels.push({ label_id: "cross_floor", name: "Space: Cross floor", description: spaceFloorDescription("ground") });
    t.ha.areas.find((area) => area.floor_id === "first")!.labels = ["cross_floor"];
    const space = resolveSpaces(t.live()).find((item) => item.id === "cross_floor")!;
    expect(space.declaredFloorIds).toEqual(["ground"]);
    expect(space.areaIds).toHaveLength(1);
    expect(t.live().areas[space.areaIds[0]].floorId).toBe("first");
  });
});
