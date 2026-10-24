import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { readFileSync } from "node:fs";

import type { HealthResponse, Hierarchy, HierarchyResponse } from "../shared/types.ts";
import { dataDir, redact, resolveHaTarget, runMode } from "./config.ts";
import { openStore } from "./db.ts";
import { readRegistry } from "./ha/registry.ts";
import { HaSocket } from "./ha/socket.ts";
import { isAllowedPeer, normalizePeer } from "./ingress.ts";
import { log, setLogSecret } from "./log.ts";
import { buildHierarchy } from "./model/hierarchy.ts";

try {
  process.loadEnvFile(".env");
} catch {
  // No .env file: fine inside Home Assistant, where nothing is configured by hand.
}

const env = process.env;
const mode = runMode(env);
const version = env.TAXIS_VERSION ?? "dev";
const port = Number(env.PORT ?? 8099);
const target = resolveHaTarget(env);
const store = openStore(dataDir(env));
const ha = target.ok ? new HaSocket(target.target.wsUrl, target.target.token) : null;
const token = target.ok ? target.target.token : undefined;
setLogSecret(token);

const n = (v: number) => v.toLocaleString("en-US");

// A full read walks every registry; keep it for a short while so tab switches
// and reloads don't hit Home Assistant each time. Refresh bypasses it.
const CACHE_MS = 30_000;
let cache: { at: number; hierarchy: Hierarchy } | null = null;
let inFlight: Promise<Hierarchy> | null = null;

async function loadHierarchy(force: boolean): Promise<{ hierarchy: Hierarchy; cached: boolean }> {
  if (!ha) throw new Error(target.ok ? "Home Assistant is not configured." : target.reason);
  if (!force && cache && Date.now() - cache.at < CACHE_MS) return { hierarchy: cache.hierarchy, cached: true };
  inFlight ??= (async () => {
    const started = Date.now();
    const raw = await readRegistry(ha);
    const fetchedAt = new Date().toISOString();
    const hierarchy = buildHierarchy(raw, fetchedAt);
    const c = hierarchy.counts;
    log.info(
      `Read Home Assistant ${hierarchy.home.haVersion ?? ""} in ${Date.now() - started} ms: ` +
        `${n(c.floors)} floors, ${n(c.areas)} areas, ${n(c.devices)} devices, ` +
        `${n(c.entities)} entities (${n(c.disabledEntities)} disabled), ${n(c.unassigned)} not in any area`,
    );
    // Snapshots keep the registries only: live states are not configuration and
    // would make each snapshot several times larger. A failed save is logged but
    // doesn't fail the read: the hierarchy is still correct.
    try {
      const { states: _states, ...registries } = raw;
      store.saveSnapshot({ takenAt: fetchedAt, haVersion: hierarchy.home.haVersion, counts: c, raw: registries });
    } catch (e) {
      log.error("Saving the snapshot failed", e);
    }
    cache = { at: Date.now(), hierarchy };
    return hierarchy;
  })().finally(() => {
    inFlight = null;
  });
  return { hierarchy: await inFlight, cached: false };
}

const app = new Hono<{ Bindings: { incoming: { socket: { remoteAddress?: string } } } }>();

app.use("*", async (c, next) => {
  const peer = c.env.incoming.socket.remoteAddress;
  if (!isAllowedPeer(peer, mode)) {
    log.warn(`Refused a request from ${normalizePeer(peer) || "an unknown address"}: only Home Assistant's Ingress may connect`);
    return c.text("Forbidden", 403);
  }
  await next();
});

app.onError((e, c) => {
  log.error(`Request ${c.req.method} ${c.req.path} failed`, e);
  return c.text("Something went wrong in Taxis. See the app's log.", 500);
});

app.get("/api/health", (c) =>
  c.json<HealthResponse>({
    ok: true,
    version,
    mode,
    ha: target.ok ? { configured: true } : { configured: false, reason: target.reason },
  }),
);

app.get("/api/hierarchy", async (c) => {
  try {
    const { hierarchy, cached } = await loadHierarchy(c.req.query("refresh") === "1");
    return c.json<HierarchyResponse>({ ok: true, hierarchy, cached });
  } catch (e) {
    const message = redact(e instanceof Error ? e.message : String(e), token);
    log.error("Reading Home Assistant failed", message);
    return c.json<HierarchyResponse>({ ok: false, error: message }, 502);
  }
});

// The built web UI. Asset paths are relative, so the same files work at "/" in
// development and under Ingress's /api/hassio_ingress/<token>/ prefix.
app.use("/*", serveStatic({ root: "./dist/web" }));
app.get("*", (c) => {
  try {
    return c.html(readFileSync("./dist/web/index.html", "utf8"));
  } catch {
    return c.text("The web UI is not built. Run `npm run build`, or use `npm run dev`.", 404);
  }
});

// Inside Home Assistant the Ingress proxy reaches the app over the internal
// network, so it listens on every interface (and the peer check above limits who
// it answers). In development it holds data read with your own admin token, so
// it listens on this machine only unless HOST says otherwise.
const hostname = env.HOST ?? (mode === "app" ? "0.0.0.0" : "127.0.0.1");

serve({ fetch: app.fetch, port, hostname }, () => {
  log.info(`Taxis ${version} listening on ${hostname}:${port} (${mode} mode)`);
  if (!target.ok) log.warn(`Home Assistant: ${target.reason}`);
});

process.on("unhandledRejection", (e) => log.error("Unhandled error", e));
// After an uncaught exception the process state can't be trusted: log it and
// exit, as Node would, so the Supervisor shows the app as stopped.
process.on("uncaughtException", (e) => {
  log.error("Unexpected error, stopping", e);
  process.exit(1);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    ha?.close();
    store.close();
    process.exit(0);
  });
}
