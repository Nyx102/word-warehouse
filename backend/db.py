"""SQLite layer: per-thread connections, schema, migrations."""

import sqlite3
import threading

from backend.config import DATA, DB_PATH

SCHEMA_VERSION = 3

DDL = """
CREATE TABLE IF NOT EXISTS files(
  id INTEGER PRIMARY KEY,
  path TEXT UNIQUE NOT NULL,
  source TEXT NOT NULL,
  lang TEXT NOT NULL,
  series INTEGER,
  volume TEXT,
  mtime REAL NOT NULL,
  size INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  indexed_at REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS chapters(
  id INTEGER PRIMARY KEY,
  file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  ord INTEGER NOT NULL,
  chapter_label TEXT,
  title TEXT,
  subtitle TEXT,
  subtitle_key TEXT,
  part_title TEXT,
  start_line INTEGER,
  end_line INTEGER
);
CREATE INDEX IF NOT EXISTS idx_chapters_file ON chapters(file_id, ord);
CREATE INDEX IF NOT EXISTS idx_chapters_key ON chapters(subtitle_key);

CREATE TABLE IF NOT EXISTS chunks(
  id INTEGER PRIMARY KEY,
  file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  chapter_id INTEGER REFERENCES chapters(id) ON DELETE SET NULL,
  ord INTEGER NOT NULL,
  kind TEXT NOT NULL DEFAULT 'body',
  lang TEXT NOT NULL,
  start_line INTEGER NOT NULL,
  end_line INTEGER NOT NULL,
  text TEXT NOT NULL,
  text_norm TEXT
);
CREATE INDEX IF NOT EXISTS idx_chunks_file ON chunks(file_id, ord);

CREATE VIRTUAL TABLE IF NOT EXISTS fts_en USING fts5(
  text, content='chunks', content_rowid='id',
  tokenize='unicode61 remove_diacritics 2'
);
CREATE VIRTUAL TABLE IF NOT EXISTS fts_cjk USING fts5(
  text, text_norm, content='chunks', content_rowid='id',
  tokenize='trigram'
);

CREATE TRIGGER IF NOT EXISTS chunks_ai_en AFTER INSERT ON chunks WHEN new.lang = 'en'
BEGIN
  INSERT INTO fts_en(rowid, text) VALUES (new.id, new.text);
END;
CREATE TRIGGER IF NOT EXISTS chunks_ai_cjk AFTER INSERT ON chunks WHEN new.lang != 'en'
BEGIN
  INSERT INTO fts_cjk(rowid, text, text_norm) VALUES (new.id, new.text, new.text_norm);
END;
CREATE TRIGGER IF NOT EXISTS chunks_ad_en AFTER DELETE ON chunks WHEN old.lang = 'en'
BEGIN
  INSERT INTO fts_en(fts_en, rowid, text) VALUES ('delete', old.id, old.text);
END;
CREATE TRIGGER IF NOT EXISTS chunks_ad_cjk AFTER DELETE ON chunks WHEN old.lang != 'en'
BEGIN
  INSERT INTO fts_cjk(fts_cjk, rowid, text, text_norm) VALUES ('delete', old.id, old.text, old.text_norm);
END;

CREATE TABLE IF NOT EXISTS threads(
  id INTEGER PRIMARY KEY,
  title TEXT,
  claude_session_id TEXT,
  created_at REAL,
  last_active REAL,
  archived INTEGER DEFAULT 0,
  pinned INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS messages(
  id INTEGER PRIMARY KEY,
  thread_id INTEGER NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  turn INTEGER NOT NULL,
  seq INTEGER NOT NULL,
  kind TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at REAL
);
CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages(thread_id, turn, seq);

CREATE TABLE IF NOT EXISTS flag_dismissals(
  content_sha256 TEXT NOT NULL,
  category TEXT NOT NULL,
  key TEXT NOT NULL,
  dismissed_at REAL,
  PRIMARY KEY(content_sha256, category, key)
);

CREATE TABLE IF NOT EXISTS ai_triage(
  category TEXT NOT NULL,
  key TEXT NOT NULL,
  context_sha256 TEXT NOT NULL,
  verdict TEXT NOT NULL,
  reason TEXT,
  judged_at REAL,
  PRIMARY KEY(category, key)
);

CREATE TABLE IF NOT EXISTS meta(k TEXT PRIMARY KEY, v TEXT);
"""

_local = threading.local()


def connect() -> sqlite3.Connection:
    """Per-thread connection with the pragmas the whole app relies on."""
    conn = getattr(_local, "conn", None)
    if conn is not None:
        return conn
    DATA.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    conn.execute("PRAGMA busy_timeout=5000")
    conn.execute("PRAGMA foreign_keys=ON")
    conn.executescript(DDL)
    cols = {r[1] for r in conn.execute("PRAGMA table_info(threads)")}
    if "model" not in cols:
        conn.execute("ALTER TABLE threads ADD COLUMN model TEXT")
    if "pinned" not in cols:
        conn.execute("ALTER TABLE threads ADD COLUMN pinned INTEGER DEFAULT 0")
    conn.execute("INSERT OR REPLACE INTO meta(k, v) VALUES ('schema_version', ?)",
                 (str(SCHEMA_VERSION),))
    conn.commit()
    _local.conn = conn
    return conn
