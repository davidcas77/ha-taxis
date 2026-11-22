import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { jevRecord, validateJev, validateJevReview } from "../../shared/jev.ts";
import { validateJevCheckSubject, type JevCheckPreviewResponse, type JevCheckRunResponse } from "../../shared/jev-checks.ts";
import type { settingsStore } from "../settings.ts";
import type { FetchLike } from "../ai/http.ts";
import { JevError, jevService } from "./service.ts";
import type { JevLedger } from "./ledger.ts";
import type { JevCheckReaders } from "./check-evidence.ts";
import { jevCheckSessions } from "./checks.ts";

export function jevRoutes(deps: {
  settings: ReturnType<typeof settingsStore>;
  ledger: JevLedger;
  protect: (secret: string) => void;
  redact: (text: string) => string;
  fetch?: FetchLike;
  checkReaders?: JevCheckReaders;
  clock?: () => number;
}) {
  const app = new Hono();
  const service = jevService(deps);
  const checks = deps.checkReaders ? jevCheckSessions({ ...deps, reads: deps.checkReaders, check: service.check }) : null;
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
  app.get("/jev/usage", (c) => c.json({ ok: true, usage: deps.ledger.monthToDate(deps.settings.jev().monthlyRequestLimit) }));
  const fail = (e: unknown) => ({
    error: e instanceof JevError ? deps.redact(e.message) : "The Jev request could not be completed.",
    status: e instanceof JevError ? e.status : (502 as const),
    ...(e instanceof JevError && e.code && { code: e.code }),
  });
  app.post("/jev/checks/preview", limit, async (c) => {
    const subject = validateJevCheckSubject(await c.req.json().catch(() => null));
    if (!subject) return c.json<JevCheckPreviewResponse>({ ok: false, error: "Choose a supported subject for a Jev check." }, 400);
    if (!checks) return c.json<JevCheckPreviewResponse>({ ok: false, error: "This check needs Home Assistant data." }, 503);
    try {
      return c.json<JevCheckPreviewResponse>({ ok: true, preview: await checks.preview(subject) });
    } catch (error) {
      const { status, ...failure } = fail(error);
      return c.json<JevCheckPreviewResponse>({ ok: false, ...failure }, status);
    }
  });
  app.post("/jev/checks/run", limit, async (c) => {
    const body: unknown = await c.req.json().catch(() => null);
    const subject = jevRecord(body) && validateJevCheckSubject(body.subject);
    if (!jevRecord(body) || Object.keys(body).length !== 2 || !subject || typeof body.fingerprint !== "string" || !/^[a-f0-9]{64}$/.test(body.fingerprint))
      return c.json<JevCheckRunResponse>({ ok: false, error: "Review the Jev check preview first." }, 400);
    if (!checks) return c.json<JevCheckRunResponse>({ ok: false, error: "This check needs Home Assistant data." }, 503);
    try {
      return c.json<JevCheckRunResponse>({ ok: true, ...(await checks.run(subject, body.fingerprint)) });
    } catch (error) {
      const { status, ...failure } = fail(error);
      return c.json<JevCheckRunResponse>({ ok: false, ...failure }, status);
    }
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
