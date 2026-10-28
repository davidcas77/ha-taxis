import { serve } from "@hono/node-server";

import { AI_PROVIDERS } from "../shared/ai.ts";
import { createApp } from "./app.ts";
import { changeStore } from "./changes/store.ts";
import { applyHistory } from "./changes/history.ts";
import { dataDir, resolveHaTarget, runMode } from "./config.ts";
import { openStore } from "./db.ts";
import { HaRest } from "./ha/rest.ts";
import { HaSocket } from "./ha/socket.ts";
import { backupHomeAssistant } from "./ha/supervisor.ts";
import { addLogSecret, log, setLogSecret } from "./log.ts";
import { settingsStore } from "./settings.ts";

// The process entry: read the environment, build the real dependencies, hand
// them to createApp() and listen. Everything with logic lives in app.ts and
// what it uses, so it can be tested without a server, a database file or a
// Home Assistant.

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
const rest = target.ok ? new HaRest(target.target.restUrl, target.target.token) : null;
const token = target.ok ? target.target.token : undefined;
setLogSecret(token);
const settings = settingsStore(store.db);
// The AI keys are secrets too: never written to the log, whatever an error says.
for (const p of AI_PROVIDERS) addLogSecret(settings.aiKey(p));
addLogSecret(settings.jevKey());

const app = createApp({
  mode,
  version,
  target,
  ha,
  rest,
  // The Supervisor's backup, made with the same token Home Assistant is called with.
  backup: (name) => (token ? backupHomeAssistant(token, name) : Promise.resolve({ ok: false, reason: "No Supervisor token." })),
  db: store.db,
  settings,
  changes: changeStore(store.db),
  history: applyHistory(store.db),
  saveSnapshot: (input) => void store.saveSnapshot(input),
  clock: Date.now,
  logger: log,
  protectSecret: addLogSecret,
});

// Inside Home Assistant the Ingress proxy reaches the app over the internal
// network, so it listens on every interface (and the peer check in app.ts limits
// who it answers). In development it holds data read with your own admin token,
// so it listens on this machine only unless HOST says otherwise.
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
