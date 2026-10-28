import { Hono } from "hono";

import type { AppContext } from "../context.ts";
import { jevRoutes } from "../jev/routes.ts";

// A separate decision provider. No hierarchy or Home Assistant dependency is
// passed in: it cannot read or change the home.
export function jevPageRoutes(ctx: AppContext): Hono {
  const app = new Hono();
  app.route(
    "/",
    jevRoutes({
      settings: ctx.settings,
      ledger: ctx.jevLedger,
      protect: ctx.protectSecret ?? (() => {}),
      redact: ctx.redact,
    }),
  );
  return app;
}
