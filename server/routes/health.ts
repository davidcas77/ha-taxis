import { Hono } from "hono";

import { runHealth, type HealthReportResponse } from "../../shared/health.ts";
import { roomLightControllers, type RoomLightControllersResponse } from "../../shared/health/lights.ts";
import type { HealthResponse } from "../../shared/types.ts";
import type { AppContext } from "../context.ts";
import { healthSnapshot } from "../health/assemble.ts";
import { publicChange } from "../changes/store.ts";

export function healthRoutes(ctx: AppContext): Hono {
  const { reader, settings, changes, ha, rest, target, mode, version } = ctx;
  const app = new Hono();

  // Is Taxis up, and can it reach Home Assistant at all?
  app.get("/health", (c) =>
    c.json<HealthResponse>({
      ok: true,
      version,
      mode,
      ha: target.ok ? { configured: true } : { configured: false, reason: target.reason },
    }),
  );

  app.get("/health/room-light-controllers", async (c) => {
    if (!ha || !rest) return c.json<RoomLightControllersResponse>({ ok: false, error: ctx.notConfigured }, 503);
    const areaId = c.req.query("area") ?? "";
    try {
      const { read } = await reader.read(false);
      if (!Object.hasOwn(read.live.areas, areaId)) return c.json<RoomLightControllersResponse>({ ok: false, error: "This room is no longer available." }, 404);
      const snapshot = await reader.references(read, false);
      return c.json<RoomLightControllersResponse>(
        roomLightControllers(
          {
            snapshot: healthSnapshot(read.raw, read.live, snapshot, null),
            inventory: settings.inventory(),
            naming: settings.naming(),
            parameters: settings.parameters(),
            changes: [],
            now: ctx.clock(),
          },
          areaId,
        ),
      );
    } catch (e) {
      const message = ctx.errorText(e);
      ctx.logger.error("Reading room light controllers failed", message);
      return c.json<RoomLightControllersResponse>({ ok: false, error: message }, 502);
    }
  });

  // Health: rule-based checks over the home as Home Assistant holds it (not the
  // preview): entities nothing answers for, references to what is gone, forgotten
  // automations, and the state of Taxis's own setup. Read-only: it reads what the
  // rest of Taxis reads, and a finding that has a fix only offers it as a change for
  // the user to add to the list. The snapshot is kept for a short while like the
  // other reads; Refresh (?refresh=1) reads again.
  app.get("/health/report", async (c) => {
    if (!ha || !rest) return c.json<HealthReportResponse>({ ok: false, error: ctx.notConfigured }, 503);
    const refresh = c.req.query("refresh") === "1";
    const num = (name: string) => (c.req.query(name) ? Number(c.req.query(name)) : undefined);
    try {
      const { read, cached } = await reader.read(refresh);
      const snap = await reader.references(read, refresh);
      const blueprints = await reader.blueprints(read, refresh);
      const report = runHealth({
        snapshot: healthSnapshot(read.raw, read.live, snap, blueprints),
        inventory: settings.inventory(),
        naming: settings.naming(),
        parameters: settings.parameters(),
        changes: changes.list().map(publicChange),
        now: ctx.clock(),
        options: { unavailableHours: num("unavailableHours"), staleDays: num("staleDays") },
      });
      return c.json<HealthReportResponse>({ ok: true, report, cached: cached && !refresh });
    } catch (e) {
      const message = ctx.errorText(e);
      ctx.logger.error("Running the health checks failed", message);
      return c.json<HealthReportResponse>({ ok: false, error: message }, 502);
    }
  });

  return app;
}
