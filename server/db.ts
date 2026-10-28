import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

// Local storage, one SQLite file inside the app's /data volume (./data in
// development). Phase 1 keeps snapshots of what it read from Home Assistant;
// later phases compare against the last snapshot to tell which side changed.

const MIGRATIONS: string[] = [
  `CREATE TABLE IF NOT EXISTS snapshots (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     taken_at TEXT NOT NULL,
     ha_version TEXT,
     counts TEXT NOT NULL,
     raw TEXT NOT NULL
   )`,
  // 0.2: the change list (see server/changes/store.ts).
  `CREATE TABLE IF NOT EXISTS changes (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     kind TEXT NOT NULL,
     op TEXT NOT NULL,
     target_id TEXT NOT NULL,
     scope TEXT,
     before TEXT NOT NULL,
     after TEXT NOT NULL,
     created_at TEXT NOT NULL
   )`,
  // 0.3: app settings (naming), one JSON value per key.
  `CREATE TABLE IF NOT EXISTS settings (
     key TEXT PRIMARY KEY,
     value TEXT NOT NULL
   )`,
  // 0.5: what each AI call used and cost (server/ai/ledger.ts). Counts only,
  // never the prompt or the answer.
  `CREATE TABLE IF NOT EXISTS ai_usage (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     at TEXT NOT NULL,
     job TEXT NOT NULL,
     provider TEXT NOT NULL,
     model TEXT NOT NULL,
     input_tokens INTEGER NOT NULL,
     output_tokens INTEGER NOT NULL,
     cost_usd REAL
   );
   CREATE INDEX IF NOT EXISTS ai_usage_at ON ai_usage (at)`,
  `CREATE TABLE IF NOT EXISTS setting_revisions (path TEXT PRIMARY KEY, revision INTEGER NOT NULL);
   CREATE TABLE IF NOT EXISTS apply_runs (
     id INTEGER PRIMARY KEY AUTOINCREMENT, started_at TEXT NOT NULL, finished_at TEXT,
     status TEXT NOT NULL, pending TEXT NOT NULL, backup TEXT, results TEXT NOT NULL DEFAULT '[]', error TEXT
   );
   CREATE TABLE IF NOT EXISTS repairs (
     id INTEGER PRIMARY KEY AUTOINCREMENT, run_id INTEGER NOT NULL REFERENCES apply_runs(id),
     change_id INTEGER, message TEXT NOT NULL, created_at TEXT NOT NULL, acknowledged_at TEXT
   );
   CREATE INDEX IF NOT EXISTS repairs_open ON repairs(acknowledged_at, id);`,
  // Separate decision-service ledger: counts only, never notes, answers or keys.
  `CREATE TABLE IF NOT EXISTS jev_usage (
     id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, job TEXT NOT NULL,
     model TEXT NOT NULL, status TEXT NOT NULL, input_tokens INTEGER,
     output_tokens INTEGER, estimated_usd REAL
   ); CREATE INDEX IF NOT EXISTS jev_usage_at ON jev_usage(at);`,
];

const KEEP_SNAPSHOTS = 10;

export type Store = {
  db: DatabaseSync;
  saveSnapshot(input: { takenAt: string; haVersion: string | null; counts: unknown; raw: unknown }): number;
  latestSnapshot(): { id: number; takenAt: string; raw: unknown } | null;
  close(): void;
};

export function openStore(dir: string): Store {
  mkdirSync(dir, { recursive: true });
  const db = new DatabaseSync(join(dir, "taxis.db"));
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)");
  const row = db.prepare("SELECT version FROM schema_version").get() as { version: number } | undefined;
  let version = row?.version ?? 0;
  if (!row) db.prepare("INSERT INTO schema_version (version) VALUES (0)").run();
  while (version < MIGRATIONS.length) {
    db.exec(MIGRATIONS[version]);
    version += 1;
    db.prepare("UPDATE schema_version SET version = ?").run(version);
  }

  const insert = db.prepare(
    "INSERT INTO snapshots (taken_at, ha_version, counts, raw) VALUES (?, ?, ?, ?)",
  );
  const prune = db.prepare(
    "DELETE FROM snapshots WHERE id NOT IN (SELECT id FROM snapshots ORDER BY id DESC LIMIT ?)",
  );
  const latest = db.prepare("SELECT id, taken_at, raw FROM snapshots ORDER BY id DESC LIMIT 1");

  return {
    db,
    saveSnapshot({ takenAt, haVersion, counts, raw }) {
      const result = insert.run(takenAt, haVersion, JSON.stringify(counts), JSON.stringify(raw));
      prune.run(KEEP_SNAPSHOTS);
      return Number(result.lastInsertRowid);
    },
    latestSnapshot() {
      const r = latest.get() as { id: number; taken_at: string; raw: string } | undefined;
      return r ? { id: r.id, takenAt: r.taken_at, raw: JSON.parse(r.raw) } : null;
    },
    close() {
      db.close();
    },
  };
}
