"""API contract between backend and UI. frontend/src/types.ts mirrors this file.

Design rule: every claim shown to a user carries citations back to a source of record
(SQL row or document chunk). Claims without evidence are not rendered as facts; they
become Unknowns.
"""

from datetime import date, datetime
from datetime import date as Date  # alias: a field named `date` would shadow the type
from enum import StrEnum
from typing import Any, Literal

from pydantic import BaseModel, Field


class SectionKey(StrEnum):
    """One section per question the briefing must answer."""

    CLIENT_OVERVIEW = "client_overview"  # Who is the client, what matters in the relationship
    CHANGES = "changes_since_last"  # What changed since the last interaction
    ASKS_COMMITMENTS = "asks_commitments"  # What the client asked/said/committed, what is open
    METRICS = "key_metrics"  # Material metrics and performance
    OPPORTUNITIES = "opportunities"  # What to discuss, with supporting evidence
    NEWS = "news_events"  # Approved recent news that should shape the conversation
    UNCERTAINTY = "uncertainty"  # What is uncertain, conflicting or unavailable
    ASK = "ask"  # ORC-15: a free-form question, not a briefing section


class SourceKind(StrEnum):
    SQL = "sql"  # structured system of record (exact)
    DOCUMENT = "document"  # unstructured chunk (email, note, briefing, research, news)


class Confidence(StrEnum):
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"


class ClaimStatus(StrEnum):
    VERIFIED = "verified"  # verifier matched claim to evidence (numbers matched SQL exactly)
    UNVERIFIED = "unverified"  # cited but verifier could not confirm
    CONFLICT = "conflict"  # sources disagree; see Briefing.conflicts


class Citation(BaseModel):
    source_id: str  # e.g. "sql:metrics/C-001/2026Q3" or "doc:email_0142#2"
    kind: SourceKind
    title: str  # human label, e.g. "Email from CFO, 14 Sep 2026"
    date: Date | None = None
    snippet: str  # exact supporting text or row rendering, shown on hover/click
    # The exact span inside `snippet` that supports the claim. Located by code (verify.locate_quote),
    # never taken on trust from the model; None when it could not be found.
    quote: str | None = None
    # Structured sources only: the database row behind `snippet`, shown as a record in the UI so a
    # system-of-record value is never mistaken for a document sentence. Never sent to the model.
    record: dict[str, Any] | None = None


class Claim(BaseModel):
    id: str
    text: str  # clean text (verification, export)
    annotated: str | None = None  # same text with inline markers [n] -> citations[n-1], for display
    citations: list[Citation] = Field(min_length=1)
    confidence: Confidence
    status: ClaimStatus


class Section(BaseModel):
    key: SectionKey
    title: str
    claims: list[Claim] = []
    confidence: Confidence
    warnings: list[str] = []  # e.g. "Only 1 interaction found in last 90 days"


class ConflictValue(BaseModel):
    value: str
    citation: Citation
    # Set by code from the evidence, never by the model: a prior briefing is "outdated",
    # a system-of-record row is "current"; None for other documents.
    status: Literal["outdated", "current"] | None = None


class Conflict(BaseModel):
    topic: str  # e.g. "FY2026 revenue"
    values: list[ConflictValue] = Field(min_length=2)
    resolution: str  # e.g. "CRM metrics table is the system of record; used $3.2M"


class Unknown(BaseModel):
    question: str  # what the analyst might expect to know
    reason: str  # "no data", "restricted at your access level", "stale (>12 months)"


class KeyFigure(BaseModel):
    """ORC-13: a headline number computed by code from structured data. Never written by the model."""

    key: str  # "revenue" | "facility" | "pipeline" | "actions"
    label: str
    value: str
    detail: str
    tone: Literal["good", "bad", "warn", "neutral"] = "neutral"
    trend: list[float] = []  # sparkline points, oldest first
    bar_pct: float | None = None  # e.g. facility utilization
    citations: list[Citation] = []


class ContactRow(BaseModel):
    name: str
    title: str
    status: Literal["new", "current", "former"]  # new = joined since the recent-change cut-off
    attending: bool  # on the client side of the upcoming meeting
    since: str | None = None
    until: str | None = None
    citation: Citation | None = None


class RevenueLine(BaseModel):
    line: str
    current: float | None
    prior: float | None
    yoy_pct: float | None


class PipelineRow(BaseModel):
    product: str
    stage: str
    est_revenue: float | None
    probability: int | None
    next_step: str | None
    citation: Citation | None = None


class CoverageMember(BaseModel):
    name: str
    role: str
    primary: bool


class Exhibits(BaseModel):
    """ORC-14: structured views of the briefing's answers, built by code from tool results (P1)."""

    contacts: list[ContactRow] = []
    coverage: list[CoverageMember] = []
    revenue_lines: list[RevenueLine] = []
    revenue_citation: Citation | None = None
    pipeline: list[PipelineRow] = []


class SuggestedAction(BaseModel):
    id: str
    kind: str  # "follow_up" | "flag_stale" | "verify_with_owner"
    description: str
    owner: str | None = None
    due: date | None = None
    citations: list[Citation] = []


class ClientRef(BaseModel):
    client_id: str
    name: str
    aliases: list[str] = []


class MeetingRef(BaseModel):
    meeting_id: str
    date: datetime
    purpose: str
    attendees: list[str] = []


class Viewer(BaseModel):
    user_id: str
    role: str
    clearance: str  # public | internal | confidential (DATA-1)
    groups: list[str] = []  # e.g. ["proj_aurora"]; required for restricted records


class Briefing(BaseModel):
    briefing_id: str
    client: ClientRef
    meeting: MeetingRef | None = None
    viewer: Viewer
    generated_at: datetime
    sections: list[Section]
    conflicts: list[Conflict] = []
    unknowns: list[Unknown] = []
    suggested_actions: list[SuggestedAction] = []
    key_figures: list[KeyFigure] = []
    exhibits: Exhibits = Exhibits()
    # Deliberately a boolean, not a count: a count of hidden records would itself leak
    # information about restricted activity.
    access_limited: bool = False
