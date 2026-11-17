"""Acceptance tests for specs/05-api-ui.md (API-1..10, RT-4, RT-7), LLM mocked."""

import json

import pytest
from fastapi.testclient import TestClient

from briefing import config, ingest, llm
from briefing.api import Commitments, app
from briefing.orchestrator import JudgeResult, SectionDraft


def fake_chat_json(system, user, schema, fast=False, **_):
    if schema is SectionDraft:
        return SectionDraft.model_validate({"claims": [{"text": "A fact.", "cite": [{"id": "E1"}]}]})
    if schema is JudgeResult:
        ids = [
            line.split(":")[0].removeprefix("Claim ")
            for line in user.splitlines()
            if line.startswith("Claim ")
        ]
        return JudgeResult.model_validate(
            {"verdicts": [{"claim_id": i, "verdict": "supported", "reason": "t"} for i in ids]}
        )
    if schema is Commitments:
        return Commitments.model_validate(
            {
                "items": [
                    {
                        "description": "Send term sheet",
                        "party": "meridian",
                        "due": "Friday",
                        "quote": "We will send the term sheet by Friday.",
                    },
                    {
                        "description": "Invented",
                        "party": "client",
                        "due": None,
                        "quote": "This was never said.",
                    },
                ]
            }
        )
    raise AssertionError(schema)


@pytest.fixture(scope="module")
def client(tmp_path_factory):
    ingest.run()  # rebuild var/briefing.db so tests start from the known data pack
    real_app_db = config.APP_DB_PATH
    config.APP_DB_PATH = (
        tmp_path_factory.mktemp("app") / "app.db"
    )  # never write test briefings to the real app db
    with TestClient(app) as c:
        yield c
    config.APP_DB_PATH = real_app_db


@pytest.fixture(autouse=True)
def mock_llm(monkeypatch):
    monkeypatch.setattr(llm, "chat_json", fake_chat_json)


def sse_events(client, briefing_id):
    events, kind = [], None
    with client.stream("GET", f"/api/briefings/{briefing_id}/stream") as r:
        for line in r.iter_lines():
            if line.startswith("event: "):
                kind = line.removeprefix("event: ")
            elif line.startswith("data: "):
                events.append((kind, json.loads(line.removeprefix("data: "))))
    return events


def test_API_1_users(client):
    users = {u["user_id"]: u for u in client.get("/api/users").json()}
    assert set(users) == {"alex", "sam", "kim"}
    assert [c["legal_name"] for c in users["kim"]["coverage"]] == ["Helios Renewables plc"]
    assert users["kim"]["groups"] == ["proj_aurora"] and users["sam"]["groups"] == []


def test_API_2_meetings_limited_to_coverage(client):
    assert [m["meeting_id"] for m in client.get("/api/meetings", params={"user_id": "kim"}).json()] == [
        "M-902"
    ]
    assert len(client.get("/api/meetings", params={"user_id": "alex"}).json()) == 3


def test_API_3_RT_4_not_in_coverage_is_403(client):
    r = client.post("/api/briefings", json={"user_id": "kim", "client_id": "C-001"})
    assert r.status_code == 403 and r.json()["detail"]["code"] == "NOT_IN_COVERAGE"


def test_API_3_to_5_briefing_streams_and_is_private(client):
    r = client.post("/api/briefings", json={"user_id": "alex", "meeting_id": "M-901"})
    assert r.status_code == 200
    briefing_id = r.json()["briefing_id"]
    events = sse_events(client, briefing_id)
    kinds = [k for k, _ in events]
    assert kinds.count("section") == 7 and "briefing" in kinds and "error" not in kinds
    assert client.get(f"/api/briefings/{briefing_id}", params={"user_id": "alex"}).status_code == 200
    assert client.get(f"/api/briefings/{briefing_id}", params={"user_id": "sam"}).status_code == 403


def test_API_6_RT_7_source_entitlement(client):
    def status(source_id, user):
        return client.get(
            f"/api/sources/{source_id.replace('#', '%23')}", params={"user_id": user}
        ).status_code

    assert status("doc:he_note_005#0", "alex") == 403  # restricted
    assert status("doc:he_note_005#0", "kim") == 200
    assert status("doc:he_email_004#0", "sam") == 403  # confidential
    assert status("doc:nw_email_001#0", "kim") == 403  # outside coverage
    assert status("doc:news_ca_001#0", "alex") == 403  # quarantined news
    body = client.get("/api/sources/doc:nw_email_007%230", params={"user_id": "alex"}).json()
    assert body["suspected_injection"] is True


def test_API_8_create_action_checks_coverage(client):
    ok = client.post(
        "/api/actions",
        json={"user_id": "alex", "client_id": "C-001", "kind": "follow_up", "description": "Call Raj"},
    )
    assert ok.status_code == 200
    denied = client.post(
        "/api/actions", json={"user_id": "kim", "client_id": "C-001", "kind": "follow_up", "description": "x"}
    )
    assert denied.status_code == 403


def test_API_9_commitments_grounded_in_notes(client):
    notes = "Good meeting. We will send the term sheet by Friday. Client happy."
    items = client.post("/api/clients/C-001/notes", json={"user_id": "alex", "text": notes}).json()
    assert [i["grounded"] for i in items] == [True, False]  # invented quote is flagged


def test_API_10_data_health(client):
    report = client.get("/api/health/data").json()
    assert report["merges"] == [{"merged_id": "C-007", "survivor_id": "C-002"}]


def test_API_11_briefing_saved_with_reviews_and_owner_only(client):
    briefing_id = client.post("/api/briefings", json={"user_id": "alex", "client_id": "C-003"}).json()[
        "briefing_id"
    ]
    sse_events(client, briefing_id)
    claim_id = client.get(f"/api/briefings/{briefing_id}", params={"user_id": "alex"}).json()["sections"][0][
        "claims"
    ][0]["id"]
    assert (
        client.post(
            f"/api/briefings/{briefing_id}/claims/{claim_id}/review",
            json={"user_id": "alex", "decision": "reject", "note": "outdated"},
        ).status_code
        == 200
    )
    other = client.get(f"/api/briefings/{briefing_id}", params={"user_id": "alex"}).json()["sections"][1]
    for decision in ("accept", "clear"):  # an undone review leaves no decision behind
        client.post(
            f"/api/briefings/{briefing_id}/claims/{other['claims'][0]['id']}/review",
            json={"user_id": "alex", "decision": decision},
        )
    client.post(
        "/api/actions",
        json={
            "user_id": "alex",
            "client_id": "C-003",
            "kind": "follow_up",
            "description": "x",
            "briefing_id": briefing_id,
            "suggestion_id": "overdue-A-301",
        },
    )

    latest = client.get("/api/briefings/latest", params={"user_id": "alex", "client_id": "C-003"}).json()
    assert latest["briefing"]["briefing_id"] == briefing_id and latest["stale"] is False
    assert latest["reviews"] == {claim_id: "reject"} and latest["created_suggestions"] == ["overdue-A-301"]
    assert latest["review_notes"] == {claim_id: "outdated"}

    # never served to another user: sam has no saved Cascade briefing of their own
    assert (
        client.get("/api/briefings/latest", params={"user_id": "sam", "client_id": "C-003"}).status_code
        == 404
    )
    assert client.get(f"/api/briefings/{briefing_id}", params={"user_id": "sam"}).status_code == 403


def test_API_11_saved_briefing_marked_stale_after_reingestion(client):
    briefing_id = client.post("/api/briefings", json={"user_id": "sam", "client_id": "C-001"}).json()[
        "briefing_id"
    ]
    sse_events(client, briefing_id)
    ingest.run()  # data refreshed after the briefing was prepared
    latest = client.get("/api/briefings/latest", params={"user_id": "sam", "client_id": "C-001"}).json()
    assert latest["stale"] is True


def test_API_12_history_lists_own_versions_newest_first(client):
    ids = []
    for _ in range(2):
        b = client.post("/api/briefings", json={"user_id": "kim", "client_id": "C-002"}).json()["briefing_id"]
        sse_events(client, b)
        ids.append(b)
    history = client.get("/api/briefings/history", params={"user_id": "kim", "client_id": "C-002"}).json()
    assert [h["briefing_id"] for h in history][:2] == ids[::-1]
    older = client.get(
        "/api/briefings/latest", params={"user_id": "kim", "client_id": "C-002", "briefing_id": ids[0]}
    ).json()
    assert older["briefing"]["briefing_id"] == ids[0]
    # alex covers Helios too, but never sees kim's versions
    alex = client.get("/api/briefings/history", params={"user_id": "alex", "client_id": "C-002"}).json()
    assert not set(ids) & {h["briefing_id"] for h in alex}


def test_API_13_search_by_name_or_alias_within_coverage(client):
    def search(user, q):
        return client.get("/api/clients/search", params={"user_id": user, "q": q}).json()

    assert [r["client_id"] for r in search("alex", "north")["results"]] == ["C-001"]
    nwl = search("alex", "NWL")["results"]
    assert nwl[0]["client_id"] == "C-001" and nwl[0]["matched_alias"] == "NWL"
    in_sentence = search("alex", "What is overdue for NWL?")["results"]  # named inside a question
    assert [r["client_id"] for r in in_sentence] == ["C-001"]
    assert search("alex", "what changed at helios lately")["results"][0]["client_id"] == "C-002"
    outside = search("kim", "Northwind")  # kim covers Helios only
    assert outside["results"] == [] and "outside your coverage" in outside["notice"]
    assert "Northwind" not in json.dumps(outside)  # the notice never names the client


def test_API_14_ask_returns_cited_verified_answer(client):
    r = client.post("/api/clients/C-001/ask", json={"user_id": "alex", "question": "Who is the new CFO?"})
    assert r.status_code == 200
    claim = r.json()["section"]["claims"][0]
    assert claim["citations"] and claim["status"] in ("verified", "unverified")
    blocked = client.post("/api/clients/C-001/ask", json={"user_id": "kim", "question": "Who is the CFO?"})
    assert blocked.status_code == 403  # coverage enforced before any retrieval


def test_API_15_home_respects_coverage(client):
    kim = client.get("/api/home", params={"user_id": "kim"}).json()
    assert [c["client_id"] for c in kim["companies"]] == ["C-002"]
    assert {m["client_id"] for m in kim["meetings"]} == {"C-002"}
    alex = client.get("/api/home", params={"user_id": "alex"}).json()
    nw = next(c for c in alex["companies"] if c["client_id"] == "C-001")
    assert nw["revenue_ttm"] == 3400000 and nw["yoy_pct"] == -18.1
    assert [c["name"] for c in nw["new_contacts"]] == ["Raj Menon"]  # the new CFO
    assert alex["facilities"][0]["product"] == "Revolving Credit Facility"  # soonest maturity first


def test_API_16_17_actions_listed_untickable_and_owner_only(client):
    made = client.post(
        "/api/actions",
        json={"user_id": "alex", "client_id": "C-002", "kind": "manual", "description": "Bring fee schedule"},
    ).json()["action_id"]
    mine = client.get("/api/actions", params={"user_id": "alex", "client_id": "C-002"}).json()
    assert [(a["action_id"], a["origin"]) for a in mine] == [(made, "user")]
    assert client.get("/api/actions", params={"user_id": "kim", "client_id": "C-001"}).status_code == 403
    assert (
        client.delete(f"/api/actions/{made}", params={"user_id": "kim"}).status_code == 403
    )  # not the creator
    assert client.delete(f"/api/actions/{made}", params={"user_id": "alex"}).status_code == 200
    assert client.get("/api/actions", params={"user_id": "alex", "client_id": "C-002"}).json() == []


def test_ORC_8_suggestions_carry_their_origin(client):
    briefing_id = client.post("/api/briefings", json={"user_id": "alex", "client_id": "C-001"}).json()[
        "briefing_id"
    ]
    sse_events(client, briefing_id)
    actions = client.get(f"/api/briefings/{briefing_id}", params={"user_id": "alex"}).json()[
        "suggested_actions"
    ]
    origins = {a["id"].split("-")[0]: a["origin"] for a in actions}
    assert origins["overdue"] == "records"  # open actions in the database, not the model


def test_API_19_data_overview(client):
    d = client.get("/api/data/overview", params={"user_id": "alex"}).json()
    tables = {t["name"]: t for t in d["tables"]}
    revenue_cols = {c["name"]: c for c in tables["revenue"]["columns"]}
    assert revenue_cols["client_id"]["references"] == "clients"
    assert revenue_cols["source_client_id"]["role"] == "lineage"
    assert d["merges"][0]["merged_id"] == "C-007" and d["merges"][0]["survivor_id"] == "C-002"
    assert d["quality_checks"] and all(c["sql"] for c in d["quality_checks"])
    assert client.get("/api/data/overview", params={"user_id": "nobody"}).status_code == 404


def test_API_18_client_overview_respects_access(client):
    def overview(user):
        return client.get("/api/clients/C-002/overview", params={"user_id": user}).json()

    alex, kim = overview("alex"), overview("kim")
    assert alex["client"]["legal_name"] == "Helios Renewables plc"
    assert {h["product"] for h in alex["holdings"]} >= {"Term Loan", "Green Loan"}
    assert all(r["citation"] for r in alex["holdings"] + alex["contacts"])  # every row opens its source
    alex_docs = {d["doc_id"] for d in alex["documents"]}
    assert "he_note_005" not in alex_docs and alex["access_limited"]  # Aurora note: deal team only
    assert alex["loaded_at"]  # "Data as of" on the page
    assert "he_note_005" in {d["doc_id"] for d in kim["documents"]}
    assert any("Aurora" in o["product"] for o in kim["opportunities"])
    assert all("Aurora" not in o["product"] for o in alex["opportunities"])
    assert client.get("/api/clients/C-001/overview", params={"user_id": "kim"}).status_code == 403
