import { Hono } from "hono";
import { expect, it } from "vitest";
import { settingsConcurrency } from "./settings-concurrency.ts";
import { testStore } from "./ai/test-store.ts";

it("rejects stale and missing revisions even when concurrent validators await", async () => {
  const t = testStore();
  try {
    const app = new Hono();
    app.use("/api/settings/*", settingsConcurrency(t.store.db));
    let value = "initial";
    app.get("/api/settings/demo", c => c.json({ ok: true, value }));
    app.put("/api/settings/demo", async c => { const body = await c.req.json(); await new Promise(resolve => setTimeout(resolve, 10)); value = body.value; return c.json({ ok: true, value }); });
    const first = await app.request("/api/settings/demo");
    expect(first.headers.get("ETag")).toBe('"0"');
    const put = (newValue: string, revision?: string) => app.request("/api/settings/demo", { method: "PUT", headers: { "Content-Type": "application/json", ...(revision === undefined ? {} : { "If-Match": revision }) }, body: JSON.stringify({ value: newValue }) });
    const results = await Promise.all([put("one", "0"), put("two", "0")]);
    expect(results.map(r => r.status)).toEqual([200, 409]);
    expect(value).toBe("one");
    expect((await put("missing")).status).toBe(409);
    expect((await put("latest", '"1"')).status).toBe(200);
    expect(await (await app.request("/api/settings/demo")).json()).toMatchObject({ value: "latest", revision: "2" });
    const fresh = new Hono(); fresh.use("/api/settings/*", settingsConcurrency(t.store.db)); fresh.get("/api/settings/demo", c => c.json({ ok: true }));
    expect(await (await fresh.request("/api/settings/demo")).json()).toMatchObject({ revision: "2" });
  } finally { t.close(); }
});

it("keeps a read's payload and revision together while a write is queued", async () => {
  const t = testStore();
  try {
    const app = new Hono(); app.use("/api/settings/*", settingsConcurrency(t.store.db));
    let value = "old";
    let entered!: () => void; let finish!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const pause = new Promise<void>(resolve => { finish = resolve; });
    app.get("/api/settings/demo", async c => { const snapshot = value; entered(); await pause; return c.json({ ok: true, value: snapshot }); });
    app.put("/api/settings/demo", c => { value = "new"; return c.json({ ok: true, value }); });
    const read = app.request("/api/settings/demo"); await started;
    const write = app.request("/api/settings/demo", { method: "PUT", headers: { "If-Match": "0" } });
    finish();
    expect(await (await read).json()).toMatchObject({ value: "old", revision: "0" });
    expect(await (await write).json()).toMatchObject({ value: "new", revision: "1" });
  } finally { t.close(); }
});
