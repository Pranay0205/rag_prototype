"""Acceptance tests for specs/05-api-ui.md (API-1..10, RT-4, RT-7), LLM mocked."""

import json

import pytest
from fastapi.testclient import TestClient

from briefing import ingest, llm
from briefing.api import Commitments, app
from briefing.orchestrator import JudgeResult, SectionDraft


def fake_chat_json(system, user, schema, fast=False, **_):
    if schema is SectionDraft:
        return SectionDraft.model_validate({"claims": [{"text": "A fact.", "cite": ["E1"]}]})
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
def client():
    ingest.run()  # rebuild var/briefing.db so tests start from the known data pack
    with TestClient(app) as c:
        yield c


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
    assert {u["user_id"] for u in client.get("/api/users").json()} == {"alex", "sam", "kim"}


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
