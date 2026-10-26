import type { DatabaseSync } from "node:sqlite";

import type { AiModelUsage, AiProviderId, AiUsage, LedgerJob } from "../../shared/ai.ts";

// What each AI call used and cost, one row per call in /data/taxis.db. The
// month's total is what the spending cap is checked against. Rows are kept for
// two years and hold no prompt or answer text, only counts.

const KEEP_DAYS = 730;

export type LedgerRow = {
  job: LedgerJob;
  provider: AiProviderId;
  model: string;
  inputTokens: number;
  outputTokens: number;
  // Null when the model has no known price.
  costUsd: number | null;
};

// The calendar month (UTC) the instant falls in: its label and its bounds as
// ISO strings, which sort the same as the instants.
export function monthOf(now: Date): { label: string; from: string; to: string } {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  return {
    label: `${y}-${String(m + 1).padStart(2, "0")}`,
    from: new Date(Date.UTC(y, m, 1)).toISOString(),
    to: new Date(Date.UTC(y, m + 1, 1)).toISOString(),
  };
}

export function aiLedger(db: DatabaseSync, clock: () => Date = () => new Date()) {
  const insert = db.prepare("INSERT INTO ai_usage (at, job, provider, model, input_tokens, output_tokens, cost_usd) VALUES (?, ?, ?, ?, ?, ?, ?)");
  const prune = db.prepare("DELETE FROM ai_usage WHERE at < ?");
  const spent = db.prepare("SELECT COALESCE(SUM(cost_usd), 0) AS total FROM ai_usage WHERE at >= ? AND at < ?");
  const byModel = db.prepare(
    `SELECT provider, model, COUNT(*) AS calls, SUM(cost_usd IS NULL) AS unpriced,
            SUM(input_tokens) AS input, SUM(output_tokens) AS output, COALESCE(SUM(cost_usd), 0) AS cost
       FROM ai_usage WHERE at >= ? AND at < ? GROUP BY provider, model ORDER BY cost DESC, calls DESC`,
  );

  return {
    record(row: LedgerRow): void {
      const now = clock();
      insert.run(now.toISOString(), row.job, row.provider, row.model, row.inputTokens, row.outputTokens, row.costUsd);
      prune.run(new Date(now.getTime() - KEEP_DAYS * 86_400_000).toISOString());
    },
    // Dollars spent this month on calls that have a price.
    spentThisMonth(): number {
      const { from, to } = monthOf(clock());
      return Number((spent.get(from, to) as { total: number }).total);
    },
    monthToDate(capUsd: number): AiUsage {
      const { label, from, to } = monthOf(clock());
      const rows = byModel.all(from, to) as { provider: AiProviderId; model: string; calls: number; unpriced: number; input: number; output: number; cost: number }[];
      const models: AiModelUsage[] = rows.map((r) => ({
        provider: r.provider,
        model: r.model,
        calls: Number(r.calls),
        unpricedCalls: Number(r.unpriced),
        inputTokens: Number(r.input),
        outputTokens: Number(r.output),
        costUsd: Number(r.cost),
      }));
      const sum = (pick: (m: AiModelUsage) => number) => models.reduce((t, m) => t + pick(m), 0);
      return {
        month: label,
        capUsd,
        spentUsd: sum((m) => m.costUsd),
        calls: sum((m) => m.calls),
        unpricedCalls: sum((m) => m.unpricedCalls),
        inputTokens: sum((m) => m.inputTokens),
        outputTokens: sum((m) => m.outputTokens),
        byModel: models,
      };
    },
  };
}

export type AiLedger = ReturnType<typeof aiLedger>;
