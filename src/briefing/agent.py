"""ORC-16 agentic search: questions across the clients a banker covers ("Which client has a term
loan?"). The model plans; code executes and checks.

Each turn the model picks ONE typed tool and the clients to run it for, or stops. The tools are the
same ones the briefing uses, so coverage and entitlements are enforced inside them (P3): a client ID
the model invents or is not cleared for comes back refused, never as data. Everything gathered becomes
evidence for the normal writer and verifier (ORC-5, ORC-6), so the answer is cited and checked like
any other. Bounded: at most MAX_STEPS turns and MAX_CLIENTS clients per turn.
"""

import json
import time
import uuid
from typing import Literal

from pydantic import BaseModel, Field

from briefing import config, llm, prompts
from briefing.orchestrator import (
    BriefingError,
    Evidence,
    SectionSpec,
    _explanation,
    doc_evidence,
    glossary_answer,
    run_section,
    viewer_line,
)
from briefing.schemas import Confidence, Section, SectionKey, Viewer
from briefing.tools import ToolResult, Tools

MAX_STEPS = 4
MAX_CLIENTS = 10
SNIPPET = 300  # characters of each source shown to the planner
OBSERVATIONS = 12_000  # characters of observations the planner sees in total

ToolName = Literal[
    "list_clients", "meetings", "products_held", "revenue", "pipeline", "people", "interactions", "documents"
]

LABELS = {
    "list_clients": "Client list",
    "meetings": "Upcoming meetings",
    "products_held": "Products held",
    "revenue": "Revenue",
    "pipeline": "Pipeline and actions",
    "people": "People",
    "interactions": "Interactions",
    "documents": "Documents",
}

AGENT_GUIDANCE = (
    "Answer the banker's question across the clients in the evidence. Each evidence title starts with "
    "its client's name; name the client in every claim. Write only about the clients that match; "
    "never write about clients that do not (the answer already shows which clients were checked). "
    "Asked how many, lead with the count from a summary source. "
    "At most 3 claims, most important first, each stating ONE fact. If the evidence does not answer "
    "it, add an unknown instead of a claim. If the question asks what a term means, explain it in "
    "`explanation`: at most 2 plain sentences, no numbers."
)


class Step(BaseModel):
    thought: str = Field(description="One short sentence: what is still needed")
    tool: ToolName | None = Field(description="The tool to run next, or null to stop and answer")
    client_ids: list[str] = Field(default_factory=list, description="Clients to run the tool for")
    query: str | None = Field(None, description="Search text, for the documents tool only")


def _run(tools: Tools, viewer: Viewer, tool: str, client_id: str, query: str | None) -> ToolResult:
    if tool == "products_held":
        return tools.get_holdings(viewer, client_id)
    if tool == "revenue":
        return tools.get_revenue(viewer, client_id)
    if tool == "pipeline":
        return tools.get_pipeline(viewer, client_id)
    if tool == "people":
        return tools.get_client_profile(viewer, client_id)
    if tool == "interactions":
        return tools.get_interactions(viewer, client_id)
    return tools.search_documents(viewer, client_id, [query or ""], k=5)


def answer_across_clients(tools: Tools, user_id: str, question: str, client_hint: str | None = None) -> dict:
    """ORC-16: plan with tools, then write and verify the answer from what the tools returned."""
    started = time.time()
    viewer = tools.viewer(user_id)
    if viewer is None:
        raise BriefingError("NOT_FOUND", f"No user {user_id}")
    question = " ".join(question.split())[:500]
    if not question:
        raise BriefingError("INVALID_INPUT", "Ask a question")
    if term := glossary_answer(question):  # the app's own labels: the written guide, no model
        return _reply(
            question,
            Section(key=SectionKey.ASK, title="Answer", confidence=Confidence.HIGH),
            explanation=term[1],
            source="glossary",
        )

    names: dict[str, str] = {}  # client_id -> short name, for evidence titles and step labels
    evidence: dict[str, Evidence] = {}  # by source_id, so a source seen twice is kept once
    observations: list[str] = []
    steps: list[dict] = []
    limited = False

    def name_of(cid: str) -> str:
        if cid not in names:
            p = tools.get_client_profile(viewer, cid)
            names[cid] = p.data["client"]["short_name"] if p.ok else cid
        return names[cid]

    def keep(cid: str | None, ev: Evidence) -> None:
        owner = name_of(cid) if cid else "Your calendar"
        ev.citation = ev.citation.model_copy(update={"title": f"{owner}: {ev.citation.title}"})
        evidence.setdefault(ev.citation.source_id, ev)

    for turn in range(1, MAX_STEPS + 1):
        user = prompts.AGENT_USER.format(
            question=question,
            hint=f"{name_of(client_hint)} ({client_hint})" if client_hint else "none",
            turn=turn,
            max_steps=MAX_STEPS,
            observations="\n".join(observations)[-OBSERVATIONS:] or "none yet",
        )
        try:
            step = llm.chat_json(prompts.AGENT_SYSTEM, user, Step, fast=True)
        except llm.LLMError as e:
            steps.append({"tool": None, "label": "Planner unavailable", "error": str(e)})
            break
        if step.tool is None:
            break
        if step.tool == "meetings":  # the viewer's calendar across covered clients; no IDs needed
            r = tools.get_meetings(viewer)
            for s in r.sources:
                keep((s.record or {}).get("client_id"), Evidence("", s, "sql", s.snippet))
            observations += [f"meetings: {s.snippet[:SNIPPET]}" for s in r.sources]
            steps.append({"tool": "meetings", "label": LABELS["meetings"], "thought": step.thought})
            continue
        if step.tool == "list_clients":
            for cid in sorted(tools._covered(viewer)):
                p = tools.get_client_profile(viewer, cid)
                if p.ok:
                    c = p.data["client"]
                    names[cid] = c["short_name"]
                    observations.append(f"list_clients: {cid} {c['legal_name']} ({c['industry']})")
                    for s in p.sources[:1]:  # the client master row
                        keep(cid, Evidence("", s, "sql", s.snippet))
            steps.append({"tool": "list_clients", "label": LABELS["list_clients"], "thought": step.thought})
            continue
        ran = []
        for cid in (step.client_ids or ([client_hint] if client_hint else []))[:MAX_CLIENTS]:
            r = _run(tools, viewer, step.tool, cid, step.query)
            if not r.ok:  # refused or unavailable: reported to the planner, never worked around
                observations.append(f"{step.tool}({cid}): {r.error.code}")
                continue
            limited |= r.access_limited
            ran.append(name_of(cid))
            if step.tool == "documents":
                for chunk, c in zip(r.data or [], r.sources, strict=True):
                    keep(cid, doc_evidence(chunk, c))
            else:
                for s in r.sources:
                    keep(cid, Evidence("", s, "sql", s.snippet))
            observations += [f"{step.tool}({cid}): {s.title}: {s.snippet[:SNIPPET]}" for s in r.sources]
        steps.append(
            {
                "tool": step.tool,
                "label": f"{LABELS[step.tool]}: {', '.join(ran)}" if ran else f"{LABELS[step.tool]}: refused",
                "thought": step.thought,
                "clients": step.client_ids,
                "query": step.query,
            }
        )

    items = list(evidence.values())
    for n, item in enumerate(items, start=1):
        item.eid = f"E{n}"
    context = {
        "viewer": viewer_line(viewer),
        "client_name": "the clients this banker covers (each evidence title names its client)",
        "client_id": "several",
        "today": config.TODAY.isoformat(),
        "meeting": "not applicable",
        "last_interaction": "not applicable",
        "data_gaps": "none",
    }
    spec = SectionSpec(SectionKey.ASK, "Answer", question, AGENT_GUIDANCE, ())
    section, conflicts, unknowns, _, trace = run_section(spec, items, context)
    section.claims = section.claims[:3]
    explanation = _explanation(trace["raw_output"].get("explanation"))

    ask_id = f"agent-{uuid.uuid4().hex[:8]}"
    runs = config.VAR_DIR / "runs"
    runs.mkdir(parents=True, exist_ok=True)
    log = {"ask_id": ask_id, "viewer": user_id, "question": question, "steps": steps}
    log["seconds"] = round(time.time() - started, 1)
    (runs / f"{ask_id}.json").write_text(json.dumps({**log, "trace": trace}, indent=2, default=str))  # ORC-11
    return _reply(
        question,
        section,
        conflicts=conflicts,
        unknowns=unknowns,
        explanation=explanation,
        source="model" if explanation else None,
        steps=[s["label"] for s in steps],
        limited=limited,
        ask_id=ask_id,
    )


def _reply(
    question: str,
    section: Section,
    *,
    conflicts=(),
    unknowns=(),
    explanation=None,
    source=None,
    steps=(),
    limited=False,
    ask_id=None,
) -> dict:
    return {
        "ask_id": ask_id or f"ask-glossary-{uuid.uuid4().hex[:8]}",
        "question": question,
        "section": section,
        "conflicts": list(conflicts),
        "unknowns": list(unknowns),
        "explanation": explanation,
        "explanation_source": source,
        "steps": list(steps),  # what the agent looked at, shown with the answer
        "access_limited": limited,
    }
