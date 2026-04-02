import { Database } from "bun:sqlite";
import path from "path";

const DB_PATH = path.join(process.cwd(), "playmax.db");

export const CHAT_LIST_TTL_MS = +(process.env.CHAT_LIST_TTL_MS ?? 86_400_000); // 1 day
export const CHAT_HISTORY_TTL_MS = +(
  process.env.CHAT_HISTORY_TTL_MS ?? 300_000
); // 5 min

function openDb(): Database {
  const db = new Database(DB_PATH);
  db.exec(`
    CREATE TABLE IF NOT EXISTS chats (
      id       TEXT PRIMARY KEY,
      name     TEXT NOT NULL,
      url      TEXT NOT NULL,
      added_at INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS messages (
      id       INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id  TEXT NOT NULL,
      date     TEXT,
      time     TEXT,
      author   TEXT,
      text     TEXT,
      added_at INTEGER NOT NULL DEFAULT 0,
      UNIQUE(chat_id, date, time, text)
    );
  `);
  // migrate existing tables that may lack columns
  for (const sql of [
    "ALTER TABLE chats ADD COLUMN added_at INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE chats ADD COLUMN synced_at INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE messages ADD COLUMN added_at INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE messages ADD COLUMN is_analyzed INTEGER NOT NULL DEFAULT 0",
  ]) {
    try {
      db.exec(sql);
    } catch {}
  }
  // Migrate UNIQUE constraint from (chat_id, date, time, text) to (chat_id, date, text)
  // so that time variations (e.g. read receipts appended to time field) don't create
  // duplicate rows that reset is_analyzed to 0.
  const hasNewIndex = db
    .query<{ name: string }, []>(
      "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_messages_unique'",
    )
    .get();
  if (!hasNewIndex) {
    db.exec(`
      BEGIN;
      CREATE TABLE messages_new (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        chat_id     TEXT NOT NULL,
        date        TEXT,
        time        TEXT,
        author      TEXT,
        text        TEXT,
        added_at    INTEGER NOT NULL DEFAULT 0,
        is_analyzed INTEGER NOT NULL DEFAULT 0,
        UNIQUE(chat_id, date, text)
      );
      INSERT OR IGNORE INTO messages_new (id, chat_id, date, time, author, text, added_at, is_analyzed)
        SELECT id, chat_id, date, time, author, text, added_at, is_analyzed FROM messages;
      DROP TABLE messages;
      ALTER TABLE messages_new RENAME TO messages;
      CREATE INDEX idx_messages_unique ON messages(chat_id, date, text);
      COMMIT;
    `);
  }
  return db;
}

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

export function isChatsStale(ttlMs: number): boolean {
  const db = openDb();
  const row = db
    .query<
      { maxAt: number | null },
      []
    >("SELECT MAX(added_at) AS maxAt FROM chats")
    .get();
  db.close();
  if (!row || row.maxAt === null || row.maxAt === 0) return true;
  return (nowSec() - row.maxAt) * 1000 > ttlMs;
}

export function isChatHistoryStale(chatId: string, ttlMs: number): boolean {
  const db = openDb();
  const row = db
    .query<{ syncedAt: number | null }, [string]>(
      "SELECT synced_at AS syncedAt FROM chats WHERE id = ?",
    )
    .get(chatId);
  db.close();
  if (!row || row.syncedAt === null || row.syncedAt === 0) return true;
  return (nowSec() - row.syncedAt) * 1000 > ttlMs;
}

export function markChatSynced(chatId: string): void {
  const db = openDb();
  db.prepare("UPDATE chats SET synced_at = ? WHERE id = ?").run(
    nowSec(),
    chatId,
  );
  db.close();
}

export function getChats(): { id: string; name: string; url: string }[] {
  const db = openDb();
  const rows = db
    .query<
      { id: string; name: string; url: string },
      []
    >("SELECT id, name, url FROM chats ORDER BY rowid")
    .all();
  db.close();
  return rows;
}

export function getChatMessages(
  chatId: string,
): { date: string; time: string; author: string; text: string }[] {
  const db = openDb();
  const rows = db
    .query<
      { date: string; time: string; author: string; text: string },
      [string]
    >("SELECT date, time, author, text FROM messages WHERE chat_id = ? ORDER BY id")
    .all(chatId);
  db.close();
  return rows;
}

export function saveChats(
  chats: { id: string; name: string; url: string }[],
): void {
  const db = openDb();
  const stmt = db.prepare(
    "INSERT INTO chats (id, name, url, added_at) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET name=excluded.name, url=excluded.url, added_at=excluded.added_at",
  );
  const now = nowSec();
  for (const c of chats) {
    try {
      stmt.run(c.id, c.name, c.url, now);
    } catch (e) {
      process.stderr.write(`DB error saving chat ${c.id}: ${e}\n`);
    }
  }
  db.close();
}

export function getUnanalyzedMessages(): {
  chat_id: string;
  date: string;
  time: string;
  author: string;
  text: string;
}[] {
  const db = openDb();
  const rows = db
    .query<
      {
        chat_id: string;
        date: string;
        time: string;
        author: string;
        text: string;
      },
      []
    >("SELECT chat_id, date, time, author, text FROM messages WHERE is_analyzed = 0 ORDER BY chat_id, id")
    .all();
  db.close();
  return rows;
}

export function markAnalyzed(chatId: string): void {
  const db = openDb();
  db.prepare(
    "UPDATE messages SET is_analyzed = 1 WHERE chat_id = ? AND is_analyzed = 0",
  ).run(chatId);
  db.close();
}

export function getLatestMessageDate(chatId: string): string | null {
  const db = openDb();
  const row = db
    .query<{ maxDate: string | null }, [string]>(
      "SELECT MAX(date) AS maxDate FROM messages WHERE chat_id = ? AND date != ''",
    )
    .get(chatId);
  db.close();
  return row?.maxDate ?? null;
}

export function saveMessages(
  chatId: string,
  messages: {
    date: string | null;
    time: string;
    author: string;
    text: string;
  }[],
): void {
  const db = openDb();
  // ON CONFLICT: update time/author/added_at but never is_analyzed,
  // so re-syncing already-analyzed messages doesn't reset their status.
  const stmt = db.prepare(
    `INSERT INTO messages (chat_id, date, time, author, text, added_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(chat_id, date, text) DO UPDATE SET
       time     = excluded.time,
       author   = excluded.author,
       added_at = excluded.added_at`,
  );
  const now = nowSec();
  for (const m of messages) {
    if (!m.date || !m.text) continue;
    try {
      stmt.run(chatId, m.date, m.time, m.author, m.text, now);
    } catch (e) {
      process.stderr.write(`DB error saving message: ${e}\n`);
    }
  }
  db.close();
}
