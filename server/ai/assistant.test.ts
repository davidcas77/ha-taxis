import { Hono } from "hono";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_AI } from "../../shared/ai.ts";
import type { AssistantScope } from "../../shared/assistant.ts";
import { buildHierarchy, type RawRegistry } from "../model/hierarchy.ts";
import { settingsStore } from "../settings.ts";
import { requireTaxisHeader } from "../guard.ts";
import { aiLedger } from "./ledger.ts";
import { jevLedger } from "../jev/ledger.ts";
import { testStore } from "./test-store.ts";
import { aiService } from "./service.ts";
import { assistantRoutes } from "./assistant.ts";
import { assistantContext } from "./assistant-context.ts";
import { anthropicMessage, fakeFetch, TEST_KEY, type Reply } from "./fake-fetch.ts";
import type { Change } from "../../shared/types.ts";

const closers: (() => void)[] = [];
afterEach(() => { while (closers.length) closers.pop()!(); });
function setup(reply: Reply | Parameters<typeof fakeFetch>[0] = { body: anthropicMessage({ content: [{ type: "text", text: "Review the existing presence sensor first." }] }) }) {
  const t = testStore(); closers.push(t.close);
  const settings = settingsStore(t.store.db);
  settings.saveAi({ ...structuredClone(DEFAULT_AI), enabled: true, models: { low: "small", medium: "middle", strong: "large" } });
  settings.saveAiKey("anthropic", TEST_KEY);
  settings.saveGuide({ areas: { living: { profile: "living", goals: ["lighting"] } }, tests: { living: { configuration: "old", checked: [], notes: "PRIVATE_SAVED_NOTES", testedAt: "2026-10-28T00:00:00Z" } } });
  const raw: RawRegistry = { config: { location_name: "PRIVATE_HOME" }, floors: [],
    areas: [{ area_id: "living", name: "Living" }, { area_id: "secret_room", name: "PRIVATE_ROOM" }], devices: [], labels: [],
    entities: [{ entity_id: "light.living_lamp", area_id: "living", platform: "demo", unique_id: "lamp" }, { entity_id: "sensor.secret", area_id: "secret_room", platform: "demo", unique_id: "secret" }],
    states: [{ entity_id: "light.living_lamp", state: "PRIVATE_STATE", attributes: { latitude: 38, secret: "PRIVATE_ATTRIBUTE" } as never }, { entity_id: "sensor.secret", state: "PRIVATE_OTHER_STATE", attributes: {} }],
  };
  const h = buildHierarchy(raw, "2026-10-28T00:00:00Z");
  const changes: Change[] = [];
  const ledger = aiLedger(t.store.db); const f = fakeFetch(reply);
  const redact = (s: string) => s.split(TEST_KEY).join("[redacted]");
  const context = async (scope: AssistantScope) => assistantContext(scope, scope.includeData ? h : null, changes, settings, redact);
  const app = new Hono(); app.use("/api/*", requireTaxisHeader);
  const service = aiService({ settings, ledger, fetch: f.fetch });
  app.route("/api", assistantRoutes({ db: t.store.db, settings, service, ledger, jevLedger: jevLedger(t.store.db), context, redact }));
  const scope: AssistantScope = { page: "guide", section: "", areaId: "living", includeData: true };
  const req = (path: string, body?: unknown, guarded = true) => app.request(`/api/assistant/${path}`, { method: body === undefined ? "GET" : "POST", headers: { "content-type": "application/json", ...(guarded ? { "x-taxis-request": "1" } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const ask = async (over: Record<string, unknown> = {}) => req("ask", { ...scope, action: "explain", question: "What next?", history: [], fingerprint: (await context(scope)).fingerprint, ...over });
  return { ...t, settings, h, changes, ledger, service, f, context, scope, req, ask };
}

describe("assistant context and permissions", () => {
  it("preview is local, selected and excludes raw states, other rooms, notes and secrets", async () => {
    const s = setup(); const r = await (await s.req("context", s.scope)).json();
    expect(r.ok).toBe(true); expect(r.preview.content).toContain("light.living_lamp");
    expect(r.preview.content).toContain("capabilities"); expect(r.preview.content).toContain("equipment");
    for (const privateValue of ["PRIVATE_HOME", "PRIVATE_ROOM", "PRIVATE_STATE", "PRIVATE_ATTRIBUTE", "PRIVATE_OTHER_STATE", "PRIVATE_SAVED_NOTES", TEST_KEY]) expect(r.preview.content).not.toContain(privateValue);
    expect(s.f.calls).toHaveLength(0); expect(s.ledger.monthToDate(5).calls).toBe(0);
  });
  it("page-only context works without HA data; house scope includes counts only", async () => {
    const s = setup();
    const page = await s.context({ ...s.scope, includeData: false });
    expect(page.content).toContain("House guide"); expect(page.content).not.toContain("Living");
    const home = await s.context({ ...s.scope, areaId: null });
    expect(home.content).toContain("counts"); expect(home.content).not.toContain("light.living_lamp"); expect(home.content).not.toContain("PRIVATE_ROOM");
  });
  it("rejects stale context before any paid call", async () => {
    const s = setup(); const fingerprint = (await s.context(s.scope)).fingerprint;
    s.h.areas.living.name = "Changed";
    const r = await s.ask({ fingerprint }); expect(r.status).toBe(409); expect(s.f.calls).toHaveLength(0);
  });
  it("requires a new preview when provider or model routing changes", async () => {
    const s = setup(); const fingerprint = (await s.context(s.scope)).fingerprint;
    s.settings.saveAi({ ...s.settings.ai(), provider: "openai-compatible", baseUrl: "https://other.example/v1" });
    expect((await s.ask({ fingerprint })).status).toBe(409); expect(s.f.calls).toHaveLength(0);
  });
  it("fails closed for a removed area and guards POST endpoints", async () => {
    const s = setup();
    expect((await s.req("context", { ...s.scope, areaId: "missing" })).status).toBe(409);
    for (const path of ["context", "ask"]) expect((await s.req(path, s.scope, false)).status).toBe(400);
    expect(s.f.calls).toHaveLength(0);
  });
  it("projects pending change values without YAML or unbounded member lists", async () => {
    const s = setup();
    s.changes.push({ id: 1, kind: "entity", op: "update", targetId: "light.living_lamp", scope: null, before: { name: "Old" }, after: { name: "New", yaml: "PRIVATE_YAML" } as never, createdAt: "now" });
    const p = await s.context({ ...s.scope, page: "changes" });
    expect(p.content).toContain('"name": "Old"'); expect(p.content).toContain('"name": "New"'); expect(p.content).not.toContain("PRIVATE_YAML");
  });
  it("bounds area entities and explicitly reports omissions", async () => {
    const s = setup(); const e = s.h.entities["light.living_lamp"];
    for (let n=0;n<70;n++) { const id=`light.extra_${n}`; s.h.entities[id]={ ...e, entityId:id }; s.h.areas.living.entityIds.push(id); }
    const p = await s.context(s.scope); expect(p.omissions.join()).toContain("60 of 71"); expect(JSON.parse(p.content).entities).toHaveLength(60);
  });
});

describe("assistant requests", () => {
  it.each([["explain", "middle", "medium"], ["next", "large", "strong"], ["naming", "small", "low"]])("routes %s through the configured model", async (action, model, tier) => {
    const s = setup({ body: anthropicMessage({ model, content: [{ type: "text", text: "Advice only." }] }) });
    const before = s.settings.guide(); const r = await (await s.ask({ action })).json();
    expect(r).toMatchObject({ ok: true, answer: { text: "Advice only.", model, tier } });
    expect(s.f.calls).toHaveLength(1); expect(s.f.calls[0].body).toMatchObject({ model });
    expect(s.f.calls[0].body).not.toHaveProperty("tools"); expect(s.settings.guide()).toEqual(before);
    expect(s.store.db.prepare("SELECT COUNT(*) AS n FROM changes").get()).toMatchObject({ n: 0 });
    expect(s.store.db.prepare("SELECT status, tier FROM assistant_activity").get()).toMatchObject({ status: "completed", tier });
  });
  it("redacts submitted secrets and replies; stores counts and metadata only", async () => {
    const s = setup({ body: anthropicMessage({ content: [{ type: "text", text: `Do not reveal ${TEST_KEY}` }] }) });
    const r = await s.ask({ question: `PRIVATE_QUESTION ${TEST_KEY}`, history: [{ role: "user", content: `PRIVATE_HISTORY ${TEST_KEY}` }] });
    expect(await r.text()).not.toContain(TEST_KEY);
    const payload = JSON.stringify(s.f.calls[0].body); expect(payload).not.toContain(TEST_KEY); expect(payload).toContain("PRIVATE_QUESTION");
    const admin = await (await s.req("admin")).text();
    for (const value of [TEST_KEY, "PRIVATE_QUESTION", "PRIVATE_HISTORY", "Do not reveal", "living_lamp"]) expect(admin).not.toContain(value);
    expect(JSON.parse(admin).activity[0]).toMatchObject({ page: "guide", scope: "selected area", status: "completed" });
  });
  it("rejects extra tools, state, models, system messages and oversized prompts", async () => {
    const s = setup();
    for (const over of [{ model: "bypass" }, { tools: [] }, { context: { secret: "x" } }, { question: "x".repeat(2001) }, { action: "__proto__" }, { history: [{ role: "system", content: "execute" }] }, { history: Array(7).fill({ role: "user", content: "x" }) }]) expect((await s.ask(over)).status).toBe(400);
    expect((await s.req("ask", { padding: "x".repeat(40000) })).status).toBe(413);
    expect(s.f.calls).toHaveLength(0);
  });
  it("respects disabled AI, missing models and the existing cost cap", async () => {
    const s = setup(); s.settings.saveAi({ ...s.settings.ai(), enabled: false });
    expect((await (await s.ask()).json()).error).toContain("off");
    s.settings.saveAi({ ...s.settings.ai(), enabled: true, models: { low: "", medium: "", strong: "" } });
    expect((await (await s.ask()).json()).error).toContain("model");
    s.settings.saveAi({ ...s.settings.ai(), models: { low: "small", medium: "middle", strong: "large" } });
    s.ledger.record({ job: "test", provider: "anthropic", model: "x", inputTokens: 1, outputTokens: 1, costUsd: 100 });
    expect((await s.ask()).status).toBe(429); expect(s.f.calls).toHaveLength(0);
  });
  it("ignores requested tool execution and records the unusable answer as failed", async () => {
    const s = setup({ body: anthropicMessage({ stop_reason: "tool_use", content: [{ type: "tool_use", id: "x", name: "apply", input: {} }] }) });
    expect((await s.ask()).status).toBe(502); expect(s.f.calls).toHaveLength(1);
    expect(s.store.db.prepare("SELECT status FROM assistant_activity").get()).toMatchObject({ status: "failed" });
    expect(s.store.db.prepare("SELECT COUNT(*) AS n FROM changes").get()).toMatchObject({ n: 0 });
  });
  it("handles upstream failure without retries or exposing provider content", async () => {
    const s = setup({ status: 504, text: `<!DOCTYPE html>${TEST_KEY}` });
    const r = await s.ask(); expect(r.status).toBe(502); expect(await r.text()).not.toContain(TEST_KEY); expect(s.f.calls).toHaveLength(1);
    expect(s.store.db.prepare("SELECT status FROM assistant_activity").get()).toMatchObject({ status: "failed" });
  });
  it("rejects an overlapping paid request and releases the lock afterward", async () => {
    const s = setup(); const complete = s.service.complete;
    let release!: () => void; let started!: () => void;
    const entered = new Promise<void>(resolve => { started = resolve; });
    s.service.complete = async (...args) => { started(); await new Promise<void>(resolve => { release = resolve; }); return complete(...args); };
    const first = s.ask(); await entered;
    expect((await s.ask()).status).toBe(409);
    release(); expect((await first).status).toBe(200); expect(s.f.calls).toHaveLength(1);
    s.service.complete = complete; expect((await s.ask()).status).toBe(200);
  });
  it("flags incomplete output rather than presenting it as a complete reply", async () => {
    const s = setup({ body: anthropicMessage({ stop_reason: "max_tokens", content: [{ type: "text", text: "Partial advice" }] }) });
    expect(await (await s.ask()).json()).toMatchObject({ ok: true, answer: { truncated: true } });
  });
  it("retains at most 200 metadata rows and returns only the latest 30", async () => {
    const s = setup();
    for (let n=0;n<205;n++) s.store.db.prepare("INSERT INTO assistant_activity(at,action,page,scope,tier,model,status) VALUES ('now','explain','guide','page only','medium','middle','completed')").run();
    await s.ask(); expect(s.store.db.prepare("SELECT COUNT(*) AS n FROM assistant_activity").get()).toMatchObject({ n: 200 });
    expect((await (await s.req("admin")).json()).activity).toHaveLength(30);
  });
});
