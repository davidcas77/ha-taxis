import type { DatabaseSync } from "node:sqlite";
import type { ApplyResult, Change, ApplyRun, RepairItem } from "../../shared/types.ts";

export function applyHistory(db: DatabaseSync) {
  const now = () => new Date().toISOString();
  // A running row persisted before a crash is evidence of an interrupted run,
  // not permission to replay HA writes automatically.
  const interrupted = db.prepare("SELECT id FROM apply_runs WHERE status = 'running'").all() as { id: number }[];
  for (const row of interrupted) {
    db.prepare("UPDATE apply_runs SET status='interrupted', finished_at=?, error=? WHERE id=?").run(now(), "The app stopped during Apply. Check Home Assistant before retrying.", row.id);
    db.prepare("INSERT INTO repairs(run_id,message,created_at) VALUES(?,?,?)").run(row.id, "Apply was interrupted. Check Home Assistant and the remaining changes before retrying; no writes were replayed automatically.", now());
  }
  const repair = (runId: number, changeId: number | null, message: string) => {
    const existing = db.prepare("SELECT id FROM repairs WHERE change_id IS ? AND message=? AND acknowledged_at IS NULL").get(changeId, message);
    if (!existing) db.prepare("INSERT INTO repairs(run_id,change_id,message,created_at) VALUES(?,?,?,?)").run(runId, changeId, message, now());
  };
  return {
    begin(pending: Change[]): number {
      return Number(db.prepare("INSERT INTO apply_runs(started_at,status,pending) VALUES(?,'running',?)").run(now(), JSON.stringify(pending)).lastInsertRowid);
    },
    backup(id: number, backup: ApplyResult["backup"]) { db.prepare("UPDATE apply_runs SET backup=? WHERE id=?").run(JSON.stringify(backup), id); },
    finish(id: number, results: ApplyResult["results"], error: string | null = null, needsRepair = true) {
      const warning = results.some(r => r.status === "unverified" || r.status === "partial" || (r.details ?? []).some(d => /^(Needs a hand:|Not updated:)/.test(d)) || /^Created.*(but|not re-read)/.test(r.message));
      const status = error ? "failed" : results.every(r => r.ok) && !warning ? "completed" : results.some(r => r.ok) ? "partial" : "failed";
      db.prepare("UPDATE apply_runs SET finished_at=?,status=?,results=?,error=? WHERE id=?").run(now(), status, JSON.stringify(results), error, id);
      if (error && needsRepair) repair(id, null, error);
      for (const result of results) {
        if (!result.ok || /^Created.*(but|not re-read)/.test(result.message)) repair(id, result.changeId, result.message);
        for (const detail of result.details ?? []) if (/^(Needs a hand:|Not updated:)/.test(detail)) repair(id, result.changeId, detail);
      }
    },
    runs(limit = 50): ApplyRun[] {
      return (db.prepare("SELECT * FROM apply_runs ORDER BY id DESC LIMIT ?").all(Math.max(1, Math.min(200, limit))) as Record<string, unknown>[]).map(r => ({ id: Number(r.id), changes: JSON.parse(String(r.pending)), startedAt: String(r.started_at), finishedAt: r.finished_at as string | null, status: r.status as ApplyRun["status"], backup: r.backup ? JSON.parse(String(r.backup)) : null, results: JSON.parse(String(r.results)), error: r.error as string | null }));
    },
    repairs(): RepairItem[] {
      return (db.prepare("SELECT * FROM repairs WHERE acknowledged_at IS NULL ORDER BY id DESC").all() as Record<string, unknown>[]).map(r => ({ id: Number(r.id), runId: Number(r.run_id), changeId: r.change_id === null ? null : Number(r.change_id), message: String(r.message), createdAt: String(r.created_at), acknowledgedAt: r.acknowledged_at as string | null }));
    },
    acknowledge(id: number): boolean {
      return Number(db.prepare("UPDATE repairs SET acknowledged_at=? WHERE id=? AND acknowledged_at IS NULL").run(now(), id).changes) > 0;
    },
  };
}
