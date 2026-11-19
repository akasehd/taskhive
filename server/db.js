import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

const MIGRATIONS = [
  `CREATE TABLE users (
     id            INTEGER PRIMARY KEY,
     email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
     name          TEXT NOT NULL,
     password_hash TEXT NOT NULL,
     color         TEXT NOT NULL,
     created_at    INTEGER NOT NULL
   );
   CREATE TABLE sessions (
     token_hash TEXT PRIMARY KEY,
     user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     expires_at INTEGER NOT NULL
   );
   CREATE TABLE boards (
     id          INTEGER PRIMARY KEY,
     name        TEXT NOT NULL,
     owner_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     invite_code TEXT NOT NULL UNIQUE,
     created_at  INTEGER NOT NULL
   );
   CREATE TABLE members (
     board_id INTEGER NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
     user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     role     TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner','member')),
     PRIMARY KEY (board_id, user_id)
   );
   CREATE TABLE lists (
     id       INTEGER PRIMARY KEY,
     board_id INTEGER NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
     title    TEXT NOT NULL,
     position REAL NOT NULL
   );
   CREATE INDEX idx_lists_board ON lists(board_id, position);
   CREATE TABLE cards (
     id          INTEGER PRIMARY KEY,
     list_id     INTEGER NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
     title       TEXT NOT NULL,
     description TEXT NOT NULL DEFAULT '',
     assignee_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
     due_date    TEXT,
     label       TEXT CHECK (label IN ('red','amber','green','blue','violet') OR label IS NULL),
     position    REAL NOT NULL,
     created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
     created_at  INTEGER NOT NULL,
     updated_at  INTEGER NOT NULL
   );
   CREATE INDEX idx_cards_list ON cards(list_id, position);
   CREATE TABLE activity (
     id         INTEGER PRIMARY KEY,
     board_id   INTEGER NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
     user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
     message    TEXT NOT NULL,
     created_at INTEGER NOT NULL
   );
   CREATE INDEX idx_activity_board ON activity(board_id, created_at);`,
];

export function openDatabase(path) {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY)");
  const done = new Set(db.prepare("SELECT version FROM schema_migrations").all().map((r) => r.version));
  MIGRATIONS.forEach((sql, i) => {
    if (done.has(i + 1)) return;
    tx(db, () => {
      db.exec(sql);
      db.prepare("INSERT INTO schema_migrations (version) VALUES (?)").run(i + 1);
    });
  });
  return db;
}

export function tx(db, fn) {
  db.exec("BEGIN");
  try {
    const out = fn();
    db.exec("COMMIT");
    return out;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
