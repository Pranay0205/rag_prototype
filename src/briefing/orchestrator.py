"""Briefing pipeline (specs/04-orchestration.md).

ORC-1 authorize -> ORC-2 gather facts -> ORC-3 retrieve per section -> ORC-4 evidence pack
-> ORC-5 generate (strong LLM) -> ORC-6 verify -> ORC-7 assemble -> ORC-8 actions -> ORC-11 log.
Sections run in parallel (ORC-10 streams them via on_event); a failing section never fails the
briefing (ORC-9).
"""

import json
import logging
import re
import time
import uuid
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from functools import cache
from pathlib import Path
from typing import Literal

import yaml
from pydantic import BaseModel, Field
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
    ContactRow,
    CoverageMember,
    Exhibits,
    KeyFigure,
    MeetingRef,
    PipelineRow,
    RevenueLine,
    Section,
    SectionKey,
    SourceKind,
    SuggestedAction,
    Unknown,
    Viewer,
)
from briefing.tools import ToolResult, Tools
from briefing.verify import check_numbers, locate_quote

log = logging.getLogger(__name__)

TOKEN_BUDGET = 6000  # ORC-4: evidence tokens per section call
CHARS_PER_TOKEN = 4  # rough estimate, adequate for budgeting


class BriefingError(RuntimeError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


# ---------------------------------------------------------------- model output contracts (ORC-5, ORC-6)


class DraftCite(BaseModel):
    id: str
    quote: str = ""  # sentence copied from the evidence; checked by verify.locate_quote


class DraftClaim(BaseModel):
    text: str
    cite: list[DraftCite]


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
    explanation: str | None = Field(
        None, description="Ask only: a plain explanation of a term or part of the app, when asked; else null"
    )


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
        "conflict. List missing data as unknowns. Say when a claim relies on evidence marked "
        "INFERRED-LINK. Claims here describe the uncertainty itself.",
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
    revenue: dict = field(default_factory=dict)
    holdings: list[dict] = field(default_factory=list)
    opportunities: list[dict] = field(default_factory=list)


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
        revenue=revenue.data or {},
        holdings=holdings.data or [],
        opportunities=(pipeline.data or {}).get("opportunities", []),
    )


def _money(v: float) -> str:
    """3400000 -> "$3.4M", 4150000 -> "$4.15M", 150000000 -> "$150M"."""
    for scale, unit in ((1e9, "B"), (1e6, "M"), (1e3, "K")):
        if abs(v) >= scale:
            return f"${v / scale:,.2f}".rstrip("0").rstrip(".") + unit
    return f"${v:,.0f}"


def _date(iso: str) -> str:
    return datetime.fromisoformat(iso).strftime("%-d %b %Y")


_UTILIZATION = re.compile(r"utili[sz]ation\s+(\d+(?:\.\d+)?)%", re.IGNORECASE)


def key_figures(facts: FactSheet) -> list[KeyFigure]:
    """ORC-13: headline cards computed by code from the tools' structured results (P1). Each card
    cites the rows it was computed from, so it opens in the source drawer like any claim."""
    cite = {c.source_id: c for group in facts.groups.values() for c in group}
    out: list[KeyFigure] = []

    total = facts.revenue.get("total") or {}
    summary = list(facts.groups.get("revenue", []))
    trend = [q["total"] for q in facts.revenue.get("quarterly", []) if q["total"] is not None]
    if total.get("current_ttm") is not None:
        yoy = total.get("yoy_pct")
        out.append(
            KeyFigure(
                key="revenue",
                label="Relationship revenue (TTM)",
                value=_money(total["current_ttm"]),
                detail=(
                    f"{yoy:+.1f}% vs {_money(total['prior_ttm'])} prior"
                    if yoy is not None
                    else "No prior period"
                ),
                tone="neutral" if yoy is None else ("good" if yoy >= 0 else "bad"),
                trend=trend,
                citations=summary,
            )
        )
    elif total:
        missing = ", ".join(facts.revenue.get("missing_quarters", [])) or "a quarter"
        out.append(
            KeyFigure(
                key="revenue",
                label="Relationship revenue (TTM)",
                value="Incomplete",
                detail=f"{missing} not reported",
                tone="warn",
                trend=trend,
                citations=summary,
            )
        )

    facilities = [h for h in facts.holdings if h.get("notional_usd")]
    if facilities:
        h = max(facilities, key=lambda x: x["notional_usd"])
        used = _UTILIZATION.search(h.get("notes") or "")
        soon = h.get("matures_within_12m")
        detail = f"Matures {_date(h['maturity_date'])}" if h.get("maturity_date") else h["status"]
        out.append(
            KeyFigure(
                key="facility",
                label=h["product"],
                value=_money(h["notional_usd"]),
                detail=detail,  # utilization is shown as the bar
                tone="warn" if soon else "neutral",
                bar_pct=float(used.group(1)) if used else None,
                citations=[c for c in [cite.get(f"sql:holdings/{h['holding_id']}")] if c],
            )
        )

    if facts.opportunities:
        opps = facts.opportunities
        stalled = sum(o["stage"] == "stalled" for o in opps)
        out.append(
            KeyFigure(
                key="pipeline",
                label="Open pipeline",
                value=_money(sum(o["est_revenue_usd"] or 0 for o in opps)),
                detail=f"{len(opps)} {'opportunity' if len(opps) == 1 else 'opportunities'}"
                + (f" · {stalled} stalled" if stalled else ""),
                tone="warn" if stalled else "neutral",
                citations=[c for o in opps if (c := cite.get(f"sql:opportunities/{o['opp_id']}"))],
            )
        )

    open_actions = [a for a in facts.actions if a["status"] == "open"]
    overdue = [a for a in open_actions if a["overdue"]]
    out.append(
        KeyFigure(
            key="actions",
            label="Open actions",
            value=str(len(open_actions)),
            detail=f"{len(overdue)} overdue" if overdue else "None overdue",
            tone="bad" if overdue else "good",
            citations=[
                c for a in (overdue or open_actions) if (c := cite.get(f"sql:open_actions/{a['action_id']}"))
            ],
        )
    )
    return out


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
                    # No classification labels: access is enforced in code before retrieval (P3), and
                    # measured in eval, a RESTRICTED label made the model withhold entitled content.
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


_MARKER = re.compile(r"\s*\[(E\d+(?:\s*,\s*E\d+)*)\]")


def _annotate(raw: str, ids: list[str], has_inline: bool) -> tuple[str, str]:
    """Turn model markers [E3] into per-claim numbers [1] (citations[n-1]).

    Returns (clean text for verification and export, annotated text for display). If the model
    wrote no inline markers, all citations are appended at the end of the claim.
    """
    number = {eid: n for n, eid in enumerate(ids, start=1)}
    clean = _plain(raw)
    if has_inline:
        annotated = _MARKER.sub(
            lambda m: " " + "".join(f"[{number[i.strip()]}]" for i in m.group(1).split(",")), raw
        )
        return clean, _clean(annotated)
    marks = "".join(f"[{n}]" for n in number.values())
    body, end = (clean[:-1], clean[-1]) if clean.endswith(".") else (clean, "")
    return clean, f"{body} {marks}{end}"


def _clean(text: str) -> str:
    return text.replace("—", " - ").replace("–", "-").strip()  # house rule: no em-dashes in UI copy


def _plain(text: str) -> str:
    """Text with evidence markers removed ("... record [E6]." -> "... record."). Evidence IDs are
    internal to one generation call and must never reach the UI."""
    return _clean(re.sub(r"\s+([.,;:])", r"\1", _MARKER.sub("", text)))


def _conflict_status(ev: Evidence) -> str | None:
    """ORC-14: which side of a conflict is superseded, decided from the evidence, not the model."""
    if ev.derived:
        return "outdated"
    return "current" if ev.kind == "sql" else None


def exhibits(facts: FactSheet, attendees: list[str], viewer_id: str) -> Exhibits:
    """ORC-14: contacts (with meeting attendance), coverage team, revenue by product line and the
    pipeline, rendered by the UI as lists and charts. Rows come only from the viewer's tool results,
    so entitlements already apply."""
    cite = {c.source_id: c for group in facts.groups.values() for c in group}
    going = {a.lower() for a in attendees}
    contacts = [
        ContactRow(
            name=k["name"],
            title=k["title"],
            status="former" if not k["is_active"] else ("new" if k["changed_recently"] else "current"),
            attending=k["name"].lower() in going,
            since=k["start_date"],
            until=k["end_date"],
            citation=cite.get(f"sql:contacts/{k['contact_id']}"),
        )
        for k in facts.profile.get("contacts", [])
    ]
    order = {"new": 0, "current": 1, "former": 2}
    contacts.sort(key=lambda c: (not c.attending, order[c.status]))
    # A deal team's membership is itself confidential (it reveals that a deal exists), so it is shown
    # only to members of that deal team.
    team = facts.profile.get("coverage_team", [])
    on_deal_team = any(m["user_id"] == viewer_id and m["coverage_role"] == "deal_team" for m in team)
    coverage = [
        CoverageMember(
            name=m["name"], role=m["coverage_role"].replace("_", " "), primary=bool(m["is_primary"])
        )
        for m in team
        if m["coverage_role"] != "deal_team" or on_deal_team
    ]
    lines = [
        RevenueLine(
            line=r["product_line"], current=r["current_ttm"], prior=r["prior_ttm"], yoy_pct=r["yoy_pct"]
        )
        for r in facts.revenue.get("by_product_line", [])
    ]
    pipeline = [
        PipelineRow(
            product=o["product"],
            stage=o["stage"].replace("_", " "),
            est_revenue=o["est_revenue_usd"],
            probability=o["probability_pct"],
            next_step=o["next_step"],
            citation=cite.get(f"sql:opportunities/{o['opp_id']}"),
        )
        for o in facts.opportunities
    ]
    return Exhibits(
        contacts=contacts,
        coverage=coverage,
        revenue_lines=lines,
        revenue_citation=next(iter(facts.groups.get("revenue", [])), None),
        pipeline=pipeline,
    )


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
        # Inline markers ("... on 2026-09-01 [E3]") plus the cite list, in order of appearance
        inline = [i.strip() for group in _MARKER.findall(dc.text) for i in group.split(",")]
        ids = list(dict.fromkeys(inline + [c.id for c in dc.cite]))
        if not ids or any(i not in by_id for i in ids):
            decisions.append(
                {"claim_id": cid, "text": dc.text, "dropped": "unknown or missing evidence id", "cite": ids}
            )
            continue
        cited = [by_id[i] for i in ids]
        quote_for = {c.id: c.quote for c in dc.cite}
        quotes = [locate_quote(quote_for.get(i, ""), by_id[i].text) for i in ids]
        text, annotated = _annotate(dc.text, ids, has_inline=bool(inline))
        # Step 2: numbers, with rules (a) and (b), on the clean text
        bad_numbers = check_numbers(
            text,
            [{"kind": e.kind, "derived": e.derived, "text": e.text} for e in cited],
            allow_derived=spec.key == SectionKey.UNCERTAINTY,
        )
        # Step 4: injection cap
        tainted = any(e.suspected_injection for e in cited)
        checked.append(
            {
                "claim_id": cid,
                "text": text,
                "annotated": annotated,
                "cited": cited,
                "quotes": quotes,
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
                annotated=c["annotated"],
                citations=[
                    e.citation.model_copy(update={"quote": q})
                    for e, q in zip(c["cited"], c["quotes"], strict=True)
                ],
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
                "quotes_located": sum(q is not None for q in c["quotes"]),
                "bad_numbers": c["bad_numbers"],
                "injection": c["tainted"],
                "verified": verified,
            }
        )
    claims += completeness_backstop(spec, evidence, claims, decisions)
    trace["decisions"] = decisions

    conflicts = []
    for dc in draft.conflicts:
        vals = [v for v in dc.values if v.cite in by_id]
        if len({v.cite for v in vals}) >= 2:  # a conflict needs two distinct cited sources
            conflicts.append(
                Conflict(
                    topic=_plain(dc.topic),
                    resolution=_plain(dc.resolution),
                    values=[
                        ConflictValue(
                            value=_plain(v.value),
                            citation=by_id[v.cite].citation,
                            status=_conflict_status(by_id[v.cite]),
                        )
                        for v in vals
                    ],
                )
            )
    unknowns = [Unknown(question=_plain(u.question), reason=_plain(u.reason)) for u in draft.unknowns]
    follow_ups = [
        SuggestedAction(
            id=f"fu-{spec.key.value}-{i + 1}",
            kind="follow_up",
            origin="ai",
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


# ORC-12: structured items a section must never drop, whatever the model chooses to write.
GUARANTEED = {
    SectionKey.OPPORTUNITIES: ("sql:opportunities/", "In pipeline: "),
    SectionKey.ASKS_COMMITMENTS: ("sql:open_actions/", "Open action: "),
}


def completeness_backstop(
    spec: SectionSpec, evidence: list[Evidence], claims: list[Claim], decisions: list[dict]
) -> list[Claim]:
    """Pipeline opportunities and open actions in the evidence but cited by no claim are added as
    claims rendered from the database row, so they are verified by construction. Only rows already
    cleared for the viewer are in the evidence, so this can never leak."""
    if spec.key not in GUARANTEED:
        return []
    prefix, label = GUARANTEED[spec.key]
    cited = {c.source_id for claim in claims for c in claim.citations}
    added = []
    for e in evidence:
        sid = e.citation.source_id
        if not sid.startswith(prefix) or sid in cited or e.text.rstrip(")").endswith("closed"):
            continue
        claim_id = f"{spec.key.value}-row-{len(added) + 1}"
        added.append(
            Claim(
                id=claim_id,
                text=label + e.text,
                annotated=f"{label}{e.text} [1]",
                citations=[e.citation.model_copy(update={"quote": e.text})],
                confidence=Confidence.HIGH,
                status=ClaimStatus.VERIFIED,
            )
        )
        decisions.append({"claim_id": claim_id, "text": label + e.text, "added_by": "completeness backstop"})
    return added


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
                    origin="records",
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
                    origin="conflict",
                    description=f"{verb}: {c.topic}",
                    citations=[v.citation for v in c.values],
                )
            )
    return out


# ---------------------------------------------------------------- assemble (ORC-7) + run (ORC-9..11)

EventSink = Callable[[str, dict], None]


def _context(tools: Tools, viewer: Viewer, facts: FactSheet) -> tuple[dict, dict | None]:
    """Prompt context shared by briefing sections and questions, plus the next meeting."""
    client = facts.profile["client"]
    meetings = tools.get_meetings(viewer, client["client_id"]).data
    meeting = meetings[0] if meetings else None
    meeting_line = "none scheduled"
    if meeting:
        attendees = ", ".join(meeting["client_attendees"])
        meeting_line = f"{meeting['start_time']} - {meeting['purpose']} with {attendees}"
    context = {
        "viewer": f"{viewer.role}, clearance {viewer.clearance}"
        + (f", cleared for {', '.join(viewer.groups)}" if viewer.groups else ""),
        "client_name": client["legal_name"],
        "client_id": client["client_id"],
        "today": config.TODAY.isoformat(),
        "meeting": meeting_line,
        "last_interaction": facts.last_interaction or "none logged",
        "data_gaps": "; ".join(facts.warnings) or "none",
    }
    return context, meeting


ASK_GUIDANCE = (
    "Answer the banker's question directly in at most 3 claims, most important first. Each claim "
    "states ONE fact from ONE or two evidence items; do not chain facts with 'and' or 'since'. "
    "If the evidence does not answer it, add an unknown saying what is missing instead of writing a claim."
    " If the question asks what a term, metric or part of the app means, explain it in `explanation`: "
    "at most 2 plain sentences, no numbers, no facts about this client. Add claims only if this "
    "client's evidence adds something useful."
)
# ORC-15: questions asking what to do get actions, each tied to the cited fact that calls for it
ASK_ACTION_GUIDANCE = (
    "The banker asks what to do. Write at most 3 claims, most important first. Every claim starts "
    "with a verb (Send, Raise, Confirm, Bring, Prepare) naming ONE action, then a colon, then the "
    "cited fact that calls for it, e.g. 'Send the hedging proposal before 20 Nov: Raj needs it by "
    "then to keep Meridian in the selection [E5].' Only actions that follow from an overdue "
    "commitment, a deadline, a client request, an open issue or a recent change in the evidence; "
    "no generic advice. If the evidence gives nothing to act on, add an unknown instead."
    " If the question asks what a term, metric or part of the app means, explain it in `explanation`: "
    "at most 2 plain sentences, no numbers, no facts about this client. Add claims only if this "
    "client's evidence adds something useful."
)
_ACTION_QUESTION = re.compile(
    r"\b(prepare|prep|should (i|we)|what to (do|raise|bring|ask)|next steps?|recommend|focus on|priorit)",
    re.IGNORECASE,
)


def _norm(text: str) -> str:
    """'Facilities & Maturities?' -> 'facilities and maturities'"""
    return " ".join(re.sub(r"[^a-z0-9 ]+", " ", text.lower().replace("&", " and ")).split())


@cache
def _glossary() -> dict[str, tuple[str, str]]:
    """Every way of writing an app label -> (label, hand-written definition). glossary.yaml."""
    entries = yaml.safe_load(Path(__file__).with_name("glossary.yaml").read_text())
    return {
        _norm(name): (label, " ".join(e["text"].split()))
        for label, e in entries.items()
        for name in [label, *e.get("also", [])]
    }


_DEFINE = re.compile(
    r"^(?:what s|what is|what are|what does|what do|define|explain|what is the meaning of|meaning of)"
    r"\s+(?:the |a |an )?(.+?)(?:\s+(?:mean|means|stand for|stands for))?$"
)


def glossary_answer(question: str) -> tuple[str, str] | None:
    """ORC-15: 'What is X?' where X is exactly one of the app's labels -> (label, definition),
    answered from the hand-written glossary, not the model. Anything more ('What facilities does
    Northwind have?') goes through the normal pipeline."""
    m = _DEFINE.match(_norm(question))
    return _glossary().get(m.group(1)) if m else None


def _explanation(text: str | None) -> str | None:
    """ORC-15: an uncited explanation of a term is shown only if it states no figures. Numbers come
    from SQL (P1), so an explanation containing a digit is dropped rather than shown unchecked."""
    text = " ".join((text or "").split())
    return text if text and not re.search(r"\d", text) else None


def answer_question(tools: Tools, user_id: str, client_id: str, question: str) -> dict:
    """ORC-15: one free-form question about one client, answered by the same pipeline as a briefing
    section: entitlement-filtered retrieval, cited claims, the same verification. The question steers
    retrieval; it can never widen what is retrieved (P3), and it is never trusted as evidence."""
    started = time.time()
    viewer = tools.viewer(user_id)
    if viewer is None:
        raise BriefingError("NOT_FOUND", f"No user {user_id}")
    question = " ".join(question.split())[:500]
    if not question:
        raise BriefingError("INVALID_INPUT", "Ask a question")
    if term := glossary_answer(question):  # an app label: exact, instant, no client data
        return {
            "ask_id": f"ask-glossary-{uuid.uuid4().hex[:8]}",
            "question": question,
            "section": Section(key=SectionKey.ASK, title="Answer", confidence=Confidence.HIGH),
            "conflicts": [],
            "unknowns": [],
            "explanation": term[1],
            "explanation_source": "glossary",
            "access_limited": False,
        }
    facts = gather(tools, viewer, client_id)  # coverage enforced here (ORC-1)
    context, _ = _context(tools, viewer, facts)
    spec = SectionSpec(
        SectionKey.ASK,
        "Answer",
        question,
        ASK_ACTION_GUIDANCE if _ACTION_QUESTION.search(question) else ASK_GUIDANCE,
        tuple(facts.groups),
        (),
        (question,),
        k=12,
    )
    evidence, limited, dropped, warnings = build_evidence(tools, viewer, client_id, spec, facts)
    section, conflicts, unknowns, _, trace = run_section(spec, evidence, context)
    section.warnings += warnings
    trace["dropped_for_budget"] = dropped
    explanation = _explanation(trace["raw_output"].get("explanation"))
    section.claims = section.claims[:3]  # the chat answers briefly, most important first
    ask_id = f"ask-{facts.profile['client']['client_id']}-{uuid.uuid4().hex[:8]}"
    runs = config.VAR_DIR / "runs"
    runs.mkdir(parents=True, exist_ok=True)
    log = {
        "ask_id": ask_id,
        "viewer": user_id,
        "question": question,
        "seconds": round(time.time() - started, 1),
    }
    (runs / f"{ask_id}.json").write_text(json.dumps({**log, "trace": trace}, indent=2, default=str))  # ORC-11
    return {
        "ask_id": ask_id,
        "question": question,
        "section": section,
        "conflicts": conflicts,
        "unknowns": unknowns,
        "explanation": explanation,  # labelled in the UI as general, not from client records
        "explanation_source": "model" if explanation else None,
        "access_limited": limited or facts.access_limited,
    }


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
    figures = key_figures(facts)
    if on_event:  # ORC-13: cards render instantly, before any model call
        on_event("figures", [f.model_dump(mode="json") for f in figures])
    client = facts.profile["client"]
    context, meeting = _context(tools, viewer, facts)
    views = exhibits(facts, meeting["client_attendees"] if meeting else [], viewer.user_id)
    if on_event:  # ORC-14: lists and charts render before any model call, like the key figures
        on_event("exhibits", views.model_dump(mode="json"))

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
        key_figures=figures,
        exhibits=views,
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
