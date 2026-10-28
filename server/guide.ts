import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { validateGuide, type GuideResponse } from "../shared/guide.ts";
import type { settingsStore } from "./settings.ts";

// Taxis-only preferences; the ordinary settings concurrency/header middleware
// wraps these routes. Saving never makes a Home Assistant request.
export function guideRoutes(settings: ReturnType<typeof settingsStore>) {
  const app = new Hono();
  app.get("/settings/guide", (c) => c.json<GuideResponse>({ ok: true, guide: settings.guide() }));
  app.put(
    "/settings/guide",
    bodyLimit({
      maxSize: 128 * 1024,
      onError: (c) => c.json({ ok: false, error: "The guide choices are too large." }, 413),
    }),
    async (c) => {
      const checked = validateGuide(await c.req.json().catch(() => null));
      if (!checked.ok) return c.json<GuideResponse>({ ok: false, error: checked.error }, 400);
      settings.saveGuide(checked.value);
      return c.json<GuideResponse>({ ok: true, guide: checked.value });
    },
  );
  return app;
}
