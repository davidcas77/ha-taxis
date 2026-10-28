import type { DatabaseSync } from "node:sqlite";
import { monthOf } from "../ai/ledger.ts";
import type { JevUsage } from "../../shared/jev.ts";

export function jevLedger(db: DatabaseSync, clock: () => Date = () => new Date()) {
  const reserve = db.prepare(`INSERT INTO jev_usage(at, job, model, status)
    SELECT ?, ?, ?, 'pending' WHERE (SELECT COUNT(*) FROM jev_usage WHERE at >= ? AND at < ?) < ? RETURNING id`);
  const finish = db.prepare(
    "UPDATE jev_usage SET status = ?, input_tokens = ?, output_tokens = ?, estimated_usd = ? WHERE id = ?",
  );
  const prune = db.prepare("DELETE FROM jev_usage WHERE at < ?");
  const usage = db.prepare(`SELECT COUNT(*) AS attempts, SUM(status = 'completed') AS completed,
    COALESCE(SUM(input_tokens), 0) AS input, COALESCE(SUM(output_tokens), 0) AS output,
    COALESCE(SUM(estimated_usd), 0) AS cost, COALESCE(SUM(input_tokens IS NULL), 0) AS unknown
    FROM jev_usage WHERE at >= ? AND at < ?`);
  return {
    reserve(job: "test" | "room-notes", model: string, limit: number): number | null {
      const now = clock();
      const { from, to } = monthOf(now);
      const row = reserve.get(now.toISOString(), job, model, from, to, limit) as { id: number } | undefined;
      prune.run(new Date(now.getTime() - 730 * 86400000).toISOString());
      return row ? Number(row.id) : null;
    },
    finish(id: number, completed: boolean, tokens?: { input: number; output: number; estimatedUsd: number }) {
      finish.run(
        completed ? "completed" : "failed",
        tokens?.input ?? null,
        tokens?.output ?? null,
        tokens?.estimatedUsd ?? null,
        id,
      );
    },
    monthToDate(limit: number): JevUsage {
      const { from, to, label } = monthOf(clock());
      const r = usage.get(from, to) as {
        attempts: number;
        completed: number;
        input: number;
        output: number;
        cost: number;
        unknown: number;
      };
      return {
        month: label,
        limit,
        attempts: Number(r.attempts),
        completed: Number(r.completed ?? 0),
        inputTokens: Number(r.input),
        outputTokens: Number(r.output),
        estimatedUsd: Number(r.cost),
        unknownUsage: Number(r.unknown),
      };
    },
  };
}
export type JevLedger = ReturnType<typeof jevLedger>;
