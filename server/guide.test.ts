import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { EMPTY_GUIDE } from "../shared/guide.ts";
import { testStore } from "./ai/test-store.ts";
import { guideRoutes } from "./guide.ts";
import { requireTaxisHeader } from "./guard.ts";
import { settingsConcurrency } from "./settings-concurrency.ts";
import { settingsStore } from "./settings.ts";

describe("guide settings API", () => {
  it("stores choices in Taxis, preserves other settings and rejects stale writes", async () => {
    const t = testStore();
    try {
      const settings = settingsStore(t.store.db);
      settings.saveParameters({ house: { night_start: "22:30" }, types: {}, areas: {} });
      const app = new Hono();
      app.use("/api/*", requireTaxisHeader);
      app.use("/api/settings/*", settingsConcurrency(t.store.db));
      app.route("/api", guideRoutes(settings));
      expect(await (await app.request("/api/settings/guide")).json()).toEqual({
        ok: true,
        guide: EMPTY_GUIDE,
        revision: "0",
      });
      const body = { areas: { bedroom: { profile: "bedroom", goals: ["night"] } } };
      const put = (revision: string) =>
        app.request("/api/settings/guide", {
          method: "PUT",
          headers: { "x-taxis-request": "1", "if-match": revision, "content-type": "application/json" },
          body: JSON.stringify(body),
        });
      expect(await (await put("0")).json()).toEqual({ ok: true, guide: body, revision: "1" });
      expect((await put("0")).status).toBe(409);
      expect(settingsStore(t.store.db).guide()).toEqual(body);
      expect(settings.parameters().house.night_start).toBe("22:30");
      const invalid = await app.request("/api/settings/guide", {
        method: "PUT",
        headers: { "x-taxis-request": "1", "if-match": "1", "content-type": "application/json" },
        body: '{"areas":{"bad":{"profile":"bad","goals":[]}}}',
      });
      expect(invalid.status).toBe(400);
      expect(settings.guide()).toEqual(body);
    } finally {
      t.close();
    }
  });
  it("requires the cross-site header and bounds the payload without changing settings", async () => {
    const t = testStore();
    try {
      const settings = settingsStore(t.store.db);
      const app = new Hono();
      app.use("/api/*", requireTaxisHeader);
      app.route("/api", guideRoutes(settings));
      expect(
        (await app.request("/api/settings/guide", { method: "PUT", body: JSON.stringify(EMPTY_GUIDE) })).status,
      ).toBe(400);
      expect(
        (
          await app.request("/api/settings/guide", {
            method: "PUT",
            headers: { "x-taxis-request": "1" },
            body: "x".repeat(130 * 1024),
          })
        ).status,
      ).toBe(413);
      expect(settings.guide()).toEqual(EMPTY_GUIDE);
    } finally {
      t.close();
    }
  });
});
