"""Acceptance tests for specs/03-tools.md. Named test_<REQ-ID>_<what>."""

import pytest

from briefing import ingest
from briefing.db import connect
from briefing.tools import Tools


@pytest.fixture(scope="module")
def tools(tmp_path_factory):
    path = tmp_path_factory.mktemp("db") / "tools.db"
    ingest.run(db_path=path, with_index=True, report_path=None)
    conn = connect(path)
    yield Tools(conn)
    conn.close()


@pytest.fixture(scope="module")
def alex(tools):
    return tools.viewer("alex")


@pytest.fixture(scope="module")
def sam(tools):
    return tools.viewer("sam")


@pytest.fixture(scope="module")
def kim(tools):
    return tools.viewer("kim")


def doc_ids(result):
    return {d["doc_id"] for d in result.data}


# ---------------------------------------------------------------- TOOL-1 entitlement & coverage


def test_TOOL_1_sam_cannot_see_confidential(tools, alex, sam):
    q = ["term loan margin basis points"]
    assert "he_email_004" in doc_ids(tools.search_documents(alex, "C-002", q))
    r = tools.search_documents(sam, "C-002", q)
    assert "he_email_004" not in doc_ids(r) and r.access_limited


def test_TOOL_1_alex_cannot_see_restricted(tools, alex):
    r = tools.search_documents(alex, "C-002", ["wind portfolio sale Project Aurora"], k=20)
    assert "he_note_005" not in doc_ids(r) and r.access_limited
    p = tools.get_pipeline(alex, "C-002")
    assert "O-202" not in {o["opp_id"] for o in p.data["opportunities"]} and p.access_limited
    assert all("Aurora" not in s.snippet for s in r.sources + p.sources)


def test_TOOL_1_kim_sees_aurora(tools, kim):
    r = tools.search_documents(kim, "C-002", ["wind portfolio sale Project Aurora"])
    assert "he_note_005" in doc_ids(r)
    assert "O-202" in {o["opp_id"] for o in tools.get_pipeline(kim, "C-002").data["opportunities"]}


def test_TOOL_1_kim_not_in_coverage_for_northwind(tools, kim):
    r = tools.get_client_profile(kim, "C-001")
    assert not r.ok and r.error.code == "NOT_IN_COVERAGE"


def test_TOOL_1_no_access_limit_when_nothing_withheld(tools, alex):
    assert not tools.search_documents(alex, "C-001", ["hedging proposal"]).access_limited


# ---------------------------------------------------------------- TOOL-2 errors as values


def test_TOOL_2_unknown_client_not_found(tools, alex):
    r = tools.get_revenue(alex, "C-999")
    assert not r.ok and r.error.code == "NOT_FOUND"


def test_TOOL_2_empty_query_invalid(tools, alex):
    r = tools.search_documents(alex, "C-001", [" "])
    assert not r.ok and r.error.code == "INVALID_INPUT"


# ---------------------------------------------------------------- TOOL-4 resolve


def test_TOOL_4_resolve_alias(tools, alex):
    r = tools.resolve_client(alex, "Northwind Logistics Holdings")
    assert r.ok and r.data[0]["client_id"] == "C-001" and r.data[0]["method"] == "fuzzy"


def test_TOOL_4_resolve_outside_coverage(tools, kim):
    r = tools.resolve_client(kim, "NWL")
    assert not r.ok and r.error.code == "NOT_IN_COVERAGE"


def test_TOOL_4_name_collision_not_found(tools, alex):
    r = tools.resolve_client(alex, "Cascade Health Systems")
    assert not r.ok and r.error.code == "NOT_FOUND"


# ---------------------------------------------------------------- TOOL-5 profile


def test_TOOL_5_contact_change_visible(tools, alex):
    contacts = {k["name"]: k for k in tools.get_client_profile(alex, "C-001").data["contacts"]}
    assert contacts["Raj Menon"]["is_active"] == 1 and contacts["Raj Menon"]["changed_recently"]
    assert contacts["Dana Whitfield"]["is_active"] == 0 and contacts["Dana Whitfield"]["changed_recently"]


def test_TOOL_5_sql_sources_carry_their_row(tools, alex):
    sources = {c.source_id: c for c in tools.get_client_profile(alex, "C-001").sources}
    dana = next(c for c in sources.values() if c.title == "Contact: Dana Whitfield")
    assert dana.record["end_date"] == "2026-08-31" and dana.record["is_active"] == 0


def test_TOOL_5_merged_id_accepted(tools, alex):
    r = tools.get_client_profile(alex, "C-007")
    assert r.ok and r.data["client"]["client_id"] == "C-002" and r.data["merged_ids"] == ["C-007"]


# ---------------------------------------------------------------- TOOL-6 revenue


def test_TOOL_6_northwind_ttm(tools, alex):
    r = tools.get_revenue(alex, "C-001")
    assert r.data["total"] == {"current_ttm": 3_400_000, "prior_ttm": 4_150_000, "yoy_pct": -18.1}
    fx = next(b for b in r.data["by_product_line"] if b["product_line"] == "FX")
    assert fx == {"product_line": "FX", "current_ttm": 900_000, "prior_ttm": 1_600_000, "yoy_pct": -43.8}
    assert "$3,400,000" in r.sources[0].snippet  # computed figure is traceable (TOOL-3)


def test_TOOL_16_revenue_calculation_adds_up(tools, alex):
    calc = tools.get_revenue(alex, "C-001").sources[0].calculation
    assert calc and "client_id='C-001'" in calc.query and len(calc.inputs) == 24
    assert sum(r["revenue_usd"] for r in calc.inputs if r["period"] >= "2025Q4") == 3_400_000
    assert "= $3,400,000" in calc.steps[1] and "= -18.1%" in calc.steps[3]
    missing = tools.get_revenue(alex, "C-003").sources[0].calculation
    assert "never estimated" in missing.steps[1]  # a gap is stated, not filled


def test_TOOL_16_overdue_and_maturity_calculations(tools, alex):
    cites = {s.source_id: s for s in tools.get_pipeline(alex, "C-001").sources}
    assert cites["sql:open_actions/A-101"].calculation.steps == [
        "Due 15 Oct 2026, today 16 Nov 2026: 32 days overdue"
    ]
    h = {s.source_id: s for s in tools.get_holdings(alex, "C-001").sources}
    assert "within 12 months" in h["sql:holdings/H-101"].calculation.steps[0]


def test_TOOL_6_helios_merged_ttm(tools, alex):
    assert tools.get_revenue(alex, "C-002").data["total"]["current_ttm"] == 3_500_000


def test_TOOL_6_cascade_missing_quarter(tools, alex):
    r = tools.get_revenue(alex, "C-003")
    assert r.data["total"]["current_ttm"] is None and r.data["missing_quarters"] == ["2026Q3"]
    assert any("2026Q3" in w for w in r.warnings)


# ---------------------------------------------------------------- TOOL-7..10


def test_TOOL_7_revolver_maturity_flag(tools, alex):
    h = {x["holding_id"]: x for x in tools.get_holdings(alex, "C-001").data}
    assert h["H-101"]["matures_within_12m"] is True


def test_TOOL_9_overdue_actions(tools, alex):
    actions = {a["action_id"]: a for a in tools.get_pipeline(alex, "C-001").data["open_actions"]}
    assert actions["A-101"]["overdue"] and actions["A-101"]["days_overdue"] == 32
    assert actions["A-102"]["overdue"]
    assert not actions["A-103"]["overdue"] and not actions["A-104"]["overdue"]


def test_TOOL_10_last_interaction(tools, alex):
    assert tools.get_interactions(alex, "C-001").data["last_interaction_date"] == "2026-09-24"


# ---------------------------------------------------------------- TOOL-11 search


def test_TOOL_11_filters_before_ranking(tools, alex):
    breach = tools.search_documents(alex, "C-003", ["data breach patient records"], k=20)
    assert "news_ca_002" not in doc_ids(breach)  # T10: other company's news never linked
    rumor = tools.search_documents(alex, "C-003", ["private equity sale rumor"], k=20)
    assert "news_ca_001" not in doc_ids(rumor)  # T9: unapproved news never indexed
    fw = tools.search_documents(alex, "C-001", ["hedging proposal EUR forward program"], k=20)
    assert "nw_email_001_fw" not in doc_ids(fw) and "nw_email_001" in doc_ids(fw)  # T3


def test_TOOL_11_finds_inferred_link_and_general_docs(tools, alex):
    r = tools.search_documents(alex, "C-001", ["Netherlands banking introduction cash pooling"])
    hits = {d["doc_id"]: d for d in r.data}
    assert hits["nw_call_006"]["link_method"] == "inferred"  # T2
    assert "product_update_001" in hits  # firm-wide product content


def test_TOOL_11_flags_injection(tools, alex):
    r = tools.search_documents(alex, "C-001", ["RFP treasury services review"])
    assert any(d["suspected_injection"] for d in r.data if d["doc_id"] == "nw_email_007")


def test_TOOL_11_since_and_type_filters(tools, alex):
    r = tools.search_documents(alex, "C-001", ["Northwind"], doc_types=["news"], since="2026-11-01", k=20)
    assert doc_ids(r) == {"news_nw_001"}
