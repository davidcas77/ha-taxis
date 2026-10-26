import { afterEach, describe, expect, it } from "vitest";

import { aiLedger, monthOf } from "./ledger.ts";
import { testStore } from "./test-store.ts";

const closers: (() => void)[] = [];
afterEach(() => {
  while (closers.length) closers.pop()!();
});

function ledgerAt(initial: string) {
  const t = testStore();
  closers.push(t.close);
  let now = new Date(initial);
  const ledger = aiLedger(t.store.db, () => now);
  return { ledger, db: t.store.db, setNow: (iso: string) => (now = new Date(iso)) };
}

const row = (over: Partial<Parameters<ReturnType<typeof aiLedger>["record"]>[0]> = {}) => ({
  job: "quick" as const,
  provider: "anthropic" as const,
  model: "claude-haiku-5-5",
  inputTokens: 1000,
  outputTokens: 200,
  costUsd: 0.5 as number | null,
  ...over,
});

describe("monthOf", () => {
  it("is the calendar month in UTC", () => {
    expect(monthOf(new Date("2026-10-31T23:59:59Z"))).toEqual({ label: "2026-10", from: "2026-10-01T00:00:00.000Z", to: "2026-11-01T00:00:00.000Z" });
    expect(monthOf(new Date("2026-12-15T00:00:00Z"))).toMatchObject({ label: "2026-12", to: "2027-01-01T00:00:00.000Z" });
  });
});

describe("aiLedger", () => {
  it("starts at zero", () => {
    const { ledger } = ledgerAt("2026-10-26T12:00:00Z");
    expect(ledger.spentThisMonth()).toBe(0);
    expect(ledger.monthToDate(5)).toEqual({ month: "2026-10", capUsd: 5, spentUsd: 0, calls: 0, unpricedCalls: 0, inputTokens: 0, outputTokens: 0, byModel: [] });
  });

  it("adds up this month's priced calls and counts the unpriced ones apart", () => {
    const { ledger } = ledgerAt("2026-10-26T12:00:00Z");
    ledger.record(row({ costUsd: 0.25 }));
    ledger.record(row({ costUsd: 0.5, job: "ask", model: "claude-sonnet-5-5" }));
    ledger.record(row({ provider: "openai-compatible", model: "qwen2.5:7b", costUsd: null, inputTokens: 300, outputTokens: 40 }));
    expect(ledger.spentThisMonth()).toBeCloseTo(0.75);
    const usage = ledger.monthToDate(5);
    expect(usage).toMatchObject({ spentUsd: 0.75, calls: 3, unpricedCalls: 1, inputTokens: 2300, outputTokens: 440 });
    expect(usage.byModel.map((m) => [m.model, m.calls, m.unpricedCalls])).toEqual([
      ["claude-sonnet-5-5", 1, 0],
      ["claude-haiku-5-5", 1, 0],
      ["qwen2.5:7b", 1, 1],
    ]);
  });

  it("starts a new month at zero and keeps the old rows", () => {
    const { ledger, db, setNow } = ledgerAt("2026-10-31T23:59:00Z");
    ledger.record(row({ costUsd: 4.99 }));
    expect(ledger.spentThisMonth()).toBeCloseTo(4.99);
    setNow("2026-11-01T00:00:00Z");
    expect(ledger.spentThisMonth()).toBe(0);
    expect(ledger.monthToDate(5).calls).toBe(0);
    expect((db.prepare("SELECT COUNT(*) AS n FROM ai_usage").get() as { n: number }).n).toBe(1);
  });

  it("stores the time, job, provider and model of each call, and no text", () => {
    const { ledger, db } = ledgerAt("2026-10-26T12:00:00Z");
    ledger.record(row({ job: "test" }));
    const stored = db.prepare("SELECT * FROM ai_usage").get() as Record<string, unknown>;
    expect(stored).toMatchObject({ at: "2026-10-26T12:00:00.000Z", job: "test", provider: "anthropic", model: "claude-haiku-5-5", input_tokens: 1000, output_tokens: 200, cost_usd: 0.5 });
    expect(Object.keys(stored).sort()).toEqual(["at", "cost_usd", "id", "input_tokens", "job", "model", "output_tokens", "provider"]);
  });

  it("forgets rows older than two years", () => {
    const { ledger, db, setNow } = ledgerAt("2024-01-10T00:00:00Z");
    ledger.record(row());
    setNow("2026-10-26T12:00:00Z");
    ledger.record(row());
    expect((db.prepare("SELECT COUNT(*) AS n FROM ai_usage").get() as { n: number }).n).toBe(1);
  });
});
