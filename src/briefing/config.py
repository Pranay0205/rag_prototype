"""Shared configuration. TODAY is the data world's date (CLAUDE.md), not the system clock."""

from datetime import date
from pathlib import Path

TODAY = date(2026, 11, 16)

ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = ROOT / "data"
STRUCTURED_DIR = DATA_DIR / "structured"
DOCS_DIR = DATA_DIR / "docs"
GOLDEN_DIR = ROOT / "golden"
VAR_DIR = ROOT / "var"
DB_PATH = VAR_DIR / "briefing.db"  # source data: rebuilt by every ingestion run
APP_DB_PATH = VAR_DIR / "app.db"  # user state (briefings, reviews, actions): survives re-ingestion
MODEL_CACHE = VAR_DIR / "models"
EMBED_MODEL = "BAAI/bge-small-en-v1.5"

CLEARANCE_ORDER = ["public", "internal", "confidential", "restricted"]
STALE_AFTER_DAYS = 180
