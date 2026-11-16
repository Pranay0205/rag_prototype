"""Briefing pipeline (specs/04-orchestration.md).

ORC-1 authorize -> ORC-2 gather facts -> ORC-3 retrieve per section -> ORC-4 evidence pack
-> ORC-5 generate (strong LLM) -> ORC-6 verify -> ORC-7 assemble -> ORC-8 actions -> ORC-11 log.
Sections run in parallel (ORC-10 streams them via on_event); a failing section never fails the
briefing (ORC-9).
"""

import json
import logging
import time
import uuid
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Literal

from pydantic import BaseModel
from rapidfuzz import fuzz

from briefing import config, llm, prompts
from briefing.schemas import (
    Briefing,
    Citation,
    Claim,
    ClaimStatus,
    ClientRef,
    Confidence,
    Conflict,
    ConflictValue,
    MeetingRef,
    Section,
    SectionKey,
    SourceKind,
    SuggestedAction,
    Unknown,
    Viewer,
)
from briefing.tools import ToolResult, Tools
from briefing.verify import check_numbers

log = logging.getLogger(__name__)

TOKEN_BUDGET = 6000  # ORC-4: evidence tokens per section call
CHARS_PER_TOKEN = 4  # rough estimate, adequate for budgeting


class BriefingError(RuntimeError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


# ---------------------------------------------------------------- model output contracts (ORC-5, ORC-6)


class DraftClaim(BaseModel):
    text: str
    cite: list[str]


class DraftConflictValue(BaseModel):
    value: str
    cite: str


class DraftConflict(BaseModel):
    topic: str
    values: list[DraftConflictValue]
    resolution: str


class DraftUnknown(BaseModel):
    question: str
    reason: str


class DraftFollowUp(BaseModel):
    description: str
    cite: list[str]


class SectionDraft(BaseModel):
    claims: list[DraftClaim] = []
    conflicts: list[DraftConflict] = []
    unknowns: list[DraftUnknown] = []
    follow_ups: list[DraftFollowUp] = []  # asks_commitments only: requests not yet tracked


class Verdict(BaseModel):
    claim_id: str
    verdict: Literal["supported", "partial", "unsupported"]
    reason: str


class JudgeResult(BaseModel):
    verdicts: list[Verdict]


# ---------------------------------------------------------------- section definitions (ORC-3)

CONVERSATION_DOCS = ["email", "call_note", "meeting_note"]


@dataclass(frozen=True)
class SectionSpec:
    key: SectionKey
    title: str
    question: str
    guidance: str
    facts: tuple[str, ...]  # fact groups from gather()
    doc_types: tuple[str, ...] = ()
    queries: tuple[str, ...] = ()
    since: str | None = None  # "last_interaction" | "news_window"
    k: int = 15


SECTIONS = [
    SectionSpec(
        SectionKey.CLIENT_OVERVIEW,
        "Client overview",
        "Who is the client and what matters most in the relationship right now?",
        "Cover what the client does, what they hold with us, who the key contacts are, "
        "and their stated priorities.",
        ("profile", "holdings", "revenue", "financials", "interactions"),
        tuple(CONVERSATION_DOCS),
        ("priorities strategy", "banking relationships review consolidate", "business update expansion"),
        k=10,
    ),
    SectionSpec(
        SectionKey.CHANGES,
        "What changed since the last interaction",
        "What changed since the last logged interaction?",
        "Only include events dated after the last logged interaction: contact changes, new issues, "
        "client messages, "
        "news, and the latest revenue quarter. Say when each happened.",
        ("profile", "revenue", "issues", "actions", "interactions"),
        tuple(CONVERSATION_DOCS) + ("news",),
        (
            "update change new announced",
            "acquisition agreement",
            "issue problem error",
            "not received evaluating other banks",
            "review RFP",
        ),
        since="last_interaction",
    ),
    SectionSpec(
        SectionKey.ASKS_COMMITMENTS,
        "Asks, commitments and open items",
        "What did the client ask, say or commit, and what remains open?",
        "Separate client requests from Meridian commitments. "
        "Use the open action records for due dates and overdue status. "
        "Put any request or promise found in the documents that has no matching open action into follow_ups.",
        ("actions", "issues"),
        tuple(CONVERSATION_DOCS),
        (
            "asked requested would like please",
            "committed confirm will send by",
            "deadline need by",
            "follow-up introduction",
            "issue cannot approve",
        ),
    ),
    SectionSpec(
        SectionKey.METRICS,
        "Key metrics and performance",
        "Which relationship metrics and client performance figures are material for this meeting?",
        "Focus on the biggest movements and what drives them. Use only [sql] evidence for numbers.",
        ("revenue", "holdings", "financials"),
    ),
    SectionSpec(
        SectionKey.OPPORTUNITIES,
        "Opportunities to discuss",
        "Which opportunities should the team raise, and what evidence supports each?",
        "Include pipeline opportunities and opportunities the evidence supports "
        "that are not yet in the pipeline "
        "(say so). For each, give the client need and the supporting evidence.",
        ("opportunities", "holdings", "revenue"),
        ("research", "product_update", "news") + tuple(CONVERSATION_DOCS),
        (
            "opportunity proposal pricing",
            "hedging FX exposure",
            "refinancing extension maturity",
            "cash pooling local accounts acquisition",
            "green bond issuance framework",
            "liquidity management",
        ),
    ),
    SectionSpec(
        SectionKey.NEWS,
        "Recent news",
        "Which recent approved news or events should shape the conversation?",
        "Say why each item matters for the meeting.",
        ("profile",),
        ("news",),
        ("news announced company",),
        since="news_window",
        k=8,
    ),
    SectionSpec(
        SectionKey.UNCERTAINTY,
        "Uncertain, conflicting or unavailable",
        "What is uncertain, conflicting or unavailable?",
        "Compare prior briefings and client statements against system records "
        "and report every disagreement as a "
        "conflict. List missing data as unknowns. Claims here describe the uncertainty itself.",
        ("profile", "revenue", "holdings"),
        ("prior_briefing",) + tuple(CONVERSATION_DOCS),
        (
            "moved closed transfer terminated",
            "replaced appointed joined left",
            "growing stable strong relationship",
            "not received missing delayed",
        ),
        k=12,
    ),
]


# ---------------------------------------------------------------- evidence


@dataclass
class Evidence:
    eid: str
    citation: Citation
    kind: str  # "sql" | "document"
    text: str
    derived: bool = False
    flags: list[str] = field(default_factory=list)
    suspected_injection: bool = False
    meta: str = ""

    def render(self) -> str:
        if self.kind == "sql":
            return f"[{self.eid}] [sql] {self.citation.title}\n{self.text}"
        flags = ", ".join(self.flags) or "none"
        return (
            f"[{self.eid}] [document] {self.meta} | flags: {flags}\n"
            f"<untrusted_content>\n{self.text}\n</untrusted_content>"
        )


@dataclass
class FactSheet:
    groups: dict[str, list[Citation]]
    warnings: list[str]
    access_limited: bool
    profile: dict
    last_interaction: str | None
    actions: list[dict]


def gather(tools: Tools, viewer: Viewer, client_id: str) -> FactSheet:
    """ORC-2: call the structured tools once."""
    profile = tools.get_client_profile(viewer, client_id)
    if not profile.ok:
        raise BriefingError(profile.error.code, profile.error.message)  # ORC-1
    revenue = tools.get_revenue(viewer, client_id)
    holdings = tools.get_holdings(viewer, client_id)
    financials = tools.get_financials(viewer, client_id)
    pipeline = tools.get_pipeline(viewer, client_id)
    interactions = tools.get_interactions(viewer, client_id)
    results: list[ToolResult] = [profile, revenue, holdings, financials, pipeline, interactions]

    def by_prefix(r: ToolResult, prefix: str) -> list[Citation]:
        return [s for s in r.sources if s.source_id.startswith(f"sql:{prefix}")]

    groups = {
        "profile": profile.sources,
        "revenue": by_prefix(revenue, "revenue/")[
            :1
        ],  # the computed summary; rows stay traceable in the tool result
        "holdings": holdings.sources,
        "financials": financials.sources,
        "opportunities": by_prefix(pipeline, "opportunities/"),
        "issues": by_prefix(pipeline, "service_issues/"),
        "actions": by_prefix(pipeline, "open_actions/"),
        "interactions": interactions.sources,
    }
    warnings = [w for r in results for w in r.warnings]
    for r in results:
        if not r.ok:
            warnings.append(f"Data unavailable: {r.error.message}")
    return FactSheet(
        groups=groups,
        warnings=warnings,
        access_limited=any(r.access_limited for r in results),
        profile=profile.data,
        last_interaction=(interactions.data or {}).get("last_interaction_date"),
        actions=(pipeline.data or {}).get("open_actions", []),
    )


def build_evidence(
    tools: Tools, viewer: Viewer, client_id: str, spec: SectionSpec, facts: FactSheet
) -> tuple[list[Evidence], bool, list[str], list[str]]:
    """ORC-3 + ORC-4. Structured facts are always included; document chunks fill the
    remaining budget in rank order.

    Returns (evidence, access_limited, dropped_for_budget, warnings).
    """
    items: list[Evidence] = []
    for group in spec.facts:
        for c in facts.groups.get(group, []):
            items.append(Evidence("", c, "sql", c.snippet))
    access_limited, dropped, warnings = False, [], []
    if spec.queries:
        since = None
        if spec.since == "last_interaction" and facts.last_interaction:
            since = facts.last_interaction
        elif spec.since == "news_window":
            since = (config.TODAY - timedelta(days=60)).isoformat()
        r = tools.search_documents(
            viewer, client_id, list(spec.queries), doc_types=list(spec.doc_types), since=since, k=spec.k
        )
        if not r.ok:
            warnings.append(
                f"Document search unavailable ({r.error.code}); section uses structured data only"
            )
        access_limited = r.access_limited
        budget = TOKEN_BUDGET * CHARS_PER_TOKEN - sum(len(i.text) for i in items)
        for chunk, citation in zip(r.data or [], r.sources, strict=True):
            if len(chunk["text"]) > budget:
                dropped.append(citation.source_id)
                continue
            budget -= len(chunk["text"])
            flags = [
                f
                for f, on in (
                    ("DERIVED", chunk["derived"]),
                    ("STALE", chunk["stale"]),
                    ("INFERRED-LINK", chunk["link_method"] == "inferred"),
                    ("SUSPECTED-INJECTION", chunk["suspected_injection"]),
                )
                if on
            ]
            items.append(
                Evidence(
                    "",
                    citation,
                    "document",
                    chunk["text"],
                    derived=chunk["derived"],
                    flags=flags,
                    suspected_injection=chunk["suspected_injection"],
                    meta=f'{chunk["doc_type"]} | {chunk["date"]} | {chunk["author"]} | "{chunk["title"]}"',
                )
            )
    for n, item in enumerate(items, start=1):
        item.eid = f"E{n}"
    return items, access_limited, dropped, warnings


# ---------------------------------------------------------------- generate + verify (ORC-5, ORC-6)


def _clean(text: str) -> str:
    return text.replace("—", " - ").replace("–", "-").strip()  # house rule: no em-dashes in UI copy


def run_section(
    spec: SectionSpec, evidence: list[Evidence], context: dict
) -> tuple[Section, list[Conflict], list[Unknown], list[SuggestedAction], dict]:
    trace: dict = {
        "evidence": [{"id": e.eid, "source_id": e.citation.source_id, "flags": e.flags} for e in evidence],
        "derived_sources": [e.citation.source_id for e in evidence if e.derived],
    }
    user = prompts.SECTION_USER.format(
        title=spec.title,
        question=spec.question,
        guidance=spec.guidance,
        evidence="\n\n".join(e.render() for e in evidence),
        **context,
    )
    draft = llm.chat_json(prompts.SECTION_SYSTEM, user, SectionDraft)  # ORC-5, strong model
    trace["raw_output"] = draft.model_dump()
    by_id = {e.eid: e for e in evidence}

    # Step 1: every cited ID must exist, otherwise the claim is dropped
    checked, decisions = [], []
    for i, dc in enumerate(draft.claims):
        cid = f"{spec.key.value}-{i + 1}"
        if not dc.cite or any(c not in by_id for c in dc.cite):
            decisions.append(
                {
                    "claim_id": cid,
                    "text": dc.text,
                    "dropped": "unknown or missing evidence id",
                    "cite": dc.cite,
                }
            )
            continue
        cited = [by_id[c] for c in dc.cite]
        # Step 2: numbers, with rules (a) and (b)
        bad_numbers = check_numbers(
            dc.text,
            [{"kind": e.kind, "derived": e.derived, "text": e.text} for e in cited],
            allow_derived=spec.key == SectionKey.UNCERTAINTY,
        )
        # Step 4: injection cap
        tainted = any(e.suspected_injection for e in cited)
        checked.append(
            {
                "claim_id": cid,
                "text": _clean(dc.text),
                "cited": cited,
                "bad_numbers": bad_numbers,
                "tainted": tainted,
            }
        )

    # Step 3: batched entailment judgment (fast model). Fails closed: no verdict means unverified.
    verdicts: dict[str, str] = {}
    if checked:
        payload = "\n\n".join(
            f"Claim {c['claim_id']}: {c['text']}\nCited evidence:\n"
            + "\n".join(e.render() for e in c["cited"])
            for c in checked
        )
        try:
            verdicts = {
                v.claim_id: v.verdict
                for v in llm.chat_json(prompts.JUDGE_SYSTEM, payload, JudgeResult, fast=True).verdicts
            }
        except llm.LLMError as e:
            trace["judge_error"] = str(e)

    claims = []
    for c in checked:
        verdict = verdicts.get(c["claim_id"], "unavailable")
        verified = verdict == "supported" and not c["bad_numbers"] and not c["tainted"]
        primary = any(
            e.kind == "sql" or (not e.derived and "INFERRED-LINK" not in e.flags) for e in c["cited"]
        )
        confidence = Confidence.LOW if not verified else Confidence.HIGH if primary else Confidence.MEDIUM
        claims.append(
            Claim(
                id=c["claim_id"],
                text=c["text"],
                citations=[e.citation for e in c["cited"]],
                confidence=confidence,
                status=ClaimStatus.VERIFIED if verified else ClaimStatus.UNVERIFIED,
            )
        )
        decisions.append(
            {
                "claim_id": c["claim_id"],
                "text": c["text"],
                "cite": [e.eid for e in c["cited"]],
                "judge": verdict,
                "bad_numbers": c["bad_numbers"],
                "injection": c["tainted"],
                "verified": verified,
            }
        )
    trace["decisions"] = decisions

    conflicts = []
    for dc in draft.conflicts:
        vals = [v for v in dc.values if v.cite in by_id]
        if len({v.cite for v in vals}) >= 2:  # a conflict needs two distinct cited sources
            conflicts.append(
                Conflict(
                    topic=_clean(dc.topic),
                    resolution=_clean(dc.resolution),
                    values=[
                        ConflictValue(value=_clean(v.value), citation=by_id[v.cite].citation) for v in vals
                    ],
                )
            )
    unknowns = [Unknown(question=_clean(u.question), reason=_clean(u.reason)) for u in draft.unknowns]
    follow_ups = [
        SuggestedAction(
            id=f"fu-{spec.key.value}-{i + 1}",
            kind="follow_up",
            description=_clean(f.description),
            citations=[by_id[c].citation for c in f.cite],
        )
        for i, f in enumerate(draft.follow_ups)
        if f.cite and all(c in by_id for c in f.cite)
    ]

    if not claims:
        confidence = Confidence.LOW
    elif all(c.status == ClaimStatus.VERIFIED for c in claims):
        confidence = Confidence.HIGH
    elif sum(c.status == ClaimStatus.VERIFIED for c in claims) * 2 >= len(claims):
        confidence = Confidence.MEDIUM
    else:
        confidence = Confidence.LOW
    section = Section(key=spec.key, title=spec.title, claims=claims, confidence=confidence)
    return section, conflicts, unknowns, follow_ups, trace


# ---------------------------------------------------------------- actions (ORC-8)


def deterministic_actions(
    facts: FactSheet, conflicts: list[Conflict], derived_sources: set[str]
) -> list[SuggestedAction]:
    out = []
    by_source = {c.source_id: c for c in facts.groups.get("actions", [])}
    for a in facts.actions:
        if a["overdue"]:
            out.append(
                SuggestedAction(
                    id=f"overdue-{a['action_id']}",
                    kind="follow_up",
                    owner=a["owner"],
                    due=a["due_date"],
                    description=f"Overdue by {a['days_overdue']} days: {a['description']}",
                    citations=[c for c in [by_source.get(f"sql:open_actions/{a['action_id']}")] if c],
                )
            )
    for i, c in enumerate(conflicts):
        kinds = {v.citation.kind for v in c.values}
        derived_only_doc = all(
            v.citation.source_id in derived_sources
            for v in c.values
            if v.citation.kind == SourceKind.DOCUMENT
        )
        if kinds == {SourceKind.SQL, SourceKind.DOCUMENT}:
            kind = "flag_stale" if derived_only_doc else "verify_with_owner"
            verb = "Flag outdated prior briefing" if derived_only_doc else "Verify with record owner"
            out.append(
                SuggestedAction(
                    id=f"conflict-{i + 1}",
                    kind=kind,
                    description=f"{verb}: {c.topic}",
                    citations=[v.citation for v in c.values],
                )
            )
    return out


# ---------------------------------------------------------------- assemble (ORC-7) + run (ORC-9..11)

EventSink = Callable[[str, dict], None]


def run_briefing(
    tools: Tools,
    user_id: str,
    client_id: str,
    on_event: EventSink | None = None,
    briefing_id: str | None = None,
) -> Briefing:
    started = time.time()
    usage_before = dict(llm.usage)
    viewer = tools.viewer(user_id)
    if viewer is None:
        raise BriefingError("NOT_FOUND", f"No user {user_id}")
    facts = gather(tools, viewer, client_id)  # raises on NOT_FOUND / NOT_IN_COVERAGE (ORC-1)
    client = facts.profile["client"]
    meetings = tools.get_meetings(viewer, client["client_id"]).data
    meeting = meetings[0] if meetings else None
    meeting_line = "none scheduled"
    if meeting:
        attendees = ", ".join(meeting["client_attendees"])
        meeting_line = f"{meeting['start_time']} - {meeting['purpose']} with {attendees}"
    context = {
        "client_name": client["legal_name"],
        "client_id": client["client_id"],
        "today": config.TODAY.isoformat(),
        "meeting": meeting_line,
        "last_interaction": facts.last_interaction or "none logged",
        "data_gaps": "; ".join(facts.warnings) or "none",
    }

    sections: dict[SectionKey, Section] = {}
    conflicts: list[Conflict] = []
    unknowns: list[Unknown] = [
        Unknown(question=w, reason="Not available in source systems") for w in facts.warnings
    ]
    follow_ups: list[SuggestedAction] = []
    traces: dict = {}
    access_limited = facts.access_limited

    # Retrieval runs sequentially: it takes milliseconds, and the SQLite connection must not be
    # shared across threads. Only the LLM calls (seconds each) run in parallel.
    evidence = {spec.key: build_evidence(tools, viewer, client_id, spec, facts) for spec in SECTIONS}

    with ThreadPoolExecutor(max_workers=len(SECTIONS)) as pool:
        futures = {pool.submit(run_section, spec, evidence[spec.key][0], context): spec for spec in SECTIONS}
        for fut in as_completed(futures):
            spec = futures[fut]
            _, limited, dropped, search_warnings = evidence[spec.key]
            access_limited |= limited
            try:
                section, s_conflicts, s_unknowns, s_follow_ups, trace = fut.result()
                section.warnings += search_warnings
                conflicts += s_conflicts
                unknowns += s_unknowns
                if (
                    spec.key == SectionKey.ASKS_COMMITMENTS
                ):  # ORC-8: untracked commitments come from this section only
                    follow_ups += s_follow_ups
            except Exception as e:  # ORC-9: isolate the failure to this section
                log.exception("section %s failed", spec.key)
                section = Section(
                    key=spec.key,
                    title=spec.title,
                    confidence=Confidence.LOW,
                    warnings=[f"Section unavailable: {e}"] + search_warnings,
                )
                trace = {"error": str(e)}
            trace["dropped_for_budget"] = dropped
            sections[spec.key] = section
            traces[spec.key.value] = trace
            if on_event:
                on_event("section", section.model_dump(mode="json"))  # ORC-10

    conflicts = _dedupe(conflicts, lambda c: frozenset(v.citation.source_id for v in c.values))
    unknowns = _dedupe_similar(unknowns)
    derived_sources = {s for t in traces.values() for s in t.get("derived_sources", [])}
    actions = deterministic_actions(facts, conflicts, derived_sources) + follow_ups
    briefing = Briefing(
        briefing_id=briefing_id or f"b-{client['client_id']}-{uuid.uuid4().hex[:8]}",
        client=ClientRef(
            client_id=client["client_id"], name=client["legal_name"], aliases=facts.profile["aliases"]
        ),
        meeting=MeetingRef(
            meeting_id=meeting["meeting_id"],
            date=meeting["start_time"],
            purpose=meeting["purpose"],
            attendees=meeting["client_attendees"],
        )
        if meeting
        else None,
        viewer=viewer,
        generated_at=datetime.now(),
        sections=[sections[s.key] for s in SECTIONS],
        conflicts=conflicts,
        unknowns=unknowns,
        suggested_actions=actions,
        access_limited=access_limited,
    )

    usage = {k: llm.usage[k] - usage_before[k] for k in llm.usage}
    run_log = {
        "briefing_id": briefing.briefing_id,
        "viewer": user_id,
        "client_id": client["client_id"],
        "seconds": round(time.time() - started, 1),
        "usage": usage,
        "model": llm.MODEL,
        "judge_model": llm.MODEL_FAST,
        "sections": traces,
    }
    runs = config.VAR_DIR / "runs"
    runs.mkdir(parents=True, exist_ok=True)
    (runs / f"{briefing.briefing_id}.json").write_text(json.dumps(run_log, indent=2, default=str))  # ORC-11
    if on_event:
        on_event("done", {"briefing_id": briefing.briefing_id})
    return briefing


def _dedupe_similar(unknowns: list[Unknown], threshold: int = 70) -> list[Unknown]:
    """Sections report the same gap in different words. Measured on a real run: paraphrases of one gap
    score 72-93 (token_set_ratio), different gaps score at most 54."""
    out: list[Unknown] = []
    for u in unknowns:
        if not any(fuzz.token_set_ratio(u.question.lower(), o.question.lower()) >= threshold for o in out):
            out.append(u)
    return out


def _dedupe(items: list, key) -> list:
    seen, out = set(), []
    for item in items:
        k = key(item)
        if k not in seen:
            seen.add(k)
            out.append(item)
    return out
