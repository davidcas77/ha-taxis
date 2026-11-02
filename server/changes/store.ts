import { mapInputEntities } from "../../shared/blueprints.ts";
import type { Outcome, Retarget } from "./apply.ts";
import { rewrite } from "../references/rewrite.ts";
import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

import { KEYED_KINDS, planMerge, refsOf, stripRef, tempId } from "../../shared/changes.ts";
import { spaceFloorDescription, spaceFloorFromDescription } from "../../shared/spaces.ts";
import type { CategoryScope, Change, ChangeInput, ChangeKind, ChangeOp, Hierarchy } from "../../shared/types.ts";
import { spaceBaseline, spaceChangeGuard, type SpaceGuardContext } from "./space-safety.ts";
import { areaLabelConflict, areaMoveLabels, areaSpaceSnapshot, areaSpaceSnapshotError, type AreaSpaceSnapshot } from "./area-label-safety.ts";

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

// Internal config baselines are needed for conflict checks, but are not UI data.
export function publicChange(change: Change): Change {
  const {
    configSnapshot: _configSnapshot,
    preserveConfig: _preserveConfig,
    spaceSnapshot: _spaceSnapshot,
    areaSpaceSnapshot: _areaSpaceSnapshot,
    ...before
  } = change.before;
  return { ...change, before };
}

// Puts `real` wherever an id field of `after` holds `temp`.
function swapRef(after: Record<string, unknown>, temp: string, real: string): Record<string, unknown> {
  const out = { ...after };
  if (out.area_id === temp) out.area_id = real;
  if (out.floor_id === temp) out.floor_id = real;
  if (spaceFloorFromDescription(out.description) === temp) out.description = spaceFloorDescription(real);
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
    const removedTemps = current.filter((c) => gone.has(c.id) && c.op === "create" && !KEYED_KINDS.has(c.kind)).map((c) => c.targetId);
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

    settle(outcome: { results: Outcome[]; realIds: Map<string, string>; retargets: Retarget[]; renamed: Map<string, string> }, record?: () => void): void {
      db.exec("BEGIN IMMEDIATE");
      try {
        for (const result of outcome.results) if (result.ok) remove.run(result.changeId);
        for (const r of outcome.retargets) {
          setTarget.run(r.targetId, r.changeId);
          replace.run(JSON.stringify(r.before), JSON.stringify(r.after), r.changeId);
        }
        for (const c of list()) {
          let target = c.targetId;
          let after = c.after;
          let before = c.before;
          for (const [temp, real] of outcome.realIds) {
            if (target === temp) target = real;
            after = swapRef(after, temp, real);
            const snapshot = before.areaSpaceSnapshot as AreaSpaceSnapshot | undefined;
            if (snapshot && (snapshot.assigned.includes(temp) || Object.hasOwn(snapshot.names, temp))) {
              const names = { ...snapshot.names };
              if (Object.hasOwn(names, temp)) {
                names[real] = names[temp];
                delete names[temp];
              }
              before = { ...before, areaSpaceSnapshot: { assigned: snapshot.assigned.map((id) => (id === temp ? real : id)).sort(), names } };
            }
          }
          const current = (id: string) => outcome.renamed.get(id) ?? id;
          if (c.kind === "entity" || (c.kind === "helper" && c.op === "update")) target = current(target);
          const remap = (fields: Record<string, unknown>) => {
            const next = { ...fields };
            if ("configSnapshot" in next && outcome.renamed.size) next.configSnapshot = rewrite(next.configSnapshot, outcome.renamed).value;
            for (const key of ["temperature_entity_id", "humidity_entity_id"]) if (typeof next[key] === "string") next[key] = current(next[key]);
            if (c.kind === "helper" && Array.isArray(next.entities)) next.entities = next.entities.map((e) => (typeof e === "string" ? current(e) : e));
            if ((c.kind === "automation" || c.kind === "script") && next.use_blueprint && typeof next.use_blueprint === "object") {
              const use = next.use_blueprint as { path: string; input: Record<string, unknown> };
              next.use_blueprint = { ...use, input: mapInputEntities(use.path, use.input, current) };
            }
            return next;
          };
          after = remap(after);
          before = remap(before);
          setTarget.run(target, c.id);
          replace.run(JSON.stringify(before), JSON.stringify(after), c.id);
        }
        record?.();
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },

    /** Folds an edit into the list. Returns an error message, or null when stored. */
    add(input: ChangeInput, h: Hierarchy, configBefore?: unknown, preserveConfig = false, context?: SpaceGuardContext): string | null {
      const existing = list();
      if (input.areaMove && input.kind === "area" && input.targetId) {
        const labels = areaMoveLabels(h, existing, input.targetId, input.areaMove.spaceLabelId, input.areaMove.sourceSpaces);
        if (typeof labels === "string") return labels;
        input = { ...input, fields: { ...input.fields, labels } };
      }
      const previous = existing.find((change) => change.kind === "area" && change.targetId === input.targetId && change.op === "update");
      const oldAreaSnapshot = previous?.before.areaSpaceSnapshot as AreaSpaceSnapshot | undefined;
      if (input.kind === "area" && oldAreaSnapshot && input.targetId) {
        const error = areaSpaceSnapshotError(h, existing, input.targetId, oldAreaSnapshot);
        if (error) return error;
      }
      if (input.kind === "area" && Array.isArray(input.fields?.labels)) {
        const conflict = areaLabelConflict(h, existing, input.fields.labels as string[]);
        if (conflict) return conflict;
      }
      if (!input.space && ["area", "device", "entity", "label"].includes(input.kind) && existing.some((change) => change.before.spaceSnapshot))
        return "Apply or discard pending Space changes before changing areas, devices, entities or labels.";
      const spaceError = spaceChangeGuard(input, h, existing, context);
      if (spaceError) return spaceError;
      const plan = planMerge(existing, input, h);
      if (input.kind === "helper" && input.op === "update" && input.fields && "duration" in input.fields && input.targetId) {
        const previousTimer = existing.find(
          (change) => change.kind === "helper" && change.op === "update" && change.targetId === input.targetId && "duration" in change.after,
        );
        // Keep the original baseline when another edit is folded into a queued
        // change. Old entries without one must be removed and reviewed again.
        const duration = previousTimer ? previousTimer.before.duration : h.entities[input.targetId]?.timerDuration;
        if (plan.action === "insert") plan.change.before = { ...plan.change.before, ...(typeof duration === "number" ? { duration } : {}) };
        else if (plan.action === "replace") plan.before = { ...plan.before, ...(typeof duration === "number" ? { duration } : {}) };
      }
      if (input.kind === "area" && input.op === "update" && input.targetId) {
        const after = plan.action === "insert" ? plan.change.after : plan.action === "replace" ? plan.after : null;
        const before = plan.action === "insert" ? plan.change.before : plan.action === "replace" ? plan.before : null;
        const desired = input.areaMove && Array.isArray(input.fields?.labels) ? input.fields.labels : after?.labels;
        if (before && after && Array.isArray(desired)) {
          const snapshot = areaSpaceSnapshot(h, existing, input.targetId, desired as string[], !!input.areaMove);
          if (snapshot || oldAreaSnapshot) before.areaSpaceSnapshot = snapshot ?? oldAreaSnapshot;
        } else if (before && oldAreaSnapshot) before.areaSpaceSnapshot = oldAreaSnapshot;
      }
      if (input.space) {
        const baseline = spaceBaseline(input.space, h, existing, context);
        if (typeof baseline === "string") return baseline;
        if (plan.action === "insert") plan.change.before = { ...plan.change.before, spaceSnapshot: baseline };
        else if (plan.action === "replace") plan.before = { ...plan.before, spaceSnapshot: baseline };
      }
      if (configBefore !== undefined && (input.kind === "automation" || input.kind === "script") && !input.fields?.button_map) {
        const baseline = { configSnapshot: configBefore, ...(preserveConfig ? { preserveConfig: true } : {}) };
        if (plan.action === "insert") plan.change.before = { ...plan.change.before, ...baseline };
        else if (plan.action === "replace") plan.before = { ...plan.before, ...baseline };
      }
      const now = new Date().toISOString();
      const insertChange = (c: Omit<Change, "id" | "createdAt">) => {
        const r = insert.run(c.kind, c.op, c.targetId, c.scope, JSON.stringify(c.before), JSON.stringify(c.after), now);
        const id = Number(r.lastInsertRowid);
        // A creation gets a temporary id other changes can point at.
        // A helper, blueprint or automation is keyed by what it will be (its
        // entity id, path or id), so it keeps that.
        if (c.op === "create" && !KEYED_KINDS.has(c.kind)) setTarget.run(tempId(c.kind, id), id);
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

    /**
     * Folds several edits in, all or nothing: if any one is refused, none of them
     * is kept. Each is folded into the list the ones before it made, exactly as
     * if they had been added one by one. Returns null when all are stored, or
     * the position (0-based) and message of the one that was refused.
     */
    addMany(
      inputs: ChangeInput[],
      h: Hierarchy,
      configs?: Map<number, unknown>,
      beforeCommit?: () => void,
      preserveConfig = false,
      context?: SpaceGuardContext,
    ): { index: number; error: string } | null {
      db.exec("BEGIN IMMEDIATE");
      try {
        for (const [index, input] of inputs.entries()) {
          const refused = this.add(input, h, configs?.get(index), preserveConfig, context);
          if (refused !== null) {
            db.exec("ROLLBACK");
            return { index, error: refused };
          }
        }
        beforeCommit?.();
        db.exec("COMMIT");
        return null;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
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

    /**
     * A rename took but the rest of its change didn't: the change goes on as an
     * update of `newTargetId` with what is left. (While a rename is pending,
     * edits made under the new id are folded into that same change, so no
     * other change can already target `newTargetId`.)
     */
    retarget(changeId: number, newTargetId: string, after: Record<string, unknown>, before: Record<string, unknown>): void {
      setTarget.run(newTargetId, changeId);
      replace.run(JSON.stringify(before), JSON.stringify(after), changeId);
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
