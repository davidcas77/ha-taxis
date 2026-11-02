import { Hono } from "hono";

import { aiRoutes } from "../ai/routes.ts";
import { assistantRoutes } from "../ai/assistant.ts";
import { assistantContext } from "../ai/assistant-context.ts";
import { previewHierarchy } from "../changes/preview.ts";
import { buttonRoutes } from "../buttons/routes.ts";
import type { AppContext } from "../context.ts";

// Everything that can call an AI model, and the pages built on it: the AI
// settings, Ask Taxis and the button review. None of them has a write path to
// Home Assistant; the button page only queues a change for the user to apply.
export function aiPageRoutes(ctx: AppContext): Hono {
  const { reader, settings, changes, db } = ctx;
  const app = new Hono();
  const protect = ctx.protectSecret ?? (() => {});

  // Optional AI: its settings (never the key), the models a service offers, a test
  // call and this month's usage.
  app.route("/", aiRoutes({ settings, ledger: ctx.aiLedger, service: ctx.ai, protect, redact: ctx.redact }));

  app.route(
    "/",
    buttonRoutes({
      read: (refresh) => reader.buttons(refresh),
      changes,
      directContext: ctx,
      applying: () => reader.isApplying(),
      reviewRevision: () =>
        settings.general().reviewChangesBeforeApplying
          ? String(
              (db.prepare("SELECT revision FROM setting_revisions WHERE path = ?").get("/api/settings/general") as { revision: number } | undefined)
                ?.revision ?? 0,
            )
          : null,
      ai: ctx.ai,
      redact: ctx.redact,
    }),
  );

  app.route(
    "/",
    assistantRoutes({
      db,
      settings,
      service: ctx.ai,
      ledger: ctx.aiLedger,
      jevLedger: ctx.jevLedger,
      redact: ctx.redact,
      context: async (scope) => {
        const h = scope.includeData ? previewHierarchy((await reader.read(false)).read, changes.list()) : null;
        return assistantContext(scope, h, changes.list(), settings, ctx.redact);
      },
    }),
  );

  return app;
}
