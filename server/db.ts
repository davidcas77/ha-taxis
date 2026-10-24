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
