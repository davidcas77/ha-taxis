import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { validateJev, validateJevReview } from "../../shared/jev.ts";
import type { settingsStore } from "../settings.ts";
import type { FetchLike } from "../ai/http.ts";
import { JevError, jevService } from "./service.ts";
import type { JevLedger } from "./ledger.ts";

export function jevRoutes(deps: {
  settings: ReturnType<typeof settingsStore>;
  ledger: JevLedger;
  protect: (secret: string) => void;
  redact: (text: string) => string;
  fetch?: FetchLike;
}) {
  const app = new Hono();
  const service = jevService(deps);
  const limit = bodyLimit({
    maxSize: 16 * 1024,
    onError: (c) => c.json({ ok: false, error: "The Jev request is too large." }, 413),
  });
  app.get("/settings/jev", (c) => c.json({ ok: true, jev: deps.settings.jevView() }));
  app.put("/settings/jev", limit, async (c) => {
    const checked = validateJev(await c.req.json().catch(() => null));
    if (!checked.ok) return c.json({ ok: false, error: checked.error }, 400);
    if (checked.key) deps.protect(checked.key);
    try {
      deps.settings.saveJev(checked.value, checked.key);
    } catch {
      return c.json({ ok: false, error: "Couldn't save Jev settings. The previous settings were kept." }, 500);
    }
    return c.json({ ok: true, jev: deps.settings.jevView() });
  });
  app.get("/jev/usage", (c) =>
    c.json({ ok: true, usage: deps.ledger.monthToDate(deps.settings.jev().monthlyRequestLimit) }),
  );
  const fail = (e: unknown) => ({
    error: e instanceof JevError ? e.message : "The Jev request could not be completed.",
    status: e instanceof JevError ? e.status : (502 as const),
  });
  app.post("/jev/test", limit, async (c) => {
    // No caller-supplied prompts, keys, URLs or models on paid endpoints.
    const body: unknown = await c.req.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length)
      return c.json({ ok: false, error: "The test uses saved Jev settings. Send an empty object." }, 400);
    try {
      return c.json({ ok: true, ...(await service.test()) });
    } catch (e) {
      const f = fail(e);
      return c.json({ ok: false, error: f.error }, f.status);
    }
  });
  app.post("/jev/room-notes", limit, async (c) => {
    const checked = validateJevReview(await c.req.json().catch(() => null));
    if (!checked.ok) return c.json({ ok: false, error: checked.error }, 400);
    try {
      return c.json({ ok: true, review: await service.review(checked.value) });
    } catch (e) {
      const f = fail(e);
      return c.json({ ok: false, error: f.error }, f.status);
    }
  });
  return app;
}
