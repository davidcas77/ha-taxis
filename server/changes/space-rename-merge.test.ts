import { DatabaseSync } from "node:sqlite";
import { expect, it } from "vitest";
import { buildMockRegistry } from "../../scripts/mock-ha-core.ts";
import { spaceFloorDescription } from "../../shared/spaces.ts";
import { buildHierarchy } from "../model/hierarchy.ts";
import { changeStore } from "./store.ts";

it("merges a Space rename into its pending creation without changing its identity or description", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(
    "CREATE TABLE changes (id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, op TEXT NOT NULL, target_id TEXT NOT NULL, scope TEXT, before TEXT NOT NULL, after TEXT NOT NULL, created_at TEXT NOT NULL)",
  );
  const store = changeStore(db);
  const h = buildHierarchy(buildMockRegistry(), "now");
  const description = spaceFloorDescription("ground");
  expect(store.add({ kind: "label", op: "create", fields: { name: "Space: Original", description } }, h)).toBeNull();
  const created = store.list()[0];
  expect(store.add({ kind: "label", op: "update", targetId: created.targetId, fields: { name: "Space: Renamed" } }, h)).toBeNull();
  expect(store.list()).toHaveLength(1);
  expect(store.list()[0]).toMatchObject({
    id: created.id,
    kind: "label",
    op: "create",
    targetId: created.targetId,
    after: { name: "Space: Renamed", description },
  });
  db.close();
});
