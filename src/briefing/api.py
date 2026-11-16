"""HTTP API (specs/05-api-ui.md). Run: uv run uvicorn briefing.api:app --port 8000

Users are simulated: the caller passes user_id (a real deployment takes it from SSO).
Every endpoint re-checks coverage/entitlement through the tools layer.
"""

import json
import threading
import uuid
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from datetime import datetime
from typing import Literal

from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from briefing import config, llm, orchestrator, prompts
from briefing.db import connect, jlist, rows
from briefing.schemas import Briefing
from briefing.tools import ToolResult, Tools, can_see

HTTP_STATUS = {
    "NOT_FOUND": 404,
    "NOT_IN_COVERAGE": 403,
    "FORBIDDEN": 403,
    "AMBIGUOUS": 409,
    "INVALID_INPUT": 400,
    "UNAVAILABLE": 503,
}


def tools() -> Tools:
    """A fresh connection per request: SQLite connections must not be shared across threads."""
    return Tools(connect())


def raise_for(result: ToolResult) -> None:
    if not result.ok:
        raise HTTPException(
            HTTP_STATUS[result.error.code],
            {
                "code": result.error.code,
                "message": result.error.message,
                "candidates": result.error.candidates,
            },
        )


def viewer_or_404(t: Tools, user_id: str):
    v = t.viewer(user_id)
    if v is None:
        raise HTTPException(404, {"code": "NOT_FOUND", "message": f"No user {user_id}"})
    return v


@asynccontextmanager
async def lifespan(_: FastAPI):
    with connect() as conn:  # app-owned tables survive restarts (ingestion rebuilds only the source tables)
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS claim_reviews (
                briefing_id TEXT, claim_id TEXT, user_id TEXT, decision TEXT, note TEXT, at TEXT
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS created_actions (
                id TEXT PRIMARY KEY, client_id TEXT, kind TEXT, description TEXT, owner TEXT,
                due TEXT, citations TEXT, created_by TEXT, at TEXT
            )
            """
        )
    from briefing.embeddings import embed_queries

    embed_queries(["warm up"])  # load the embedding model once, not on the first briefing
    yield


app = FastAPI(title="Client Briefing API", lifespan=lifespan)


# ---------------------------------------------------------------- API-1, API-2


@app.get("/api/users")
def users():
    """Personas for the demo sign-in screen. In production identity comes from SSO."""
    conn = connect()
    out = []
    for u in rows(conn, "SELECT user_id, name, title, clearance, groups FROM users ORDER BY user_id"):
        covered = rows(
            conn,
            """
            SELECT c.legal_name, cv.coverage_role
            FROM coverage cv JOIN clients c USING (client_id)
            WHERE cv.user_id = ?
            ORDER BY c.legal_name
            """,
            (u["user_id"],),
        )
        out.append({**u, "groups": jlist(u["groups"]), "coverage": covered})
    return out


@app.get("/api/meetings")
def meetings(user_id: str):
    t = tools()
    r = t.get_meetings(viewer_or_404(t, user_id))
    raise_for(r)
    return r.data


# ---------------------------------------------------------------- API-3, API-4, API-5 briefings + SSE


@dataclass
class Job:
    events: list[tuple[str, dict]] = field(default_factory=list)
    cond: threading.Condition = field(default_factory=threading.Condition)
    done: bool = False
    briefing: Briefing | None = None
    user_id: str = ""


JOBS: dict[str, Job] = {}


class BriefingRequest(BaseModel):
    user_id: str
    client_id: str | None = None
    meeting_id: str | None = None


@app.post("/api/briefings")
def start_briefing(req: BriefingRequest):
    t = tools()
    viewer = viewer_or_404(t, req.user_id)
    client_id = req.client_id
    if req.meeting_id:
        ms = [m for m in t.get_meetings(viewer).data if m["meeting_id"] == req.meeting_id]
        if not ms:
            raise HTTPException(
                404, {"code": "NOT_FOUND", "message": f"No meeting {req.meeting_id} in your coverage"}
            )
        client_id = ms[0]["client_id"]
    if not client_id:
        raise HTTPException(400, {"code": "INVALID_INPUT", "message": "client_id or meeting_id is required"})
    raise_for(t.get_client_profile(viewer, client_id))  # ORC-1 before any work starts

    briefing_id = f"b-{client_id}-{uuid.uuid4().hex[:8]}"
    job = JOBS[briefing_id] = Job(user_id=req.user_id)

    def emit(kind: str, data: dict) -> None:
        with job.cond:
            job.events.append((kind, data))
            job.cond.notify_all()

    def work() -> None:
        try:
            b = orchestrator.run_briefing(
                tools(), req.user_id, client_id, on_event=emit, briefing_id=briefing_id
            )
            job.briefing = b
            emit("briefing", b.model_dump(mode="json"))
        except Exception as e:  # noqa: BLE001 - reported to the client as an error event
            emit("error", {"message": str(e)})
        finally:
            with job.cond:
                job.done = True
                job.cond.notify_all()

    threading.Thread(target=work, daemon=True).start()
    return {"briefing_id": briefing_id, "client_id": client_id}


@app.get("/api/briefings/{briefing_id}/stream")
def stream(briefing_id: str):
    job = JOBS.get(briefing_id)
    if job is None:
        raise HTTPException(404, {"code": "NOT_FOUND", "message": "Unknown briefing"})

    def events():
        sent = 0
        while True:
            with job.cond:
                while sent >= len(job.events) and not job.done:
                    if not job.cond.wait(timeout=15):
                        break
                batch, finished = job.events[sent:], job.done
            if not batch and not finished:
                yield ": keepalive\n\n"
            for kind, data in batch:
                yield f"event: {kind}\ndata: {json.dumps(data, default=str)}\n\n"
            sent += len(batch)
            if finished and sent >= len(job.events):
                return

    return StreamingResponse(events(), media_type="text/event-stream", headers={"Cache-Control": "no-cache"})


@app.get("/api/briefings/{briefing_id}")
def get_briefing(briefing_id: str, user_id: str):
    job = JOBS.get(briefing_id)
    if job is None or job.briefing is None:
        raise HTTPException(404, {"code": "NOT_FOUND", "message": "Briefing not found or not finished"})
    if (
        job.user_id != user_id
    ):  # briefings are entitlement-specific; never hand one user's briefing to another
        raise HTTPException(403, {"code": "FORBIDDEN", "message": "Briefing belongs to another user"})
    return job.briefing


# ---------------------------------------------------------------- API-6 source drawer


@app.get("/api/sources/{source_id:path}")
def source(source_id: str, user_id: str):
    """Full document text for a citation. Entitlement and coverage are re-checked (RT-7)."""
    if not source_id.startswith("doc:"):
        raise HTTPException(400, {"code": "INVALID_INPUT", "message": "Structured sources are shown inline"})
    doc_id = source_id.removeprefix("doc:").split("#")[0]
    t = tools()
    viewer = viewer_or_404(t, user_id)
    d = rows(t.conn, "SELECT * FROM documents WHERE doc_id=?", (doc_id,))
    if not d:
        raise HTTPException(404, {"code": "NOT_FOUND", "message": f"No document {doc_id}"})
    d = d[0]
    covered = {
        r["client_id"] for r in rows(t.conn, "SELECT client_id FROM coverage WHERE user_id=?", (user_id,))
    }
    if d["client_id"] and d["client_id"] not in covered:
        raise HTTPException(
            403,
            {"code": "NOT_IN_COVERAGE", "message": "Document belongs to a client outside your coverage"},
        )
    if not can_see(viewer, d["classification"], jlist(d["access_groups"])) or d["quarantined"]:
        raise HTTPException(403, {"code": "FORBIDDEN", "message": "Not available at your access level"})
    chunk = source_id.removeprefix("doc:")
    snippet = rows(t.conn, "SELECT text FROM chunks WHERE chunk_id=?", (chunk,))
    keys = [
        "doc_id",
        "doc_type",
        "title",
        "date",
        "author",
        "classification",
        "link_method",
        "link_confidence",
        "derived",
        "stale",
        "duplicate_of",
        "body",
    ]
    return {
        **{k: d[k] for k in keys},
        "cited_text": snippet[0]["text"] if snippet else None,
        "suspected_injection": bool(
            rows(t.conn, "SELECT 1 FROM chunks WHERE doc_id=? AND suspected_injection=1", (doc_id,))
        ),
    }


# ---------------------------------------------------------------- API-7 review, API-8 actions


class Review(BaseModel):
    user_id: str
    decision: Literal["accept", "reject"]
    note: str = ""


@app.post("/api/briefings/{briefing_id}/claims/{claim_id}/review")
def review(briefing_id: str, claim_id: str, r: Review):
    job = JOBS.get(briefing_id)
    if job is None or job.user_id != r.user_id:
        raise HTTPException(404, {"code": "NOT_FOUND", "message": "Unknown briefing"})
    with connect() as conn:
        conn.execute(
            "INSERT INTO claim_reviews VALUES (?,?,?,?,?,?)",
            (briefing_id, claim_id, r.user_id, r.decision, r.note, datetime.now().isoformat()),
        )
    return {"ok": True}


class NewAction(BaseModel):
    user_id: str
    client_id: str
    kind: str
    description: str
    owner: str | None = None
    due: str | None = None
    citations: list[str] = []


@app.post("/api/actions")
def create_action(a: NewAction):
    t = tools()
    raise_for(t.get_client_profile(viewer_or_404(t, a.user_id), a.client_id))  # coverage check
    action_id = f"N-{uuid.uuid4().hex[:6]}"
    with connect() as conn:
        conn.execute(
            "INSERT INTO created_actions VALUES (?,?,?,?,?,?,?,?,?)",
            (
                action_id,
                a.client_id,
                a.kind,
                a.description,
                a.owner,
                a.due,
                json.dumps(a.citations),
                a.user_id,
                datetime.now().isoformat(),
            ),
        )
    return {"action_id": action_id}


# ---------------------------------------------------------------- API-9 post-meeting notes


class Notes(BaseModel):
    user_id: str
    text: str


class Commitment(BaseModel):
    description: str
    party: Literal["meridian", "client"]
    due: str | None = None
    quote: str


class Commitments(BaseModel):
    items: list[Commitment] = []


@app.post("/api/clients/{client_id}/notes")
def extract_commitments(client_id: str, n: Notes):
    """Proposals only; nothing is saved until the user confirms (via API-8)."""
    t = tools()
    raise_for(t.get_client_profile(viewer_or_404(t, n.user_id), client_id))
    try:
        result = llm.chat_json(
            prompts.NOTES_SYSTEM,
            f"<untrusted_content>\n{n.text}\n</untrusted_content>",
            Commitments,
            fast=True,
        )
    except llm.LLMError as e:
        raise HTTPException(503, {"code": "UNAVAILABLE", "message": str(e)}) from e
    normalized = " ".join(n.text.split()).lower()
    return [
        {
            **c.model_dump(),
            "grounded": " ".join(c.quote.split()).lower() in normalized,
        }  # quote must exist in notes
        for c in result.items
    ]


# ---------------------------------------------------------------- API-10


@app.get("/api/health/data")
def data_health():
    path = config.VAR_DIR / "ingestion_report.json"
    if not path.exists():
        raise HTTPException(503, {"code": "UNAVAILABLE", "message": "Run ingestion first"})
    return json.loads(path.read_text())


# Demo mode: serve the built React app from the same port (npm run build in frontend/)
_dist = config.ROOT / "frontend" / "dist"
if _dist.exists():
    app.mount("/", StaticFiles(directory=_dist, html=True), name="ui")
