import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { buildMockRegistry, handleMock } from "../../scripts/mock-ha-core.ts";
import { planAreaMove } from "../../shared/area-move.ts";
import { buildHierarchy, type RawRegistry } from "../model/hierarchy.ts";
import { applyChanges } from "./apply.ts";
import { changeStore } from "./store.ts";
import { previewChanges, previewVersion, visiblePreview } from "./direct-preview.ts";

function setup() {
  const db = new DatabaseSync(":memory:");
  db.exec(
    "CREATE TABLE changes (id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, op TEXT NOT NULL, target_id TEXT NOT NULL, scope TEXT, before TEXT NOT NULL, after TEXT NOT NULL, created_at TEXT NOT NULL)",
  );
  const store = changeStore(db);
  const ha = buildMockRegistry();
  ha.labels.push(
    { label_id: "old_space", name: "Space: Old" },
    { label_id: "new_space", name: "Space: New" },
    { label_id: "another_space", name: "Space: Another" },
    { label_id: "keep", name: "Keep" },
  );
  const area = ha.areas.find((item) => item.area_id === "study")!;
  area.labels = ["old_space", "keep"];
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
  return { store, ha, area, live, writes, apply: () => applyChanges(store.list(), writer, async () => structuredClone(ha) as RawRegistry) };
}

describe("area move pipeline", () => {
  it("writes only the native area floor and labels and preserves unrelated labels", async () => {
    const t = setup();
    const plan = planAreaMove(t.live(), "study", { floorId: null, space: { kind: "set", labelId: "new_space" } });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(t.store.add(plan.input, t.live())).toBeNull();
    const result = await t.apply();
    expect(result.results.every((item) => item.ok)).toBe(true);
    expect(t.writes).toHaveLength(1);
    expect(t.writes[0]).toMatchObject({ type: "config/area_registry/update", payload: { area_id: "study", floor_id: null, labels: ["keep", "new_space"] } });
    expect(t.live().areas.study.labels).toEqual(["keep", "new_space"]);
  });
  it("refuses a second Space added concurrently, without writing", async () => {
    const t = setup();
    const plan = planAreaMove(t.live(), "study", { floorId: null, space: { kind: "set", labelId: "new_space" } });
    if (!plan.ok) throw new Error(plan.error);
    expect(t.store.add(plan.input, t.live())).toBeNull();
    t.area.labels!.push("another_space");
    const result = await t.apply();
    expect(result.results[0]).toMatchObject({ ok: false, message: expect.stringContaining("Space membership") });
    expect(t.writes).toEqual([]);
  });
  it("refuses a removed source Space or renamed destination after review", async () => {
    for (const drift of ["removed", "renamed"] as const) {
      const t = setup();
      const plan = planAreaMove(t.live(), "study", { floorId: null, space: { kind: "set", labelId: "new_space" } });
      if (!plan.ok) throw new Error(plan.error);
      expect(t.store.add(plan.input, t.live())).toBeNull();
      if (drift === "removed") t.area.labels = ["keep"];
      else t.ha.labels.find((label) => label.label_id === "new_space")!.name = "Not a Space";
      expect((await t.apply()).results[0]).toMatchObject({ ok: false, message: expect.stringContaining("Space membership or label names") });
      expect(t.writes).toEqual([]);
    }
  });
  it("keeps unrelated labels added after review and hides the server baseline", async () => {
    const t = setup();
    t.ha.labels.push({ label_id: "extra", name: "Extra" });
    const plan = planAreaMove(t.live(), "study", { floorId: null, space: { kind: "set", labelId: "new_space" } });
    if (!plan.ok) throw new Error(plan.error);
    expect(t.store.add(plan.input, t.live())).toBeNull();
    expect(visiblePreview(t.store.list()[0]).before).not.toHaveProperty("areaSpaceSnapshot");
    t.area.labels!.push("extra");
    expect((await t.apply()).results[0].ok).toBe(true);
    expect(t.live().areas.study.labels).toEqual(["keep", "extra", "new_space"]);
  });
  it("changes the direct preview token when a Space label name changes", () => {
    const t = setup();
    const plan = planAreaMove(t.live(), "study", { floorId: null, space: { kind: "set", labelId: "new_space" } });
    if (!plan.ok) throw new Error(plan.error);
    const first = previewChanges([plan.input], t.live(), new Map(), false);
    if ("error" in first) throw new Error(first.error);
    t.ha.labels.find((label) => label.label_id === "new_space")!.name = "Space: Renamed";
    const second = previewChanges([plan.input], t.live(), new Map(), false);
    if ("error" in second) throw new Error(second.error);
    expect(previewVersion("1", first.changes)).not.toEqual(previewVersion("1", second.changes));
  });
  it("preserves unrelated labels added before submission and rejects a stale source assignment", () => {
    const t = setup();
    const plan = planAreaMove(t.live(), "study", { floorId: null, space: { kind: "set", labelId: "new_space" } });
    if (!plan.ok) throw new Error(plan.error);
    t.ha.labels.push({ label_id: "extra", name: "Extra" });
    t.area.labels!.push("extra");
    expect(t.store.add(plan.input, t.live())).toBeNull();
    expect(t.store.list()[0].after.labels).toEqual(["keep", "extra", "new_space"]);
    const stale = setup();
    const old = planAreaMove(stale.live(), "study", { floorId: null, space: { kind: "set", labelId: "new_space" } });
    if (!old.ok) throw new Error(old.error);
    stale.area.labels = ["another_space", "keep"];
    expect(stale.store.add(old.input, stale.live())).toContain("membership");
  });
  it("accepts a queued temporary Space label and resolves it on Apply", async () => {
    const t = setup();
    expect(t.store.add({ kind: "label", op: "create", fields: { name: "Space: Pending" } }, t.live())).toBeNull();
    const id = t.store.list()[0].targetId;
    const overlay = t.live();
    overlay.labels[id] = { id, name: "Space: Pending", color: null, icon: null, description: null };
    const plan = planAreaMove(overlay, "study", { floorId: null, space: { kind: "set", labelId: id } });
    if (!plan.ok) throw new Error(plan.error);
    expect(t.store.add(plan.input, t.live())).toBeNull();
    const result = await t.apply();
    expect(result.results.every((item) => item.ok)).toBe(true);
    expect(t.live().areas.study.labels).toContain("space_pending");
    expect(JSON.stringify(t.writes)).not.toContain("new:");
  });
  it("fences an explicit empty Space assignment even if only the floor initially changes", async () => {
    const t = setup();
    t.area.labels = ["keep"];
    const plan = planAreaMove(t.live(), "study", { floorId: null, space: { kind: "set", labelId: null } });
    if (!plan.ok) throw new Error(plan.error);
    expect(t.store.add(plan.input, t.live())).toBeNull();
    t.area.labels.push("another_space");
    expect((await t.apply()).results[0]).toMatchObject({ ok: false, message: expect.stringContaining("membership") });
    expect(t.writes).toEqual([]);
  });
  it("retargets a private temporary label snapshot after a partial Apply", () => {
    const t = setup();
    expect(t.store.add({ kind: "label", op: "create", fields: { name: "Space: Pending" } }, t.live())).toBeNull();
    const temporary = t.store.list()[0];
    const overlay = t.live();
    overlay.labels[temporary.targetId] = { id: temporary.targetId, name: "Space: Pending", color: null, icon: null, description: null };
    const plan = planAreaMove(overlay, "study", { floorId: null, space: { kind: "set", labelId: temporary.targetId } });
    if (!plan.ok) throw new Error(plan.error);
    expect(t.store.add(plan.input, t.live())).toBeNull();
    t.store.settle({
      results: [{ changeId: temporary.id, ok: true, message: "Applied" }],
      realIds: new Map([[temporary.targetId, "space_pending"]]),
      retargets: [],
      renamed: new Map(),
    });
    const pending = t.store.list()[0];
    expect(pending.before.areaSpaceSnapshot).toMatchObject({ names: { space_pending: "Space: Pending" } });
    expect(JSON.stringify(pending)).not.toContain(temporary.targetId);
  });
});
