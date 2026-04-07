import { afterAll, beforeEach, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { createHash } from "crypto";
import fs from "fs";
import os from "os";
import path from "path";

const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "playmax-db-"));
process.env.PLAYMAX_STATE_DIR = stateDir;

const { saveMessages, getUnanalyzedMessages, markAnalyzed } = await import("../db");

const dbPath = path.join(stateDir, "playmax.db");

function resetDb(): void {
  for (const entry of ["playmax.db", "playmax.db-shm", "playmax.db-wal"]) {
    try {
      fs.rmSync(path.join(stateDir, entry));
    } catch {}
  }
}

beforeEach(() => {
  resetDb();
});

afterAll(() => {
  fs.rmSync(stateDir, { recursive: true, force: true });
});

test("markAnalyzed updates only the selected message ids", () => {
  saveMessages("chat-1", [
    {
      date: "2026-04-08",
      time: "10:00",
      author: "Alice",
      text: "first",
      imagePath: null,
    },
    {
      date: "2026-04-08",
      time: "10:01",
      author: "Alice",
      text: "second",
      imagePath: null,
    },
  ]);

  const before = getUnanalyzedMessages().filter((message) => message.chat_id === "chat-1");
  expect(before).toHaveLength(2);

  markAnalyzed([before[1].id]);

  const after = getUnanalyzedMessages().filter((message) => message.chat_id === "chat-1");
  expect(after).toHaveLength(1);
  expect(after[0]?.id).toBe(before[0]?.id);
  expect(after[0]?.text).toBe("first");
});

test("normalization deduplicates legacy and hashed keys without losing analyzed status", () => {
  const chatId = "chat-legacy";
  const date = "2026-04-08";
  const time = "12:34";
  const author = "Teacher";
  const text = "Reminder";
  const legacyKey = `${date}|${time}|${author}|${text}`;
  const hashedKey = createHash("sha1")
    .update(
      JSON.stringify({
        chatId,
        date,
        time,
        author,
        text,
        imagePath: "",
      }),
    )
    .digest("hex");

  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE messages (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id     TEXT NOT NULL,
      date        TEXT,
      time        TEXT,
      author      TEXT,
      text        TEXT,
      content_key TEXT NOT NULL,
      image_path  TEXT,
      added_at    INTEGER NOT NULL DEFAULT 0,
      is_analyzed INTEGER NOT NULL DEFAULT 0,
      UNIQUE(chat_id, content_key)
    );
  `);

  const insert = db.prepare(
    `INSERT INTO messages (
      chat_id,
      date,
      time,
      author,
      text,
      content_key,
      image_path,
      added_at,
      is_analyzed
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  insert.run(chatId, date, time, author, text, legacyKey, null, 100, 1);
  insert.run(chatId, date, time, author, text, hashedKey, null, 200, 0);
  db.close();

  const unanalyzed = getUnanalyzedMessages().filter(
    (message) => message.chat_id === chatId,
  );
  expect(unanalyzed).toHaveLength(0);

  const verifyDb = new Database(dbPath, { readonly: true });
  const countRow = verifyDb
    .query<{ count: number }, []>("SELECT COUNT(*) AS count FROM messages")
    .get();
  const savedRow = verifyDb
    .query<{ is_analyzed: number; content_key: string }, []>(
      "SELECT is_analyzed, content_key FROM messages WHERE chat_id = ?",
    )
    .get(chatId);
  verifyDb.close();

  expect(countRow?.count).toBe(1);
  expect(savedRow?.is_analyzed).toBe(1);
  expect(savedRow?.content_key).toBe(legacyKey);
});
