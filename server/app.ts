import { Hono } from "hono";

import { aiService } from "./ai/service.ts";
import { aiLedger } from "./ai/ledger.ts";
import type { AppContext, AppDeps } from "./context.ts";
import { requireTaxisHeader } from "./guard.ts";
import { HaReader } from "./ha/reader.ts";
import { isAllowedPeer, normalizePeer } from "./ingress.ts";
import { jevLedger } from "./jev/ledger.ts";
import { secretRedactor } from "./redact.ts";
import { aiPageRoutes } from "./routes/ai.ts";
import { applyRoutes } from "./routes/apply.ts";
import { changeRoutes } from "./routes/changes.ts";
import { healthRoutes } from "./routes/health.ts";
import { hierarchyRoutes } from "./routes/hierarchy.ts";
import { jevPageRoutes } from "./routes/jev.ts";
import { referenceRoutes } from "./routes/references.ts";
import { settingsRoutes } from "./routes/settings.ts";
import { uiRoutes } from "./routes/ui.ts";
import { settingsConcurrency } from "./settings-concurrency.ts";

// What Node's server puts in the request environment; absent when a test calls
// app.request() without one.
type Bindings = { incoming?: { socket?: { remoteAddress?: string } } };

// The whole HTTP app, built from what it is handed. No environment variables, no
// database file, no network connection is opened here: server/index.ts supplies
// the real ones, and a test supplies fakes (see app.test.ts).
export function createApp(deps: AppDeps): Hono<{ Bindings: Bindings }> {
  const token = deps.target.ok ? deps.target.target.token : undefined;
  const redact = secretRedactor(token, deps.settings);
  const aiUsage = aiLedger(deps.db);
  const ctx: AppContext = {
    ...deps,
    reader: new HaReader({
      ha: deps.ha,
      rest: deps.rest,
      notConfigured: deps.target.ok ? "Home Assistant is not configured." : deps.target.reason,
      clock: deps.clock,
      logger: deps.logger,
      saveSnapshot: deps.saveSnapshot,
    }),
    redact,
    errorText: (e) => redact(e instanceof Error ? e.message : String(e)),
    ai: aiService({ settings: deps.settings, ledger: aiUsage }),
    aiLedger: aiUsage,
    jevLedger: jevLedger(deps.db),
    notConfigured: deps.target.ok ? "Home Assistant is not configured." : deps.target.reason,
  };

  const app = new Hono<{ Bindings: Bindings }>();

  // Inside Home Assistant only Ingress may connect (ingress.ts). A request with no
  // peer address at all is refused there too.
  app.use("*", async (c, next) => {
    const peer = c.env?.incoming?.socket?.remoteAddress;
    if (!isAllowedPeer(peer, deps.mode)) {
      deps.logger.warn(`Refused a request from ${normalizePeer(peer) || "an unknown address"}: only Home Assistant's Ingress may connect`);
      return c.text("Forbidden", 403);
    }
    await next();
  });

  // Changes arrive through Ingress only (above). On top of that, every request
  // that changes something must carry this header, which a form on another
  // website can't add: a simple guard against cross-site requests.
  app.use("/api/*", requireTaxisHeader);
  app.use("/api/settings/*", settingsConcurrency(deps.db));

  app.onError((e, c) => {
    deps.logger.error(`Request ${c.req.method} ${c.req.path} failed`, e);
    return c.text("Something went wrong in Taxis. See the app's log.", 500);
  });

  app.route("/api", healthRoutes(ctx));
  app.route("/api", hierarchyRoutes(ctx));
  app.route("/api", changeRoutes(ctx));
  app.route("/api", settingsRoutes(ctx));
  app.route("/api", aiPageRoutes(ctx));
  app.route("/api", jevPageRoutes(ctx));
  app.route("/api", referenceRoutes(ctx));
  app.route("/api", applyRoutes(ctx));
  if (deps.webRoot !== null) app.route("/", uiRoutes(deps.webRoot ?? "./dist/web"));

  return app;
}
