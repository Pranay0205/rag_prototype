"""Acceptance tests for ORC-16 agentic search (specs/04-orchestration.md), with the LLM mocked."""

import pytest

from briefing import agent, ingest, llm
from briefing.db import connect
from briefing.orchestrator import JudgeResult, SectionDraft
from briefing.tools import Tools


@pytest.fixture(scope="module")
def tools(tmp_path_factory):
    path = tmp_path_factory.mktemp("db") / "agent.db"
    ingest.run(db_path=path, with_index=False, report_path=None)
    conn = connect(path)
    yield Tools(conn)
    conn.close()


def scripted(steps: list[dict], seen: dict):
    """A planner that follows `steps`, then stops; the writer records the evidence it was given."""
    plan = iter(steps)

    def chat_json(system, user, schema, fast=False, **_):
        if schema is agent.Step:
            return agent.Step.model_validate(next(plan, {"thought": "done", "tool": None}))
        if schema is SectionDraft:
            seen["evidence"] = user
            return SectionDraft.model_validate({"claims": []})
        if schema is JudgeResult:
            return JudgeResult.model_validate({"verdicts": []})
        raise AssertionError(schema)

    return chat_json


def test_ORC_16_agent_searches_across_clients(tools, monkeypatch):
    seen: dict = {}
    steps = [
        {"thought": "who", "tool": "list_clients"},
        {"thought": "products", "tool": "products_held", "client_ids": ["C-001", "C-002", "C-003"]},
    ]
    monkeypatch.setattr(llm, "chat_json", scripted(steps, seen))
    out = agent.answer_across_clients(tools, "alex", "Which client has a term loan?")
    assert out["steps"] == ["Client list", "Products held: Northwind, Helios, Cascade Health"]
    # every source is titled with its client, so each claim can say which client it is about
    assert (
        "Northwind: Revolving Credit Facility" in seen["evidence"] and "Helios: Term Loan" in seen["evidence"]
    )
    assert "Northwind: Products held" in seen["evidence"]


def test_ORC_16_agent_cannot_reach_uncovered_client(tools, monkeypatch):
    seen: dict = {}
    # kim covers Helios only; the planner asks for Northwind too (as an injected text might)
    steps = [{"thought": "pipeline", "tool": "pipeline", "client_ids": ["C-001", "C-002"]}]
    monkeypatch.setattr(llm, "chat_json", scripted(steps, seen))
    out = agent.answer_across_clients(tools, "kim", "Which clients have open opportunities?")
    assert out["steps"] == ["Pipeline and actions: Helios"]
    assert "Northwind" not in seen["evidence"] and "O-101" not in seen["evidence"]  # refused, not read
    assert "Aurora" in seen["evidence"]  # kim is on the Aurora deal team
