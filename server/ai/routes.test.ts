import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_AI, type AiSettings } from "../../shared/ai.ts";
import { redact } from "../config.ts";
import { requireTaxisHeader } from "../guard.ts";
import { addLogSecret, clearLogSecrets } from "../log.ts";
import { settingsStore } from "../settings.ts";
import { TEST_KEY, anthropicMessage, fakeFetch, type Reply } from "./fake-fetch.ts";
import { aiLedger } from "./ledger.ts";
import type { ProviderFactory } from "./provider.ts";
import { aiRoutes } from "./routes.ts";
import { testStore } from "./test-store.ts";

const HA_TOKEN = "ha-token-invented-xyz";
const closers: (() => void)[] = [];
// The routes log; keep the test output quiet. Tests that read the log spy again.
beforeEach(() => {
  for (const m of ["log", "warn", "error"] as const) vi.spyOn(console, m).mockImplementation(() => {});
});
afterEach(() => {
  while (closers.length) closers.pop()!();
  vi.restoreAllMocks();
  clearLogSecrets();
});

function setup(script: Reply | Parameters<typeof fakeFetch>[0] = { body: anthropicMessage() }, makeProvider?: ProviderFactory) {
  const t = testStore();
  closers.push(t.close);
  const settings = settingsStore(t.store.db);
  const ledger = aiLedger(t.store.db);
  const f = fakeFetch(script);
  const protect = vi.fn((s: string) => addLogSecret(s));
  // The same wiring as index.ts: the header guard first, then the AI routes under /api.
  const app = new Hono();
  app.use("/api/*", requireTaxisHeader);
  app.route("/api", aiRoutes({ settings, ledger, protect, redact: (m) => redact(m, HA_TOKEN), fetch: f.fetch, makeProvider }));
  const req = (method: string, path: string, body?: unknown, headers: Record<string, string> = { "x-taxis-request": "1" }) =>
    app.request(path, { method, headers: { "content-type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  const save = (over: Partial<AiSettings> & { key?: string | null } = {}) => req("PUT", "/api/settings/ai", { ...structuredClone(DEFAULT_AI), enabled: true, ...over });
  return { app, req, save, settings, ledger, calls: f.calls, protect };
}

describe("GET and PUT /api/settings/ai", () => {
  it("starts off, with the defaults and no key", async () => {
    const s = setup();
    const body = await (await s.req("GET", "/api/settings/ai")).json();
    expect(body).toMatchObject({ ok: true, ai: { ...DEFAULT_AI, keySet: false, keyEnd: null } });
  });

  it("stores the key but never returns it, only that it is set and how it ends", async () => {
    const s = setup();
    const res = await s.save({ key: TEST_KEY });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain(TEST_KEY);
    expect(JSON.parse(text).ai).toMatchObject({ enabled: true, keySet: true, keyEnd: TEST_KEY.slice(-4) });
    expect(JSON.parse(text).ai).not.toHaveProperty("key");

    const again = await (await s.req("GET", "/api/settings/ai")).text();
    expect(again).not.toContain(TEST_KEY);
    expect(JSON.parse(again).ai).toMatchObject({ keySet: true, keyEnd: TEST_KEY.slice(-4) });
    // It is in the database, for the server to use.
    expect(s.settings.aiKey("anthropic")).toBe(TEST_KEY);
    // And the logger was told to keep it out of the log.
    expect(s.protect).toHaveBeenCalledWith(TEST_KEY);
  });

  it("shows no ending for a short key", async () => {
    const s = setup();
    const body = await (await s.save({ provider: "openai-compatible", baseUrl: "http://localhost:11434/v1", key: "ollama" })).json();
    expect(body.ai).toMatchObject({ keySet: true, keyEnd: null });
  });

  it("keeps the key when the request leaves it out, replaces it with a string, removes it with null", async () => {
    const s = setup();
    await s.save({ key: TEST_KEY });
    await s.save({ effort: "thorough" });
    expect(s.settings.aiKey("anthropic")).toBe(TEST_KEY);
    await s.save({ key: "sk-test-replacement-0000111122223333" });
    expect(s.settings.aiKey("anthropic")).toBe("sk-test-replacement-0000111122223333");
    const gone = await (await s.save({ key: null })).json();
    expect(gone.ai).toMatchObject({ keySet: false, keyEnd: null });
    expect(s.settings.aiKey("anthropic")).toBeNull();
  });

  it("keeps a key per provider", async () => {
    const s = setup();
    await s.save({ key: TEST_KEY });
    const other = await (await s.save({ provider: "openai-compatible", baseUrl: "http://localhost:11434/v1" })).json();
    expect(other.ai).toMatchObject({ provider: "openai-compatible", keySet: false, keys: { anthropic: { set: true, end: TEST_KEY.slice(-4) } } });
    expect(s.settings.aiKey("anthropic")).toBe(TEST_KEY);
  });

  it("refuses bad settings and saves nothing, key included", async () => {
    const s = setup();
    const res = await s.save({ key: TEST_KEY, monthlyCapUsd: -3 });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ ok: false, error: expect.stringContaining("monthly cap") });
    expect(s.settings.aiKey("anthropic")).toBeNull();
    expect(s.settings.ai().enabled).toBe(false);
    expect((await s.req("PUT", "/api/settings/ai", "nope")).status).toBe(400);
  });

  it("writes nothing about the key to the log", async () => {
    const lines: string[] = [];
    for (const m of ["log", "warn", "error"] as const) vi.spyOn(console, m).mockImplementation((l: string) => void lines.push(String(l)));
    const s = setup();
    await s.save({ key: TEST_KEY });
    await s.save({ key: null });
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.join("\n")).not.toContain(TEST_KEY);
  });

  it("limits the size of the request", async () => {
    const s = setup();
    const res = await s.save({ prices: { x: { inputPerMTok: 1, outputPerMTok: 1 } }, baseUrl: `https://example.com/${"a".repeat(40_000)}` });
    expect(res.status).toBe(413);
  });
});

describe("the cross-site header guard", () => {
  it("covers every AI route that changes anything or costs anything", async () => {
    const s = setup();
    for (const [method, path] of [["PUT", "/api/settings/ai"], ["POST", "/api/ai/models"], ["POST", "/api/ai/test"]] as const) {
      const res = await s.req(method, path, {}, {});
      expect(res.status, `${method} ${path}`).toBe(400);
      expect(await res.text()).toBe("Missing request header.");
    }
    expect(s.calls).toEqual([]);
    expect(s.settings.ai().enabled).toBe(false);
  });

  it("lets reads through, as it does everywhere", async () => {
    const s = setup();
    expect((await s.req("GET", "/api/settings/ai", undefined, {})).status).toBe(200);
    expect((await s.req("GET", "/api/ai/usage", undefined, {})).status).toBe(200);
  });
});

describe("POST /api/ai/models", () => {
  const list = { body: { data: [{ id: "claude-haiku-5-5", display_name: "Claude Haiku 5.5" }], has_more: false } };

  it("reports a persistent HTML gateway timeout without exposing the page or changing settings", async () => {
    const lines: string[] = [];
    vi.spyOn(console, "warn").mockImplementation((line: string) => void lines.push(String(line)));
    const s = setup({ status: 504, text: `<!DOCTYPE html><html>gateway diagnostics ${TEST_KEY}</html>` });
    const before = s.settings.ai();
    const res = await s.req("POST", "/api/ai/models", { provider: "openai-compatible", baseUrl: "https://api.openai.com/v1", key: TEST_KEY });
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ ok: false, error: "api.openai.com answered 504. The service timed out. Try again shortly." });
    expect(lines.join("\n")).not.toMatch(/<!DOCTYPE|<html>|gateway diagnostics/);
    expect(lines.join("\n")).not.toContain(TEST_KEY);
    expect(s.calls).toHaveLength(2);
    expect(s.calls.every(call => call.method === "GET")).toBe(true);
    expect(s.settings.ai()).toEqual(before);
    expect(s.settings.aiKey("openai-compatible")).toBeNull();
  });

  it("lists models with the saved key", async () => {
    const s = setup(list);
    await s.save({ key: TEST_KEY });
    const res = await s.req("POST", "/api/ai/models", {});
    expect(await res.json()).toEqual({ ok: true, models: [{ id: "claude-haiku-5-5", name: "Claude Haiku 5.5" }] });
    expect(s.calls[0].headers["x-api-key"]).toBe(TEST_KEY);
  });

  it("lists models with a key just entered, without saving it, and keeps it out of the log", async () => {
    const lines: string[] = [];
    vi.spyOn(console, "warn").mockImplementation((l: string) => void lines.push(String(l)));
    const s = setup({ status: 401, body: { error: { message: `invalid key ${TEST_KEY}` } } });
    const res = await s.req("POST", "/api/ai/models", { key: TEST_KEY });
    expect(res.status).toBe(502);
    const text = await res.text();
    expect(text).toContain("401");
    expect(text).not.toContain(TEST_KEY);
    expect(s.settings.aiKey("anthropic")).toBeNull();
    expect(s.calls[0].headers["x-api-key"]).toBe(TEST_KEY);
    expect(lines.join("\n")).not.toContain(TEST_KEY);
  });

  it("takes a provider and base URL that aren't saved yet, and checks the address", async () => {
    const s = setup({ body: { data: [{ id: "qwen2.5:7b" }] } });
    const ok = await s.req("POST", "/api/ai/models", { provider: "openai-compatible", baseUrl: "http://192.168.1.20:11434/v1" });
    expect(await ok.json()).toEqual({ ok: true, models: [{ id: "qwen2.5:7b", name: "qwen2.5:7b" }] });
    expect(s.calls[0].url).toBe("http://192.168.1.20:11434/v1/models");

    const bad = await s.req("POST", "/api/ai/models", { provider: "openai-compatible", baseUrl: "http://example.com/v1" });
    expect(bad.status).toBe(400);
    expect(s.calls).toHaveLength(1);
  });

  it("refuses requests it can't read", async () => {
    const s = setup(list);
    expect((await s.req("POST", "/api/ai/models", { provider: "nope" })).status).toBe(400);
    expect((await s.req("POST", "/api/ai/models", { key: "has spaces" })).status).toBe(400);
    expect((await s.req("POST", "/api/ai/models", { baseUrl: 3 })).status).toBe(400);
    expect((await s.req("POST", "/api/ai/models", [])).status).toBe(400);
    expect((await s.req("POST", "/api/ai/models", { key: "x".repeat(5000) })).status).toBe(413);
    expect(s.calls).toEqual([]);
  });

  it("takes the Home Assistant token out of an error too", async () => {
    const s = setup({ status: 500, text: `upstream says ${HA_TOKEN}` });
    await s.save({ key: TEST_KEY });
    const text = await (await s.req("POST", "/api/ai/models", {})).text();
    expect(text).toContain("500");
    expect(text).not.toContain(HA_TOKEN);
  });
});

describe("POST /api/ai/test", () => {
  it("sends a tiny prompt and returns the reply, tokens and cost", async () => {
    const s = setup({ body: anthropicMessage() });
    await s.save({ key: TEST_KEY });
    const res = await s.req("POST", "/api/ai/test", {});
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.test).toMatchObject({ reply: "ready", model: "claude-haiku-5-5", inputTokens: 20, outputTokens: 5, tier: "low", stop: "end" });
    expect(body.test.costUsd).toBeCloseTo(0.0000045, 9);
    expect(JSON.stringify(body)).not.toContain(TEST_KEY);
    expect((await (await s.req("GET", "/api/ai/usage")).json()).usage).toMatchObject({ calls: 1, inputTokens: 20, outputTokens: 5 });
  });

  it("accepts the legacy Ask test request from an older browser tab", async () => {
    const s = setup({ body: anthropicMessage() });
    await s.save({ key: TEST_KEY });
    await s.req("POST", "/api/ai/test", { job: "ask" });
    expect(s.calls[0].body).toMatchObject({ model: "claude-sonnet-5-5" });
    expect((await s.req("POST", "/api/ai/test", { job: "nope" })).status).toBe(400);
  });

  it.each(["low", "medium", "strong"] as const)("tests the saved %s tier", async tier => {
    const model = `${tier}-selected`;
    const s = setup({ body: anthropicMessage({ model }) });
    await s.save({ key: TEST_KEY, models: { low: "low-selected", medium: "medium-selected", strong: "strong-selected" } });
    const response = await s.req("POST", "/api/ai/test", { tier });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, test: { tier, model } });
    expect(s.calls[0].body).toMatchObject({ model });
  });

  it("rejects an unknown tier without calling the provider", async () => {
    const s = setup({ body: anthropicMessage() });
    await s.save({ key: TEST_KEY });
    expect((await s.req("POST", "/api/ai/test", { tier: "ultimate" })).status).toBe(400);
    expect((await s.req("POST", "/api/ai/test", { tier: "strong" })).status).toBe(409);
    expect(s.calls).toHaveLength(0);
  });

  it("says why it can't: off, no key, over the cap", async () => {
    const s = setup({ body: anthropicMessage() });
    const off = await s.req("POST", "/api/ai/test", {});
    expect(off.status).toBe(409);
    expect(await off.json()).toMatchObject({ ok: false, error: expect.stringContaining("off") });

    await s.save({ monthlyCapUsd: 1 });
    expect((await s.req("POST", "/api/ai/test", {})).status).toBe(409);

    await s.save({ monthlyCapUsd: 1, key: TEST_KEY });
    s.ledger.record({ job: "ask", provider: "anthropic", model: "m", inputTokens: 1, outputTokens: 1, costUsd: 1 });
    const capped = await s.req("POST", "/api/ai/test", {});
    expect(capped.status).toBe(429);
    expect(await capped.json()).toMatchObject({ error: expect.stringContaining("cap") });
    expect(s.calls).toEqual([]);
  });

  it("answers an unexpected failure generally and logs it without the key", async () => {
    const lines: string[] = [];
    vi.spyOn(console, "error").mockImplementation((l: string) => void lines.push(String(l)));
    const boom: ProviderFactory = () => ({
      listModels: async () => [],
      complete: async () => {
        throw new Error(`socket exploded near ${TEST_KEY}`);
      },
    });
    const s = setup({ body: {} }, boom);
    await s.save({ key: TEST_KEY });
    const res = await s.req("POST", "/api/ai/test", {});
    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain(TEST_KEY);
    expect(lines.join("\n")).not.toContain(TEST_KEY);
  });
});

describe("GET /api/ai/usage", () => {
  it("reports this month against the saved cap", async () => {
    const s = setup();
    await s.save({ monthlyCapUsd: 7.5 });
    s.ledger.record({ job: "ask", provider: "anthropic", model: "claude-sonnet-5-5", inputTokens: 100, outputTokens: 50, costUsd: 0.25 });
    const { usage } = await (await s.req("GET", "/api/ai/usage")).json();
    expect(usage).toMatchObject({ capUsd: 7.5, spentUsd: 0.25, calls: 1, inputTokens: 100, outputTokens: 50 });
    expect(usage.month).toMatch(/^\d{4}-\d{2}$/);
  });
});
