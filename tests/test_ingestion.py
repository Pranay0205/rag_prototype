"""Acceptance tests for specs/02-ingestion.md. Named test_<REQ-ID>_<what>."""

import pytest

from briefing import ingest
from briefing.db import connect, rows
from briefing.entities import EntityResolver


@pytest.fixture(scope="module")
def conn(tmp_path_factory):
    path = tmp_path_factory.mktemp("db") / "test.db"
    ingest.run(db_path=path, with_index=False, report_path=None)
    c = connect(path)
    yield c
    c.close()


@pytest.fixture(scope="module")
def resolver(conn):
    return EntityResolver.from_db(conn)


def doc(conn, doc_id):
    return rows(conn, "SELECT * FROM documents WHERE doc_id=?", (doc_id,))[0]


def test_ING_12_quality_checks(conn):
    report: dict = {}
    ingest.check_quality(conn, report)
    checks = {c["id"]: c for c in report["quality_checks"]}
    assert all(c["passed"] for c in checks.values() if c["severity"] == "error")
    # gaps are reported, never filled: Cascade has no Q3 2026 revenue
    assert not checks["Q10"]["passed"] and checks["Q10"]["examples"] == [
        {"client_id": "C-003", "quarters_present": 7}
    ]
    # the look-alike company's news is held out on purpose
    assert [e["doc_id"] for e in checks["Q11"]["examples"]] == ["news_ca_002"]
    assert all(c["sql"].lstrip().upper().startswith("SELECT") for c in checks.values())


def test_ING_2_lei_merge(conn):
    merges = rows(conn, "SELECT merged_id, survivor_id FROM client_merge")
    assert merges == [{"merged_id": "C-007", "survivor_id": "C-002"}]
    assert not rows(conn, "SELECT 1 FROM clients WHERE client_id='C-007'")
    # T5: green loan revenue booked under C-007 now counts for Helios
    ttm = conn.execute(
        "SELECT SUM(revenue_usd) FROM revenue "
        "WHERE client_id='C-002' AND period IN ('2025Q4','2026Q1','2026Q2','2026Q3')"
    ).fetchone()[0]
    assert ttm == 3_500_000


def test_ING_2_merge_dedups_coverage_and_contacts(conn):
    assert (
        conn.execute("SELECT COUNT(*) FROM coverage WHERE client_id='C-002' AND user_id='alex'").fetchone()[0]
        == 1
    )
    assert not rows(conn, "SELECT 1 FROM contacts WHERE contact_id='K-203'")


def test_ING_3_alias_exact(resolver):
    m = resolver.resolve("NWL")
    assert [(x.client_id, x.method, x.confidence) for x in m] == [("C-001", "exact", 1.0)]


def test_ING_3_merged_alias_maps_to_survivor(resolver):
    assert resolver.resolve("Helios Energy")[0].client_id == "C-002"


def test_ING_3_fuzzy_holdings(resolver):
    m = resolver.resolve("Northwind Logistics Holdings")
    assert m[0].client_id == "C-001" and m[0].method == "fuzzy" and m[0].confidence < 1.0


def test_ING_3_rejects_name_collision(resolver):
    assert resolver.resolve("Cascade Health Systems") == []


def test_ING_4_missing_id_linked(conn):
    d = doc(conn, "nw_call_006")
    assert d["client_id"] == "C-001" and d["link_method"] == "inferred" and d["link_confidence"] <= 0.9


def test_ING_4_source_id_mapped_through_merge(conn):
    d = doc(conn, "he_email_003")
    assert d["client_id"] == "C-002" and d["source_client_id"] == "C-007"


def test_ING_4_name_collision_news_unlinked(conn):
    assert doc(conn, "news_ca_002")["client_id"] is None


def test_ING_5_forward_dedup(conn):
    assert doc(conn, "nw_email_001_fw")["duplicate_of"] == "nw_email_001"
    assert doc(conn, "nw_email_001")["duplicate_of"] is None
    assert conn.execute("SELECT COUNT(*) FROM documents WHERE duplicate_of IS NOT NULL").fetchone()[0] == 1
    assert not rows(conn, "SELECT 1 FROM chunks WHERE doc_id='nw_email_001_fw' AND indexed=1")


def test_ING_6_prior_briefings_derived(conn):
    assert doc(conn, "nw_briefing_2026_06")["derived"] == 1
    assert doc(conn, "nw_email_001")["derived"] == 0


def test_ING_7_unapproved_news_quarantined(conn):
    assert doc(conn, "news_ca_001")["quarantined"] == 1
    assert not rows(conn, "SELECT 1 FROM chunks WHERE doc_id='news_ca_001' AND indexed=1")
    assert doc(conn, "news_ca_003")["quarantined"] == 0


def test_ING_8_injection_flagged(conn):
    flagged = {
        r["doc_id"] for r in rows(conn, "SELECT DISTINCT doc_id FROM chunks WHERE suspected_injection=1")
    }
    assert flagged == {"nw_email_007"}


def test_ING_9_chunk_ids(conn):
    ids = [r["chunk_id"] for r in rows(conn, "SELECT chunk_id FROM chunks WHERE doc_id='nw_email_001'")]
    assert ids and all(i.startswith("nw_email_001#") for i in ids)
