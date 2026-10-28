import type { DatabaseSync } from "node:sqlite";

import type { ChangeStore } from "./changes/store.ts";
import type { applyHistory } from "./changes/history.ts";
import type { AiLedger } from "./ai/ledger.ts";
import type { AiService } from "./ai/service.ts";
import type { JevLedger } from "./jev/ledger.ts";
import type { HaTargetResult } from "./config.ts";
import type { HaReader } from "./ha/reader.ts";
import type { HaRest } from "./ha/rest.ts";
import type { HaSocket } from "./ha/socket.ts";
import type { BackupResult } from "./ha/supervisor.ts";
import type { AppLogger } from "./log.ts";
import type { SnapshotInput } from "./ha/reader.ts";
import type { settingsStore } from "./settings.ts";

// What createApp() needs from the outside. server/index.ts builds the real ones
// from the environment; a test builds fakes. Nothing in app.ts or the routes
// reads process.env, opens a database or connects anywhere by itself.

export type HaClient = Pick<HaSocket, "command" | "write">;
export type RestClient = Pick<HaRest, "request" | "get" | "post">;
export type SettingsStore = ReturnType<typeof settingsStore>;
export type ApplyHistory = ReturnType<typeof applyHistory>;

export type AppDeps = {
  // "app": inside Home Assistant (Ingress only, a backup before every write).
  // "dev": anywhere else.
  mode: "app" | "dev";
  version: string;
  // Where Home Assistant is, or why it can't be reached. Carries the token that
  // is kept out of every response and log line.
  target: HaTargetResult;
  // Null when Home Assistant is not configured.
  ha: HaClient | null;
  rest: RestClient | null;
  // The Supervisor's backup call. Only used in app mode.
  backup: (name: string) => Promise<BackupResult>;
  // The local database, and the stores built on it.
  db: DatabaseSync;
  settings: SettingsStore;
  changes: ChangeStore;
  history: ApplyHistory;
  saveSnapshot?: (input: SnapshotInput) => void;
  clock: () => number;
  logger: AppLogger;
  // Registers a secret (an AI key) with the logger so it is never written.
  protectSecret?: (secret: string) => void;
  // Where the built web UI is; null serves none (tests).
  webRoot?: string | null;
};

// What the route groups share, built once by createApp().
export type AppContext = AppDeps & {
  reader: HaReader;
  // Takes every secret out of a message (see redact.ts).
  redact: (text: string) => string;
  // An error's message, as safe to show.
  errorText: (e: unknown) => string;
  // The one AI service: pages that call a model share it.
  ai: AiService;
  aiLedger: AiLedger;
  jevLedger: JevLedger;
  // Why Home Assistant can't be used, for the 503 answers.
  notConfigured: string;
};
