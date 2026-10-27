import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { openStore } from "../db.ts";
import { fakeHa } from "../references/fake-ha.ts";
import { buildHierarchy } from "../model/hierarchy.ts";
import { applyAll } from "./all.ts";
import { changeStore } from "./store.ts";
import { applyHistory } from "./history.ts";

it("retargets a pending helper after Apply one and preserves it through restart", async () => {
  const dir = mkdtempSync(join(tmpdir(), "taxis-recovery-")); let disk = openStore(dir);
  try {
    const fake = fakeHa(); let changes = changeStore(disk.db);
    const live = () => buildHierarchy(structuredClone(fake.home), "now");
    expect(changes.add({ kind: "helper", op: "create", fields: { helper: "group", group_type: "light", name: "Study all lights", entity_id: "light.study_all", entities: ["light.desk"], area_id: "study" } }, live())).toBeNull();
    expect(changes.add({ kind: "entity", op: "update", targetId: "light.desk", fields: { new_entity_id: "light.study_desk" } }, live())).toBeNull();
    const rename = changes.list().filter(c => c.kind === "entity");
    const io = { ha: fake.ha, rest: fake.api, readFresh: fake.readFresh, sleep: async () => {} };
    const result = await applyAll(rename, io);
    changes.settle(result);
    expect(changes.list()[0].after.entities).toEqual(["light.study_desk"]);
    disk.close(); disk = openStore(dir); changes = changeStore(disk.db);
    expect((await applyAll(changes.list(), io)).results.every(r => r.ok)).toBe(true);
  } finally { disk.close(); rmSync(dir, { recursive: true, force: true }); }
});

it("queue cleanup rolls back with its journal and records interrupted runs after restart", () => {
  const dir = mkdtempSync(join(tmpdir(), "taxis-journal-")); let disk = openStore(dir);
  try {
    const changes = changeStore(disk.db); const history = applyHistory(disk.db);
    expect(changes.add({ kind: "entity", op: "update", targetId: "light.desk", fields: { name: "Desk" } }, buildHierarchy(fakeHa().home, "now"))).toBeNull();
    const pending = changes.list(); const id = history.begin(pending);
    history.backup(id, { made: true, name: "Before edits", slug: "backup-1" });
    expect(() => changes.settle({ results: [{ changeId: pending[0].id, ok: true, message: "Applied." }], realIds: new Map(), retargets: [], renamed: new Map() }, () => { throw new Error("disk failure"); })).toThrow("disk failure");
    expect(changes.list()).toHaveLength(1);
    disk.close(); disk = openStore(dir);
    const restored = applyHistory(disk.db);
    expect(restored.runs()[0].changes).toEqual(pending);
    expect(restored.runs()[0]).toMatchObject({ status: "interrupted", backup: { slug: "backup-1" } });
    expect(restored.repairs()).toHaveLength(1);
    const repair = restored.repairs()[0]; expect(restored.acknowledge(repair.id)).toBe(true); expect(restored.repairs()).toEqual([]);
    disk.close(); disk = openStore(dir); expect(applyHistory(disk.db).repairs()).toEqual([]);
  } finally { disk.close(); rmSync(dir, { recursive: true, force: true }); }
});

it("retains partial Apply reference repair details after pending changes are removed", () => {
  const dir = mkdtempSync(join(tmpdir(), "taxis-repairs-")); const disk = openStore(dir);
  try {
    const history = applyHistory(disk.db); const id = history.begin([]);
    history.finish(id, [{ changeId: 1, ok: true, status: "partial", message: "Applied.", details: ["Not updated: dashboard changed since it was read.", "Needs a hand: YAML helper"] }]);
    expect(history.runs()[0].status).toBe("partial"); expect(history.repairs()).toHaveLength(2);
    history.finish(id, [{ changeId: 1, ok: true, status: "partial", message: "Applied.", details: ["Needs a hand: YAML helper"] }]);
    expect(history.repairs()).toHaveLength(2);
  } finally { disk.close(); rmSync(dir, { recursive: true, force: true }); }
});


it("does not create repair tasks for preflight failures that sent no changes", () => {
  const dir = mkdtempSync(join(tmpdir(), "taxis-preflight-journal-")); const disk = openStore(dir);
  try {
    const history = applyHistory(disk.db); const id = history.begin([]);
    history.finish(id, [], "Backup was not confirmed; nothing was changed.", false);
    expect(history.runs()[0]).toMatchObject({ status: "failed", error: "Backup was not confirmed; nothing was changed." });
    expect(history.repairs()).toEqual([]);
  } finally { disk.close(); rmSync(dir, { recursive: true, force: true }); }
});
