import { afterEach, describe, expect, it } from "vitest";

import { DEFAULT_AI, type AiSettings } from "../../shared/ai.ts";
import { settingsStore } from "../settings.ts";
import { TEST_KEY, anthropicMessage, chatCompletion, fakeFetch, type Reply } from "./fake-fetch.ts";
import { aiLedger } from "./ledger.ts";
import { aiService, TEST_PROMPT } from "./service.ts";
import { testStore } from "./test-store.ts";
import { AiError } from "./types.ts";

const closers: (() => void)[] = [];
afterEach(() => {
  while (closers.length) closers.pop()!();
});

function setup(script: Reply | ((c: Parameters<Extract<Parameters<typeof fakeFetch>[0], Function>>[0], n: number) => Reply), ai: Partial<AiSettings> = {}, key: string | null = TEST_KEY) {
  const t = testStore();
  closers.push(t.close);
  const settings = settingsStore(t.store.db);
  settings.saveAi({ ...structuredClone(DEFAULT_AI), enabled: true, ...ai });
  if (key) settings.saveAiKey((ai.provider ?? "anthropic") as AiSettings["provider"], key);
  const ledger = aiLedger(t.store.db);
  const f = fakeFetch(script);
  return { service: aiService({ settings, ledger, fetch: f.fetch }), settings, ledger, calls: f.calls, db: t.store.db };
}

const ask = { messages: [{ role: "user" as const, content: "hi" }] };

describe("aiService.complete", () => {
  it.each([
    ["naming", "low", "small-model"], ["classification", "low", "small-model"],
    ["explanation", "medium", "middle-model"], ["analysis", "medium", "middle-model"],
    ["planning", "strong", "large-model"], ["review", "strong", "large-model"],
  ] as const)("routes %s through the configured %s model and records the task", async (task, tier, model) => {
    const s = setup({ body: anthropicMessage({ model }) }, { models: { low: "small-model", medium: "middle-model", strong: "large-model" } });
    const answer = await s.service.complete(task, ask);
    expect(s.calls).toHaveLength(1);
    expect(s.calls[0].body).toMatchObject({ model });
    expect(answer).toMatchObject({ tier, model });
    expect(s.db.prepare("SELECT job, model FROM ai_usage").get()).toMatchObject({ job: task, model });
  });

  it("refuses a missing Strong model without falling back to another tier", async () => {
    const s = setup({ body: anthropicMessage() });
    await expect(s.service.complete("planning", ask)).rejects.toMatchObject({ kind: "no-model", message: expect.stringContaining("Strong tier") });
    await expect(s.service.complete("unknown" as never, ask)).rejects.toMatchObject({ kind: "config" });
    expect(s.calls).toHaveLength(0);
    expect(s.ledger.monthToDate(5).calls).toBe(0);
  });

  it("refuses when AI is off, without any request", async () => {
    const s = setup({ body: anthropicMessage() }, { enabled: false });
    await expect(s.service.complete("naming", ask)).rejects.toMatchObject({ kind: "disabled" });
    expect(s.calls).toEqual([]);
  });

  it("refuses without a key or a model, without any request", async () => {
    const noKey = setup({ body: anthropicMessage() }, {}, null);
    await expect(noKey.service.complete("naming", ask)).rejects.toMatchObject({ kind: "no-key" });
    const noModel = setup({ body: chatCompletion() }, { provider: "openai-compatible", baseUrl: "http://localhost:1234/v1", models: { low: "", medium: "", strong: "" } }, null);
    await expect(noModel.service.complete("naming", ask)).rejects.toMatchObject({ kind: "no-model" });
    expect(noKey.calls.length + noModel.calls.length).toBe(0);
  });

  it("calls the model chosen for the job, with the saved effort and output limit, and records the cost", async () => {
    const s = setup({ body: anthropicMessage({ usage: { input_tokens: 1000, output_tokens: 200 } }) }, { effort: "thorough", maxOutputTokens: 800 });
    const out = await s.service.complete("analysis", { ...ask, maxOutputTokens: 5000 });
    expect(s.calls[0].body).toMatchObject({ model: "claude-sonnet-5-5", max_tokens: 800, output_config: { effort: "high" } });
    // Sonnet 5.5: $2 in, $10 out per million tokens.
    expect(out.costUsd).toBeCloseTo(0.004);
    const usage = s.ledger.monthToDate(5);
    expect(usage).toMatchObject({ calls: 1, inputTokens: 1000, outputTokens: 200 });
    expect(usage.spentUsd).toBeCloseTo(0.004);
    expect(s.db.prepare("SELECT job, provider, model FROM ai_usage").get()).toMatchObject({ job: "analysis", provider: "anthropic", model: "claude-sonnet-5-5" });
  });

  it("refuses once the month's spending has reached the cap, and says so", async () => {
    const s = setup({ body: anthropicMessage() }, { monthlyCapUsd: 1 });
    s.ledger.record({ job: "ask", provider: "anthropic", model: "claude-sonnet-5-5", inputTokens: 1, outputTokens: 1, costUsd: 0.99 });
    await s.service.complete("naming", ask);
    s.ledger.record({ job: "ask", provider: "anthropic", model: "claude-sonnet-5-5", inputTokens: 1, outputTokens: 1, costUsd: 0.5 });
    const e = await s.service.complete("naming", ask).catch((x: AiError) => x);
    expect(e).toMatchObject({ kind: "cap" });
    expect((e as AiError).message).toMatch(/paused.*\$1\.49.*cap \(\$1\.00\)/);
    // Only the one call before the cap went out.
    expect(s.calls).toHaveLength(1);
  });

  it("stops exactly at the cap, not above it", async () => {
    const s = setup({ body: anthropicMessage() }, { monthlyCapUsd: 0.5 });
    s.ledger.record({ job: "ask", provider: "anthropic", model: "m", inputTokens: 1, outputTokens: 1, costUsd: 0.5 });
    await expect(s.service.complete("naming", ask)).rejects.toMatchObject({ kind: "cap" });
  });

  it("counts a call with no known price in tokens, not dollars", async () => {
    const s = setup(
      { body: chatCompletion() },
      { provider: "openai-compatible", baseUrl: "http://localhost:1234/v1", models: { low: "qwen2.5:7b", medium: "qwen2.5:7b", strong: "" } },
      null,
    );
    const out = await s.service.complete("naming", ask);
    expect(out.costUsd).toBeNull();
    expect(s.ledger.monthToDate(5)).toMatchObject({ spentUsd: 0, calls: 1, unpricedCalls: 1, inputTokens: 20, outputTokens: 5 });
  });

  it("uses a price the user entered for a model", async () => {
    const s = setup(
      { body: chatCompletion({ usage: { prompt_tokens: 1_000_000, completion_tokens: 100_000 } }) },
      {
        provider: "openai-compatible",
        baseUrl: "http://localhost:1234/v1",
        models: { low: "gpt-5", medium: "gpt-5", strong: "" },
        prices: { "gpt-5": { inputPerMTok: 1.25, outputPerMTok: 10 } },
      },
      null,
    );
    const out = await s.service.complete("naming", ask);
    expect(out.costUsd).toBeCloseTo(2.25);
    expect(s.ledger.spentThisMonth()).toBeCloseTo(2.25);
  });

  it("doesn't price a call whose service reported no usage", async () => {
    const s = setup(
      { body: { model: "m", choices: [{ message: { content: "x" }, finish_reason: "stop" }] } },
      { provider: "openai-compatible", baseUrl: "http://localhost:1234/v1", models: { low: "m", medium: "m", strong: "" }, prices: { m: { inputPerMTok: 1, outputPerMTok: 1 } } },
      null,
    );
    expect((await s.service.complete("naming", ask)).costUsd).toBeNull();
  });

  it("records nothing when the call fails", async () => {
    const s = setup({ status: 429, body: { error: { message: "rate limited" } } });
    await expect(s.service.complete("naming", ask)).rejects.toBeInstanceOf(AiError);
    expect(s.ledger.monthToDate(5).calls).toBe(0);
  });
});

describe("aiService.test", () => {
  it("sends a tiny prompt to the Low model and reports the reply, tokens and cost", async () => {
    const s = setup({ body: anthropicMessage({ usage: { input_tokens: 20, output_tokens: 5 } }) });
    const r = await s.service.test();
    expect(s.calls[0].body).toMatchObject({ model: "claude-haiku-5-5", max_tokens: 1024, messages: [{ role: "user", content: TEST_PROMPT }], output_config: { effort: "medium" } });
    expect(r).toMatchObject({ reply: "ready", model: "claude-haiku-5-5", provider: "anthropic", tier: "low", inputTokens: 20, outputTokens: 5, stop: "end" });
    // Haiku 5.5: $0.10 in, $0.50 out per million tokens.
    expect(r.costUsd).toBeCloseTo(0.0000045, 9);
    expect(s.db.prepare("SELECT job FROM ai_usage").get()).toMatchObject({ job: "test" });
  });

  it("tests the Medium model when asked to", async () => {
    const s = setup({ body: anthropicMessage({ model: "claude-sonnet-5-5" }) });
    expect((await s.service.test("medium")).model).toBe("claude-sonnet-5-5");
    expect(s.calls[0].body).toMatchObject({ model: "claude-sonnet-5-5" });
  });

  it("is held back by the cap like any other call", async () => {
    const s = setup({ body: anthropicMessage() }, { monthlyCapUsd: 0.01 });
    s.ledger.record({ job: "ask", provider: "anthropic", model: "m", inputTokens: 1, outputTokens: 1, costUsd: 0.01 });
    await expect(s.service.test()).rejects.toMatchObject({ kind: "cap" });
  });
});

describe("aiService.models", () => {
  const list = { body: { data: [{ id: "m1", display_name: "M One" }], has_more: false } };

  it("uses the saved key for the saved provider", async () => {
    const s = setup(list);
    expect(await s.service.models()).toEqual([{ id: "m1", name: "M One" }]);
    expect(s.calls[0].headers["x-api-key"]).toBe(TEST_KEY);
  });

  it("uses a key that was typed but not saved, and doesn't save it", async () => {
    const s = setup(list, {}, null);
    await s.service.models({ key: "sk-test-typed-key-98765432100" });
    expect(s.calls[0].headers["x-api-key"]).toBe("sk-test-typed-key-98765432100");
    expect(s.settings.aiKey("anthropic")).toBeNull();
  });

  it("never sends the saved key to an address that isn't the saved one", async () => {
    const s = setup({ body: { data: [{ id: "m" }] } }, { provider: "openai-compatible", baseUrl: "https://api.openai.com/v1" });
    await s.service.models({ baseUrl: "https://elsewhere.example/v1" });
    expect(s.calls[0].url).toBe("https://elsewhere.example/v1/models");
    expect(s.calls[0].headers).not.toHaveProperty("authorization");
    // The same address (however it is spelled) does get it.
    await s.service.models({ baseUrl: "https://api.openai.com/v1/" });
    expect(s.calls[1].headers.authorization).toBe(`Bearer ${TEST_KEY}`);
    // And a typed key goes to the typed address.
    await s.service.models({ baseUrl: "https://elsewhere.example/v1", key: "typed-key-abcdef" });
    expect(s.calls[2].headers.authorization).toBe("Bearer typed-key-abcdef");
  });

  it("never sends one provider's saved key to the other provider", async () => {
    const s = setup(list); // the saved key belongs to Anthropic
    await s.service.models({ provider: "openai-compatible", baseUrl: "http://localhost:1234/v1" }).catch(() => {});
    expect(s.calls[0].url).toBe("http://localhost:1234/v1/models");
    expect(s.calls[0].headers).not.toHaveProperty("authorization");
    expect(JSON.stringify(s.calls[0].headers)).not.toContain(TEST_KEY);
  });

  it("refuses an address that isn't allowed, before any request", async () => {
    const s = setup(list, { provider: "openai-compatible", baseUrl: "https://api.openai.com/v1" });
    await expect(s.service.models({ baseUrl: "http://example.com/v1" })).rejects.toMatchObject({ kind: "config" });
    expect(s.calls).toEqual([]);
  });

  it("works while AI is off, since it costs nothing", async () => {
    const s = setup(list, { enabled: false });
    await expect(s.service.models()).resolves.toHaveLength(1);
    expect(s.ledger.monthToDate(5).calls).toBe(0);
  });
});
