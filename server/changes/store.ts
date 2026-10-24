import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

import { planMerge, refsOf, stripRef, tempId } from "../../shared/changes.ts";
import type { CategoryScope, Change, ChangeInput, ChangeKind, ChangeOp, Hierarchy } from "../../shared/types.ts";

// The change list, kept in SQLite so it survives restarts and updates of the
// app. Nothing here talks to Home Assistant.

type Row = {
  id: number;
  kind: ChangeKind;
  op: ChangeOp;
  target_id: string;
  scope: CategoryScope | null;
  before: string;
  after: string;
  created_at: string;
};

const toChange = (r: Row): Change => ({
  id: r.id,
  kind: r.kind,
  op: r.op,
  targetId: r.target_id,
  scope: r.scope,
  before: JSON.parse(r.before),
  after: JSON.parse(r.after),
  createdAt: r.created_at,
});

export type ChangeStore = ReturnType<typeof changeStore>;

// Puts `real` wherever an id field of `after` holds `temp`.
function swapRef(after: Record<string, unknown>, temp: string, real: string): Record<string, unknown> {
  const out = { ...after };
  if (out.area_id === temp) out.area_id = real;
  if (out.floor_id === temp) out.floor_id = real;
  if (Array.isArray(out.labels)) out.labels = out.labels.map((l) => (l === temp ? real : l));
  if (out.categories && typeof out.categories === "object") {
    out.categories = Object.fromEntries(Object.entries(out.categories).map(([s, c]) => [s, c === temp ? real : c]));
  }
  return out;
}

export function changeStore(db: DatabaseSync) {
  const all = db.prepare("SELECT * FROM changes ORDER BY id");
  const insert = db.prepare("INSERT INTO changes (kind, op, target_id, scope, before, after, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)");
  const setTarget = db.prepare("UPDATE changes SET target_id = ? WHERE id = ?");
  const setAfter = db.prepare("UPDATE changes SET after = ? WHERE id = ?");
  const replace = db.prepare("UPDATE changes SET before = ?, after = ? WHERE id = ?");
  const remove = db.prepare("DELETE FROM changes WHERE id = ?");
  const clear = db.prepare("DELETE FROM changes");

  const list = (): Change[] => (all.all() as Row[]).map(toChange);

  // Removing a creation also takes its id out of the changes that point at it
  // (a device moved into a new area keeps its rename, loses the move). An update
  // left with nothing to change is removed.
  const removeWithDependents = (ids: number[]) => {
    const current = list();
    const gone = new Set(ids);
    for (const c of current) if (gone.has(c.id)) remove.run(c.id);
    const removedTemps = current.filter((c) => gone.has(c.id) && c.op === "create").map((c) => c.targetId);
    for (const temp of removedTemps) {
      for (const other of list()) {
        if (!refsOf(other).some((r) => r.id === temp)) continue;
        const after = stripRef(other, temp);
        if (other.op === "update" && Object.keys(after).length === 0) remove.run(other.id);
        else setAfter.run(JSON.stringify(after), other.id);
      }
    }
  };

  return {
    list,

    /** A fingerprint of the whole list as it is now. */
    version(): string {
      const content = list().map((c) => [c.id, c.kind, c.op, c.targetId, c.scope, c.before, c.after]);
      return createHash("sha256").update(JSON.stringify(content)).digest("hex").slice(0, 16);
    },

    /** Folds an edit into the list. Returns an error message, or null when stored. */
    add(input: ChangeInput, h: Hierarchy): string | null {
      const plan = planMerge(list(), input, h);
      const now = new Date().toISOString();
      const insertChange = (c: Omit<Change, "id" | "createdAt">) => {
        const r = insert.run(c.kind, c.op, c.targetId, c.scope, JSON.stringify(c.before), JSON.stringify(c.after), now);
        const id = Number(r.lastInsertRowid);
        // A creation gets a temporary id other changes can point at.
        if (c.op === "create") setTarget.run(tempId(c.kind, id), id);
      };
      switch (plan.action) {
        case "none":
          return plan.reason;
        case "insert":
          insertChange(plan.change);
          return null;
        case "replace":
          replace.run(JSON.stringify(plan.before), JSON.stringify(plan.after), plan.id);
          return null;
        case "remove":
          removeWithDependents(plan.ids);
          return null;
        case "removeThenInsert":
          removeWithDependents(plan.ids);
          insertChange(plan.change);
          return null;
      }
    },

    /** The user removes a change from the list. */
    remove(id: number): void {
      removeWithDependents([id]);
    },

    /** After Apply: a change that took is done. Nothing else is touched. */
    done(id: number): void {
      remove.run(id);
    },

    /** After Apply created an item: point the remaining changes at its real id. */
    swapTempId(temp: string, real: string): void {
      for (const c of list()) {
        if (c.targetId === temp) setTarget.run(real, c.id);
        if (refsOf(c).some((r) => r.id === temp)) setAfter.run(JSON.stringify(swapRef(c.after, temp, real)), c.id);
      }
    },

    clear(): void {
      clear.run();
    },
  };
}
