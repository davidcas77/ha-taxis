import { describe, expect, it } from "vitest";

import { ANTHROPIC_DEFAULT_MODELS, ANTHROPIC_PRICES, DEFAULT_AI, costUsd, defaultModels, formatUsd, priceFor } from "./ai.ts";

describe("priceFor", () => {
  const none = { prices: {} };

  it("knows the Anthropic prices, including snapshot and latest ids", () => {
    expect(priceFor(none, "anthropic", "claude-sonnet-5-5")?.price).toEqual({ inputPerMTok: 2, outputPerMTok: 10 });
    expect(priceFor(none, "anthropic", "claude-sonnet-5")?.price).toEqual({ inputPerMTok: 2, outputPerMTok: 10 });
    expect(priceFor(none, "anthropic", "claude-haiku-4-5-20251001")?.price).toEqual({ inputPerMTok: 1, outputPerMTok: 5 });
    expect(priceFor(none, "anthropic", "claude-opus-5-5-latest")?.price).toEqual({ inputPerMTok: 4, outputPerMTok: 20 });
  });

  it("doesn't mistake one model for a longer name that starts like it", () => {
    expect(priceFor(none, "anthropic", "claude-sonnet-5-6")).toBeNull();
    expect(priceFor(none, "anthropic", "claude-haiku-5-5-mini")).toBeNull();
    expect(priceFor(none, "anthropic", "toString")).toBeNull();
  });

  it("charges Haiku 5.5's higher rate above 100K prompt tokens", () => {
    expect(priceFor(none, "anthropic", "claude-haiku-5-5", 100_000)?.price.inputPerMTok).toBe(0.1);
    expect(priceFor(none, "anthropic", "claude-haiku-5-5", 100_001)?.price).toEqual({ inputPerMTok: 0.5, outputPerMTok: 2.5 });
  });

  it("has no built-in price for other providers, but takes the user's, which win", () => {
    expect(priceFor(none, "openai-compatible", "claude-haiku-5-5")).toBeNull();
    expect(priceFor(none, "openai-compatible", "gpt-5")).toBeNull();
    const mine = { prices: { "gpt-5": { inputPerMTok: 1.25, outputPerMTok: 10 }, "claude-haiku-5-5": { inputPerMTok: 9, outputPerMTok: 9 } } };
    expect(priceFor(mine, "openai-compatible", "gpt-5")).toEqual({ price: { inputPerMTok: 1.25, outputPerMTok: 10 }, source: "settings" });
    expect(priceFor(mine, "anthropic", "claude-haiku-5-5")).toMatchObject({ source: "settings", price: { inputPerMTok: 9 } });
  });

  it("covers the defaults", () => {
    for (const id of Object.values(ANTHROPIC_DEFAULT_MODELS)) expect(Object.hasOwn(ANTHROPIC_PRICES, id)).toBe(true);
    expect(defaultModels("anthropic")).toEqual({ quick: "claude-haiku-5-5", ask: "claude-sonnet-5-5" });
    expect(defaultModels("openai-compatible")).toEqual({ quick: "", ask: "" });
    expect(DEFAULT_AI).toMatchObject({ enabled: false, effort: "balanced", monthlyCapUsd: 5 });
  });
});

describe("cost", () => {
  it("is tokens times price per million", () => {
    expect(costUsd({ inputPerMTok: 2, outputPerMTok: 10 }, { input: 1_000_000, output: 500_000 })).toBeCloseTo(7);
    expect(costUsd({ inputPerMTok: 0.1, outputPerMTok: 0.5 }, { input: 20, output: 5 })).toBeCloseTo(0.0000045, 10);
  });

  it("shows small amounts with four decimals", () => {
    expect(formatUsd(0.0000045)).toBe("$0.0000");
    expect(formatUsd(0.0123)).toBe("$0.0123");
    expect(formatUsd(5)).toBe("$5.00");
    expect(formatUsd(12.345)).toBe("$12.35");
  });
});
