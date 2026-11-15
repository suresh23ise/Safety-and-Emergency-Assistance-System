"""SQLite data layer for the Safety & Emergency Assistance System."""
from __future__ import annotations

import sqlite3
import threading
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"
DB_PATH = DATA_DIR / "safety.db"

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id            TEXT PRIMARY KEY,
    name          TEXT NOT NULL,
    email         TEXT NOT NULL UNIQUE,
    phone         TEXT NOT NULL DEFAULT '',
    role          TEXT NOT NULL CHECK (role IN ('person', 'guardian')),
    password_hash TEXT,
    password_salt TEXT,
    provider      TEXT NOT NULL DEFAULT 'password',
    avatar_hue    INTEGER NOT NULL DEFAULT 42,
    link_code     TEXT UNIQUE,
    created_at    TEXT NOT NULL,
    last_seen     TEXT
);

CREATE TABLE IF NOT EXISTS settings (
    user_id         TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    auto_share      INTEGER NOT NULL DEFAULT 1,
    share_seconds   INTEGER NOT NULL DEFAULT 5,
    checkin_minutes INTEGER NOT NULL DEFAULT 10,
    checkin_enabled INTEGER NOT NULL DEFAULT 1,
    theme           TEXT NOT NULL DEFAULT 'sunset',
    voice           INTEGER NOT NULL DEFAULT 1,
    text_scale      REAL NOT NULL DEFAULT 1.0,
    reduce_motion   INTEGER NOT NULL DEFAULT 0,
    high_contrast   INTEGER NOT NULL DEFAULT 0,
    sos_hold_ms     INTEGER NOT NULL DEFAULT 2000
);

CREATE TABLE IF NOT EXISTS links (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    person_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    guardian_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    UNIQUE (person_id, guardian_id)
);

CREATE TABLE IF NOT EXISTS locations (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    lat      REAL NOT NULL,
    lng      REAL NOT NULL,
    accuracy REAL NOT NULL DEFAULT 0,
    speed    REAL,
    heading  REAL,
    source   TEXT NOT NULL DEFAULT 'device',
    ts       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_locations_user_ts ON locations(user_id, ts);

CREATE TABLE IF NOT EXISTS status_updates (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    state   TEXT NOT NULL,
    note    TEXT NOT NULL DEFAULT '',
    source  TEXT NOT NULL DEFAULT 'manual',
    ts      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_status_user_ts ON status_updates(user_id, ts);

CREATE TABLE IF NOT EXISTS alerts (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type        TEXT NOT NULL,
    severity    TEXT NOT NULL,
    message     TEXT NOT NULL DEFAULT '',
    lat         REAL,
    lng         REAL,
    ts          TEXT NOT NULL,
    status      TEXT NOT NULL DEFAULT 'active',
    acked_by    TEXT,
    acked_at    TEXT,
    resolved_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_alerts_user_ts ON alerts(user_id, ts);

CREATE TABLE IF NOT EXISTS messages (
    id      TEXT PRIMARY KEY,
    from_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    to_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    text    TEXT NOT NULL,
    ts      TEXT NOT NULL,
    read_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages(from_id, to_id, ts);

CREATE TABLE IF NOT EXISTS checkin_requests (
    id          TEXT PRIMARY KEY,
    person_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    guardian_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    ts          TEXT NOT NULL,
    fulfilled_at TEXT
);

CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT
);
"""

_lock = threading.RLock()


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def connect() -> sqlite3.Connection:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH, check_same_thread=False, timeout=15)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def init() -> None:
    with _lock, connect() as conn:
        conn.executescript(SCHEMA)


def fetch_all(sql: str, params: tuple | list = ()) -> list[dict]:
    with _lock:
        conn = connect()
        try:
            rows = conn.execute(sql, params).fetchall()
            return [dict(r) for r in rows]
        finally:
            conn.close()


def fetch_one(sql: str, params: tuple | list = ()) -> dict | None:
    with _lock:
        conn = connect()
        try:
            row = conn.execute(sql, params).fetchone()
            return dict(row) if row else None
        finally:
            conn.close()


def execute(sql: str, params: tuple | list = ()) -> int:
    with _lock:
        conn = connect()
        try:
            cur = conn.execute(sql, params)
            conn.commit()
            return cur.lastrowid or 0
        finally:
            conn.close()


def executemany(sql: str, rows: list[tuple]) -> None:
    with _lock:
        conn = connect()
        try:
            conn.executemany(sql, rows)
            conn.commit()
        finally:
            conn.close()


def scalar(sql: str, params: tuple | list = ()):
    with _lock:
        conn = connect()
        try:
            row = conn.execute(sql, params).fetchone()
            return row[0] if row else None
        finally:
            conn.close()


def ensure_settings(user_id: str) -> dict:
    if not fetch_one("SELECT user_id FROM settings WHERE user_id = ?", (user_id,)):
        execute("INSERT OR IGNORE INTO settings (user_id) VALUES (?)", (user_id,))
    return fetch_one("SELECT * FROM settings WHERE user_id = ?", (user_id,)) or {}


def settings_for(user_id: str) -> dict:
    row = ensure_settings(user_id)
    return {
        "autoShare": bool(row.get("auto_share", 1)),
        "shareSeconds": int(row.get("share_seconds", 5)),
        "checkinMinutes": int(row.get("checkin_minutes", 10)),
        "checkinEnabled": bool(row.get("checkin_enabled", 1)),
        "theme": row.get("theme", "sunset"),
        "voice": bool(row.get("voice", 1)),
        "textScale": float(row.get("text_scale", 1)),
        "reduceMotion": bool(row.get("reduce_motion", 0)),
        "highContrast": bool(row.get("high_contrast", 0)),
        "sosHoldMs": int(row.get("sos_hold_ms", 2000)),
    }


def meta_get(key: str) -> str | None:
    row = fetch_one("SELECT value FROM meta WHERE key = ?", (key,))
    return row["value"] if row else None


def meta_set(key: str, value: str) -> None:
    execute("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", (key, value))
