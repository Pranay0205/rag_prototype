"""SQLite access helpers. One file database at config.DB_PATH."""

import json
import sqlite3
from pathlib import Path

from briefing.config import DB_PATH


def connect(path: Path = DB_PATH) -> sqlite3.Connection:
    conn = sqlite3.connect(path, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def rows(conn: sqlite3.Connection, sql: str, params: tuple | dict = ()) -> list[dict]:
    """Run a parameterized query and return plain dicts."""
    return [dict(r) for r in conn.execute(sql, params).fetchall()]


def jlist(value: str | None) -> list[str]:
    """Decode a JSON list column (lists are stored as JSON text)."""
    return json.loads(value) if value else []
