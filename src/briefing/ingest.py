"""Ingestion & unification (specs/02-ingestion.md). Deterministic, no LLM calls.

Run: uv run python -m briefing.ingest
Rebuilds var/briefing.db from data/ and writes var/ingestion_report.json.
"""

import csv
import hashlib
import json
import re
import time
from collections import Counter
from datetime import date, datetime, timedelta
from pathlib import Path

import yaml
from rapidfuzz import fuzz

from briefing import config
from briefing.db import connect
from briefing.entities import EntityResolver

# ---------------------------------------------------------------- ING-1 load structured

LIST_COLUMNS = {"groups", "access_groups", "our_attendees", "client_attendees"}
BOOL_COLUMNS = {"is_primary", "is_active"}
INT_COLUMNS = {"revenue_usd", "notional_usd", "est_revenue_usd", "probability_pct"}
FLOAT_COLUMNS = {"company_revenue_usd_m", "ebitda_margin_pct", "net_leverage_x"}
# DATA-3: tables whose rows carry sensitivity; missing columns default to internal / no groups
SENSITIVE_TABLES = {"opportunities", "service_issues"}


def _sql_type(col: str) -> str:
    if col in INT_COLUMNS or col in BOOL_COLUMNS:
        return "INTEGER"
    if col in FLOAT_COLUMNS:
        return "REAL"
    return "TEXT"


def _parse(col: str, raw: str):
    raw = raw.strip()
    if col in LIST_COLUMNS:
        return json.dumps([x.strip() for x in raw.split(";") if x.strip()])
    if raw == "":
        return None
    if col in BOOL_COLUMNS:
        return 1 if raw.lower() == "true" else 0
    if col in INT_COLUMNS:
        return int(raw)
    if col in FLOAT_COLUMNS:
        return float(raw)
    return raw


def load_structured(conn, report: dict) -> None:
    """ING-1: every CSV becomes a table named after the file."""
    counts = {}
    for path in sorted(config.STRUCTURED_DIR.glob("*.csv")):
        table = path.stem
        with path.open(newline="") as f:
            reader = csv.DictReader(f)
            cols = list(reader.fieldnames or [])
            records = list(reader)
        if table in SENSITIVE_TABLES:
            for col in ("classification", "access_groups"):
                if col not in cols:
                    cols.append(col)
        extra = ["source_client_id"] if "client_id" in cols and table != "clients" else []
        ddl = ", ".join(f'"{c}" {_sql_type(c)}' for c in cols + extra)
        conn.execute(f'CREATE TABLE "{table}" ({ddl})')
        for rec in records:
            values = [_parse(c, rec.get(c) or "") for c in cols]
            if table in SENSITIVE_TABLES and values[cols.index("classification")] is None:
                values[cols.index("classification")] = "internal"
            if extra:
                values.append(rec["client_id"])
            conn.execute(f'INSERT INTO "{table}" VALUES ({", ".join("?" * len(values))})', values)
        counts[table] = len(records)
    report["tables"] = counts


# ---------------------------------------------------------------- ING-2 client master unification


def merge_clients(conn, report: dict) -> dict[str, str]:
    """ING-2: same LEI -> one client. Survivor = earliest created_date. Returns merged->survivor map."""
    conn.execute("CREATE TABLE client_merge (merged_id TEXT, survivor_id TEXT, rule TEXT, evidence TEXT)")
    client_tables = [
        r[0]
        for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")
        if r[0] not in ("clients", "client_merge")
        and "client_id" in [c[1] for c in conn.execute(f'PRAGMA table_info("{r[0]}")')]
    ]
    by_lei: dict[str, list] = {}
    for r in conn.execute("SELECT * FROM clients ORDER BY created_date, client_id"):
        by_lei.setdefault(r["lei"], []).append(dict(r))

    merge_map: dict[str, str] = {}
    for lei, members in by_lei.items():
        survivor = members[0]
        for m in members[1:]:
            sid, mid = survivor["client_id"], m["client_id"]
            merge_map[mid] = sid
            evidence = {
                "lei": lei,
                "survivor_created": survivor["created_date"],
                "merged_created": m["created_date"],
                "merged_legal_name": m["legal_name"],
                "merged_industry": m["industry"],
            }
            conn.execute(
                "INSERT INTO client_merge VALUES (?,?,?,?)",
                (mid, sid, "same LEI; survivor = earliest created_date", json.dumps(evidence)),
            )
            for t in client_tables:
                conn.execute(f'UPDATE "{t}" SET client_id=? WHERE client_id=?', (sid, mid))
            for name in {m["legal_name"], m["short_name"]}:
                conn.execute(
                    "INSERT INTO client_aliases (alias, client_id, source) VALUES (?,?,?)",
                    (name, sid, f"merge:{mid}"),
                )
            conn.execute("DELETE FROM clients WHERE client_id=?", (mid,))

    # Rows that became exact duplicates after the rewrite (e.g. coverage C-007/alex -> C-002/alex)
    conn.execute(
        """
        DELETE FROM coverage
        WHERE rowid NOT IN (SELECT MIN(rowid) FROM coverage GROUP BY client_id, user_id)
        """
    )
    conn.execute(
        """
        DELETE FROM client_aliases
        WHERE rowid NOT IN (SELECT MIN(rowid) FROM client_aliases GROUP BY lower(alias), client_id)
        """
    )
    # Same person recorded under both records: keep the survivor's contact
    dup_contacts = [
        dict(r)
        for r in conn.execute(
            """SELECT c.contact_id, c.name, c.source_client_id FROM contacts c
           WHERE c.source_client_id != c.client_id AND EXISTS (
             SELECT 1 FROM contacts s WHERE s.client_id = c.client_id
               AND lower(s.name) = lower(c.name) AND s.source_client_id = s.client_id)"""
        )
    ]
    for d in dup_contacts:
        conn.execute("DELETE FROM contacts WHERE contact_id=?", (d["contact_id"],))

    report["merges"] = [{"merged_id": k, "survivor_id": v} for k, v in merge_map.items()]
    report["contacts_deduplicated"] = [d["contact_id"] for d in dup_contacts]
    return merge_map


# ---------------------------------------------------------------- documents (ING-4..ING-9)

INJECTION_PATTERNS = [
    r"ignore (all |any )?(previous|prior|above|earlier) instructions",
    r"disregard (all |the )?(previous|prior|above) ",
    r"\b(note|message|instructions?) (to|for) (ai|llm|language model|assistant)s?\b",
    r"\bai assistants?\b",
    r"\bsystem prompt\b",
    r"you are (now )?(an? )?(ai|assistant|language model)",
]
HEADER_LINE = re.compile(r"^(from|to|cc|bcc|subject|date|sent):", re.IGNORECASE)
FORWARD_MARKER = re.compile(r"^-+\s*(forwarded|original) message\s*-+$", re.IGNORECASE)
CHUNK_TARGET = 800
CHUNK_MAX_PARAGRAPH = 1600


def _read_doc(path: Path) -> tuple[dict, str]:
    _, fm, body = path.read_text().split("---", 2)
    meta = yaml.safe_load(fm)
    if isinstance(meta.get("date"), date):
        meta["date"] = meta["date"].isoformat()
    return meta, body.strip()


def _link(meta: dict, body: str, resolver: EntityResolver, merge_map: dict) -> tuple[str | None, str, float]:
    """ING-4: returns (client_id, method, confidence)."""
    if meta.get("client_id"):
        return merge_map.get(meta["client_id"], meta["client_id"]), "source_id", 1.0
    best: dict[str, float] = {}
    mentions = meta.get("mentions") or []
    for m in mentions:
        for match in resolver.resolve(m):
            best[match.client_id] = max(best.get(match.client_id, 0), match.confidence)
    if not mentions:  # fall back to scanning text only when no entities were tagged
        text = f"{meta.get('title', '')}\n{body}"
        for cid, names in resolver.names.items():
            for n in names:
                if len(n) >= 3 and re.search(rf"\b{re.escape(n)}\b", text.lower()):
                    best[cid] = max(best.get(cid, 0), 1.0)
    if len(best) == 1:
        cid, conf = next(iter(best.items()))
        return cid, "inferred", min(0.9, conf)
    if len(best) > 1:
        return None, "ambiguous", 0.0
    return None, "unlinked", 0.0


def _normalized_body(body: str) -> str:
    lines = [
        ln
        for ln in body.splitlines()
        if not HEADER_LINE.match(ln.strip()) and not FORWARD_MARKER.match(ln.strip())
    ]
    return re.sub(r"\s+", " ", " ".join(lines).lower()).strip()


def _chunks(body: str) -> list[str]:
    """ING-9: paragraph-based chunks of ~CHUNK_TARGET chars."""
    paras = [p.strip() for p in re.split(r"\n\s*\n", body) if p.strip()]
    pieces: list[str] = []
    for p in paras:
        if len(p) <= CHUNK_MAX_PARAGRAPH:
            pieces.append(p)
        else:  # split an oversized paragraph on sentence boundaries
            buf = ""
            for s in re.split(r"(?<=[.!?])\s+", p):
                if buf and len(buf) + len(s) > CHUNK_TARGET:
                    pieces.append(buf)
                    buf = ""
                buf = f"{buf} {s}".strip()
            if buf:
                pieces.append(buf)
    chunks, buf = [], ""
    for p in pieces:
        if buf and len(buf) + len(p) > CHUNK_TARGET:
            chunks.append(buf)
            buf = ""
        buf = f"{buf}\n\n{p}".strip()
    if buf:
        chunks.append(buf)
    return chunks


def load_documents(conn, resolver: EntityResolver, merge_map: dict, report: dict) -> None:
    conn.execute("""CREATE TABLE documents (
        doc_id TEXT PRIMARY KEY, doc_type TEXT, title TEXT, date TEXT, author TEXT,
        client_id TEXT, source_client_id TEXT, link_method TEXT, link_confidence REAL,
        mentions TEXT, classification TEXT, access_groups TEXT, source TEXT,
        approved INTEGER, news_source TEXT, derived INTEGER, stale INTEGER,
        duplicate_of TEXT, quarantined INTEGER, body TEXT)""")
    conn.execute("""CREATE TABLE chunks (
        chunk_id TEXT PRIMARY KEY, doc_id TEXT REFERENCES documents(doc_id), seq INTEGER,
        text TEXT, suspected_injection INTEGER, indexed INTEGER)""")

    stale_before = (config.TODAY - timedelta(days=config.STALE_AFTER_DAYS)).isoformat()
    docs = []
    for path in sorted(config.DOCS_DIR.glob("*.md")):
        meta, body = _read_doc(path)
        cid, method, conf = _link(meta, body, resolver, merge_map)
        docs.append(
            {
                "doc_id": meta["doc_id"],
                "doc_type": meta["doc_type"],
                "title": meta["title"],
                "date": meta["date"],
                "author": meta.get("author"),
                "client_id": cid,
                "source_client_id": meta.get("client_id"),
                "link_method": method,
                "link_confidence": conf,
                "mentions": json.dumps(meta.get("mentions") or []),
                "classification": meta.get("classification", "internal"),
                "access_groups": json.dumps(meta.get("access_groups") or []),
                "source": meta.get("source"),
                "approved": None if "approved" not in meta else int(bool(meta["approved"])),
                "news_source": meta.get("news_source"),
                "derived": int(meta["doc_type"] == "prior_briefing"),  # ING-6
                "stale": int(meta["date"] < stale_before),  # ING-6
                "duplicate_of": None,
                "quarantined": int(meta["doc_type"] == "news" and meta.get("approved") is False),  # ING-7
                "body": body,
                "_norm": _normalized_body(body),
            }
        )

    # ING-5 dedup: same client, within 7 days, identical or near-identical normalized body.
    # Earlier (then shorter) document survives; forwards/replies quote the original so are longer.
    docs.sort(key=lambda d: (d["date"], len(d["_norm"]), d["doc_id"]))
    dup_pairs = []
    for i, a in enumerate(docs):
        if a["duplicate_of"] or not a["client_id"]:
            continue
        for b in docs[i + 1 :]:
            if b["duplicate_of"] or b["client_id"] != a["client_id"]:
                continue
            if (date.fromisoformat(b["date"]) - date.fromisoformat(a["date"])).days > 7:
                break
            same_hash = (
                hashlib.sha256(a["_norm"].encode()).digest() == hashlib.sha256(b["_norm"].encode()).digest()
            )
            if same_hash or fuzz.token_set_ratio(a["_norm"], b["_norm"]) >= 95:
                b["duplicate_of"] = a["doc_id"]
                dup_pairs.append({"doc_id": b["doc_id"], "duplicate_of": a["doc_id"]})

    injection_docs = set()
    for d in docs:
        row = {k: v for k, v in d.items() if not k.startswith("_")}
        conn.execute(
            f"INSERT INTO documents ({', '.join(row)}) VALUES ({', '.join('?' * len(row))})",
            list(row.values()),
        )
        indexed = int(not d["duplicate_of"] and not d["quarantined"])
        for n, text in enumerate(_chunks(d["body"])):
            flagged = int(any(re.search(p, text, re.IGNORECASE) for p in INJECTION_PATTERNS))  # ING-8
            if flagged:
                injection_docs.add(d["doc_id"])
            conn.execute(
                "INSERT INTO chunks VALUES (?,?,?,?,?,?)",
                (f"{d['doc_id']}#{n}", d["doc_id"], n, text, flagged, indexed),
            )

    report["documents"] = {
        "total": len(docs),
        "by_link_method": dict(Counter(d["link_method"] for d in docs)),
        "inferred_links": [
            {"doc_id": d["doc_id"], "client_id": d["client_id"], "confidence": d["link_confidence"]}
            for d in docs
            if d["link_method"] == "inferred"
        ],
        "unlinked": sorted(d["doc_id"] for d in docs if d["link_method"] == "unlinked"),
        "ambiguous": sorted(d["doc_id"] for d in docs if d["link_method"] == "ambiguous"),
        "duplicates": dup_pairs,
        "quarantined_news": sorted(d["doc_id"] for d in docs if d["quarantined"]),
        "derived": sorted(d["doc_id"] for d in docs if d["derived"]),
        "stale": sorted(d["doc_id"] for d in docs if d["stale"]),
        "suspected_injection": sorted(injection_docs),
    }


# ---------------------------------------------------------------- ING-12 quality checks


def _quality_checks(conn) -> list[tuple[str, str, str, str]]:
    """(id, plain-language check, severity, SQL returning the failing rows). Errors are data that is
    wrong; warnings are gaps the app reports instead of filling (P4: fail visibly); info lists rows
    held out on purpose (e.g. news about a look-alike company, ING-3)."""
    from briefing.tools import _last_quarters  # reuse the TTM window definition (TOOL-6)

    owned = [
        (t, key)
        for t, key in [
            ("contacts", "contact_id"),
            ("coverage", "user_id"),
            ("financials", "fiscal_period"),
            ("holdings", "holding_id"),
            ("revenue", "period"),
            ("interactions", "interaction_id"),
            ("meetings", "meeting_id"),
            ("open_actions", "action_id"),
            ("opportunities", "opp_id"),
            ("service_issues", "issue_id"),
            ("client_aliases", "alias"),
        ]
    ]
    orphans = "\nUNION ALL ".join(
        f"SELECT '{t}' AS table_name, {key} AS record, client_id FROM {t} "
        "WHERE client_id NOT IN (SELECT client_id FROM clients)"
        for t, key in owned
    )
    quarters = ",".join(f"'{q}'" for q in _last_quarters(config.TODAY, 8))
    return [
        ("Q1", "Every record belongs to a known client", "error", orphans),
        (
            "Q2",
            "One client per LEI (duplicates merged)",
            "error",
            "SELECT lei, COUNT(*) AS clients FROM clients GROUP BY lei HAVING COUNT(*) > 1",
        ),
        # per original record: after a merge, two records' rows for one quarter are both real
        # (Helios's green loan was booked under C-007) and are added, not de-duplicated
        (
            "Q3",
            "Each original client record reports a quarter and product line once",
            "error",
            "SELECT source_client_id, period, product_line, COUNT(*) AS rows FROM revenue\n"
            "GROUP BY source_client_id, period, product_line HAVING COUNT(*) > 1",
        ),
        (
            "Q4",
            "Revenue is never negative",
            "error",
            "SELECT client_id, period, product_line, revenue_usd FROM revenue WHERE revenue_usd < 0",
        ),
        (
            "Q5",
            "Every client has one primary banker",
            "error",
            "SELECT c.client_id, COUNT(v.user_id) AS primary_bankers FROM clients c\n"
            "LEFT JOIN coverage v ON v.client_id = c.client_id AND v.is_primary = 1\n"
            "GROUP BY c.client_id HAVING COUNT(v.user_id) <> 1",
        ),
        (
            "Q6",
            "Owners and bankers are known users",
            "error",
            "SELECT 'open_actions' AS table_name, action_id AS record, owner AS user_id FROM open_actions\n"
            "WHERE owner NOT IN (SELECT user_id FROM users)\n"
            "UNION ALL SELECT 'coverage', client_id, user_id FROM coverage\n"
            "WHERE user_id NOT IN (SELECT user_id FROM users)",
        ),
        (
            "Q7",
            "Facilities mature after they open",
            "error",
            "SELECT holding_id, opened_date, maturity_date FROM holdings\n"
            "WHERE maturity_date IS NOT NULL AND maturity_date < opened_date",
        ),
        (
            "Q8",
            "Contacts leave after they join",
            "error",
            "SELECT contact_id, start_date, end_date FROM contacts\n"
            "WHERE end_date IS NOT NULL AND end_date < start_date",
        ),
        (
            "Q9",
            "Win probabilities are between 0 and 100",
            "error",
            "SELECT opp_id, probability_pct FROM opportunities WHERE probability_pct NOT BETWEEN 0 AND 100",
        ),
        (
            "Q10",
            "Every client has revenue for the last 8 quarters",
            "warning",
            "SELECT c.client_id, COUNT(DISTINCT r.period) AS quarters_present FROM clients c\n"
            f"LEFT JOIN revenue r ON r.client_id = c.client_id AND r.period IN ({quarters})\n"
            "GROUP BY c.client_id HAVING COUNT(DISTINCT r.period) < 8",
        ),
        (
            "Q11",
            "Documents that match no client are held out of briefings",
            "info",
            "SELECT doc_id, doc_type, link_method FROM documents\n"
            "WHERE client_id IS NULL AND doc_type NOT IN ('research', 'product_update')\n"
            "AND quarantined = 0 AND duplicate_of IS NULL",
        ),
    ]


def check_quality(conn, report: dict) -> None:
    """ING-12: run each check (a SQL query that returns the failing rows) on the unified data and
    record the outcome in the ingestion report. Nothing is fixed or hidden here: errors and gaps are
    reported so the data page and the briefing can show them."""
    results = []
    for qid, check, severity, sql in _quality_checks(conn):
        failing = [dict(r) for r in conn.execute(sql)]
        results.append(
            {
                "id": qid,
                "check": check,
                "severity": severity,
                "passed": not failing,
                "failures": len(failing),
                "examples": failing[:5],
                "sql": sql,
            }
        )
    report["quality_checks"] = results


# ---------------------------------------------------------------- ING-10 index


def build_index(conn, report: dict) -> None:
    from briefing.embeddings import embed_documents  # heavy import only when indexing

    conn.execute(
        "CREATE VIRTUAL TABLE chunk_fts USING fts5(chunk_id UNINDEXED, text, tokenize='porter unicode61')"
    )
    conn.execute("CREATE TABLE chunk_vectors (chunk_id TEXT PRIMARY KEY, vec BLOB)")
    rows = conn.execute(
        """
        SELECT c.chunk_id, c.text, d.title
        FROM chunks c JOIN documents d USING (doc_id)
        WHERE c.indexed = 1
        ORDER BY c.chunk_id
        """
    ).fetchall()
    for r in rows:
        conn.execute(
            "INSERT INTO chunk_fts (chunk_id, text) VALUES (?, ?)",
            (r["chunk_id"], f"{r['title']}\n{r['text']}"),
        )
    t = time.time()
    vecs = embed_documents([f"{r['title']}\n{r['text']}" for r in rows])
    for r, v in zip(rows, vecs, strict=True):
        conn.execute("INSERT INTO chunk_vectors VALUES (?, ?)", (r["chunk_id"], v.tobytes()))
    report["index"] = {
        "chunks_indexed": len(rows),
        "embedding_model": config.EMBED_MODEL,
        "embedding_seconds": round(time.time() - t, 2),
    }


# ---------------------------------------------------------------- main (ING-11 report)


def run(
    db_path: Path = config.DB_PATH,
    with_index: bool = True,
    report_path: Path | None = config.VAR_DIR / "ingestion_report.json",
) -> dict:
    db_path.parent.mkdir(parents=True, exist_ok=True)
    if db_path.exists():
        db_path.unlink()  # idempotent rebuild
    report: dict = {
        "today": config.TODAY.isoformat(),
        "built_at": datetime.now().isoformat(),
    }
    conn = connect(db_path)
    with conn:
        load_structured(conn, report)
        merge_map = merge_clients(conn, report)
        resolver = EntityResolver.from_db(conn)
        load_documents(conn, resolver, merge_map, report)
        check_quality(conn, report)
        if with_index:
            build_index(conn, report)
        report["chunks_total"] = conn.execute("SELECT COUNT(*) FROM chunks").fetchone()[0]
    conn.close()
    if report_path:
        report_path.write_text(json.dumps(report, indent=2))
    return report


if __name__ == "__main__":
    print(json.dumps(run(), indent=2))
