import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { dbPath, baseDir } from './paths.js';

export type DbEventRow = {
  id: string;
  kind: number;
  pubkey: string;
  created_at: number;
  content: string;
  tags_json: string;
  sig: string;
  raw_json: string;
  received_at: number;
};

export type PendingPublishRow = {
  id: string;
  event_json: string;
  try_count: number;
  last_error: string | null;
  next_retry_at: number;
};

export function openDb() {
  fs.mkdirSync(baseDir(), { recursive: true });
  fs.mkdirSync(path.dirname(dbPath()), { recursive: true });
  const db = new Database(dbPath());
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      kind INTEGER NOT NULL,
      pubkey TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      content TEXT NOT NULL,
      tags_json TEXT NOT NULL,
      sig TEXT NOT NULL,
      raw_json TEXT NOT NULL,
      received_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_events_pubkey_created_at
      ON events(pubkey, created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_events_kind_created_at
      ON events(kind, created_at DESC);

    CREATE TABLE IF NOT EXISTS pending_publish (
      id TEXT PRIMARY KEY,
      event_json TEXT NOT NULL,
      try_count INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      next_retry_at INTEGER NOT NULL
    );
  `);

  return db;
}

export function insertEventIfMissing(db: Database.Database, row: DbEventRow) {
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO events
      (id, kind, pubkey, created_at, content, tags_json, sig, raw_json, received_at)
    VALUES
      (@id, @kind, @pubkey, @created_at, @content, @tags_json, @sig, @raw_json, @received_at)
  `);
  stmt.run(row);
}

export function addPending(db: Database.Database, id: string, event_json: string, err?: string) {
  const now = Math.floor(Date.now() / 1000);
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO pending_publish
      (id, event_json, try_count, last_error, next_retry_at)
    VALUES
      (@id, @event_json, COALESCE((SELECT try_count FROM pending_publish WHERE id=@id), 0), @last_error, @next_retry_at)
  `);
  stmt.run({ id, event_json, last_error: err ?? null, next_retry_at: now });
}

export function bumpPending(db: Database.Database, id: string, last_error: string) {
  const row = db.prepare('SELECT try_count FROM pending_publish WHERE id=?').get(id) as { try_count: number } | undefined;
  const tryCount = (row?.try_count ?? 0) + 1;
  const backoff = Math.min(60 * 30, 2 ** Math.min(10, tryCount) ); // seconds
  const next = Math.floor(Date.now() / 1000) + backoff;

  db.prepare(`
    UPDATE pending_publish
    SET try_count=@try_count, last_error=@last_error, next_retry_at=@next_retry_at
    WHERE id=@id
  `).run({ id, try_count: tryCount, last_error, next_retry_at: next });
}

export function removePending(db: Database.Database, id: string) {
  db.prepare('DELETE FROM pending_publish WHERE id=?').run(id);
}

export function listDuePending(db: Database.Database, limit = 50): PendingPublishRow[] {
  const now = Math.floor(Date.now() / 1000);
  return db.prepare(`
    SELECT id, event_json, try_count, last_error, next_retry_at
    FROM pending_publish
    WHERE next_retry_at <= @now
    ORDER BY next_retry_at ASC
    LIMIT @limit
  `).all({ now, limit }) as PendingPublishRow[];
}

export function getRecentFeed(db: Database.Database, pubkeys: string[], limit = 50) {
  if (!pubkeys.length) return [] as DbEventRow[];
  const placeholders = pubkeys.map(() => '?').join(',');
  return db.prepare(`
    SELECT * FROM events
    WHERE kind IN (1,7) AND pubkey IN (${placeholders})
    ORDER BY created_at DESC
    LIMIT ?
  `).all(...pubkeys, limit) as DbEventRow[];
}
