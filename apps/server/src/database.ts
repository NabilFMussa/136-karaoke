import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

export interface DatabaseHandle {
  connection: DatabaseSync;
  path: string;
}

export function openDatabase(configuredPath: string): DatabaseHandle {
  const databasePath = configuredPath === ":memory:" ? configuredPath : resolve(configuredPath);

  if (databasePath !== ":memory:") {
    mkdirSync(dirname(databasePath), { recursive: true });
  }

  const connection = new DatabaseSync(databasePath);
  connection.exec("PRAGMA foreign_keys = ON;");
  connection.exec("PRAGMA journal_mode = WAL;");
  connection.exec(`
    CREATE TABLE IF NOT EXISTS schema_metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  connection.prepare(`
    INSERT INTO schema_metadata (key, value)
    VALUES ('schema_version', '3')
    ON CONFLICT(key) DO NOTHING
  `).run();

  connection.exec(`
    CREATE TABLE IF NOT EXISTS queue_entries (
      id TEXT PRIMARY KEY,
      video_id TEXT NOT NULL,
      title TEXT NOT NULL,
      artist TEXT NOT NULL,
      brand TEXT NOT NULL DEFAULT '',
      singer_name TEXT NOT NULL,
      position INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued' CHECK (status = 'queued'),
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_queue_entries_position ON queue_entries(position, created_at);
    CREATE TABLE IF NOT EXISTS playback_history (
      id INTEGER PRIMARY KEY,
      video_id TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      artist TEXT NOT NULL,
      brand TEXT NOT NULL DEFAULT '',
      played_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_playback_history_recent ON playback_history(id DESC);
    UPDATE schema_metadata SET value = '3', updated_at = CURRENT_TIMESTAMP WHERE key = 'schema_version';
  `);

  return { connection, path: databasePath };
}

export function assertDatabaseConnected(connection: DatabaseSync): void {
  const result = connection.prepare("SELECT 1 AS ready").get() as { ready?: number } | undefined;
  if (result?.ready !== 1) {
    throw new Error("SQLite readiness query failed");
  }
}
