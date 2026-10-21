'use strict';
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const config = require('./config');

fs.mkdirSync(config.dataDir, { recursive: true });
const dbPath = path.join(config.dataDir, 'breed-a-life.db');
const db = new DatabaseSync(dbPath);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA synchronous = NORMAL;');

const cache = new Map();
function stmt(sql) {
  let s = cache.get(sql);
  if (!s) { s = db.prepare(sql); cache.set(sql, s); }
  return s;
}
const clean = (params) => params.map((p) => (p === undefined ? null : typeof p === 'boolean' ? (p ? 1 : 0) : p));

const all = (sql, ...params) => stmt(sql).all(...clean(params));
const get = (sql, ...params) => stmt(sql).get(...clean(params));
const run = (sql, ...params) => stmt(sql).run(...clean(params));

let txDepth = 0;
function tx(fn) {
  // Re-entrant: nested calls become savepoints so helpers can safely call each other.
  const outer = txDepth === 0;
  const name = `sp_${txDepth}`;
  db.exec(outer ? 'BEGIN IMMEDIATE' : `SAVEPOINT ${name}`);
  txDepth += 1;
  try {
    const r = fn();
    txDepth -= 1;
    db.exec(outer ? 'COMMIT' : `RELEASE ${name}`);
    return r;
  } catch (e) {
    txDepth -= 1;
    try { db.exec(outer ? 'ROLLBACK' : `ROLLBACK TO ${name}; RELEASE ${name}`); } catch { /* already rolled back */ }
    throw e;
  }
}

const MIGRATIONS = [
  // 1 — initial schema
  `
  CREATE TABLE users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
    email         TEXT NOT NULL DEFAULT '',
    password_hash TEXT NOT NULL,
    created_at    TEXT NOT NULL,
    last_login    TEXT
  );
  CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    ip         TEXT,
    user_agent TEXT
  );
  CREATE TABLE media (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    kind          TEXT NOT NULL CHECK (kind IN ('image','video')),
    source        TEXT NOT NULL DEFAULT 'upload' CHECK (source IN ('upload','embed')),
    filename      TEXT,
    original_name TEXT,
    mime          TEXT,
    size          INTEGER NOT NULL DEFAULT 0,
    title         TEXT NOT NULL DEFAULT '',
    alt           TEXT NOT NULL DEFAULT '',
    description   TEXT NOT NULL DEFAULT '',
    poster        TEXT,
    embed_id      TEXT,
    visible       INTEGER NOT NULL DEFAULT 1,
    created_at    TEXT NOT NULL
  );
  CREATE INDEX idx_media_kind ON media(kind, visible, created_at);
  CREATE TABLE posts (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    title           TEXT NOT NULL,
    slug            TEXT NOT NULL UNIQUE,
    excerpt         TEXT NOT NULL DEFAULT '',
    content         TEXT NOT NULL DEFAULT '',
    cover_id        INTEGER REFERENCES media(id) ON DELETE SET NULL,
    category        TEXT NOT NULL DEFAULT '',
    tags            TEXT NOT NULL DEFAULT '',
    status          TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published')),
    featured        INTEGER NOT NULL DEFAULT 0,
    seo_title       TEXT NOT NULL DEFAULT '',
    seo_description TEXT NOT NULL DEFAULT '',
    views           INTEGER NOT NULL DEFAULT 0,
    published_at    TEXT,
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL
  );
  CREATE INDEX idx_posts_pub ON posts(status, published_at);
  CREATE TABLE subscribers (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    email      TEXT NOT NULL UNIQUE COLLATE NOCASE,
    created_at TEXT NOT NULL
  );
  CREATE TABLE settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL DEFAULT ''
  );
  CREATE TABLE page_views (
    day   TEXT NOT NULL,
    path  TEXT NOT NULL,
    count INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (day, path)
  );
  CREATE TABLE activity (
    id     INTEGER PRIMARY KEY AUTOINCREMENT,
    ts     TEXT NOT NULL,
    actor  TEXT NOT NULL DEFAULT 'system',
    action TEXT NOT NULL,
    detail TEXT NOT NULL DEFAULT ''
  );
  CREATE INDEX idx_activity_ts ON activity(ts);
  `,
  // 2 — reader accounts (notes + progress), contact inbox, donation options
  `
  CREATE TABLE readers (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name          TEXT NOT NULL DEFAULT '',
    password_hash TEXT NOT NULL,
    created_at    TEXT NOT NULL,
    last_login    TEXT
  );
  CREATE TABLE reader_sessions (
    token_hash TEXT PRIMARY KEY,
    reader_id  INTEGER NOT NULL REFERENCES readers(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    ip         TEXT,
    user_agent TEXT
  );
  -- One row per reader per devotion: their private note AND their progress.
  -- post_id is nullable so a reader keeps their notes if a post is later deleted.
  CREATE TABLE reader_entries (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    reader_id    INTEGER NOT NULL REFERENCES readers(id) ON DELETE CASCADE,
    post_id      INTEGER REFERENCES posts(id) ON DELETE SET NULL,
    post_title   TEXT NOT NULL DEFAULT '',
    post_slug    TEXT NOT NULL DEFAULT '',
    body         TEXT NOT NULL DEFAULT '',
    percent      INTEGER NOT NULL DEFAULT 0,
    completed_at TEXT,
    last_read_at TEXT NOT NULL,
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL,
    UNIQUE (reader_id, post_id)
  );
  CREATE INDEX idx_entries_reader ON reader_entries(reader_id, last_read_at);
  CREATE TABLE reader_days (
    reader_id INTEGER NOT NULL REFERENCES readers(id) ON DELETE CASCADE,
    day       TEXT NOT NULL,
    PRIMARY KEY (reader_id, day)
  );
  CREATE TABLE messages (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL,
    email       TEXT NOT NULL,
    subject     TEXT NOT NULL DEFAULT '',
    body        TEXT NOT NULL,
    is_read     INTEGER NOT NULL DEFAULT 0,
    emailed     INTEGER NOT NULL DEFAULT 0,
    email_error TEXT NOT NULL DEFAULT '',
    created_at  TEXT NOT NULL
  );
  CREATE INDEX idx_messages_created ON messages(created_at);
  CREATE TABLE donation_methods (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    label      TEXT NOT NULL,
    url        TEXT NOT NULL DEFAULT '',
    details    TEXT NOT NULL DEFAULT '',
    note       TEXT NOT NULL DEFAULT '',
    visible    INTEGER NOT NULL DEFAULT 1,
    position   INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );
  `,
  // 3 — password reset links (admin + readers)
  `
  CREATE TABLE password_resets (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    kind       TEXT NOT NULL CHECK (kind IN ('admin','reader')),
    account_id INTEGER NOT NULL,
    email      TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    used_at    TEXT
  );
  CREATE INDEX idx_resets_account ON password_resets(kind, account_id);
  `,
];

function migrate() {
  let version = get('PRAGMA user_version').user_version;
  while (version < MIGRATIONS.length) {
    const sql = MIGRATIONS[version];
    tx(() => { db.exec(sql); db.exec(`PRAGMA user_version = ${version + 1}`); });
    version += 1;
  }
}
migrate();

function logActivity(actor, action, detail = '') {
  run('INSERT INTO activity (ts, actor, action, detail) VALUES (?,?,?,?)', new Date().toISOString(), actor || 'system', action, String(detail).slice(0, 500));
  run('DELETE FROM activity WHERE id <= (SELECT MAX(id) - 2000 FROM activity)');
}

// Separate read-only connection for the SQL console.
let roConn = null;
function readOnly() {
  if (!roConn) roConn = new DatabaseSync(dbPath, { readOnly: true });
  return roConn;
}

module.exports = { db, dbPath, all, get, run, tx, logActivity, readOnly };
