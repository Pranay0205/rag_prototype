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
from briefing.schemas import Briefing, Viewer
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


def app_db():
    """User state lives in its own database so re-running ingestion never wipes it (API-11)."""
    return connect(config.APP_DB_PATH)


def init_app_db() -> None:
    with app_db() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS briefings (
                briefing_id TEXT PRIMARY KEY, user_id TEXT, client_id TEXT, meeting_id TEXT,
                created_at TEXT, data_built_at TEXT, json TEXT
            );
            CREATE INDEX IF NOT EXISTS briefings_owner ON briefings (user_id, client_id, created_at);
            CREATE TABLE IF NOT EXISTS claim_reviews (
                briefing_id TEXT, claim_id TEXT, user_id TEXT, decision TEXT, note TEXT, at TEXT
            );
            CREATE TABLE IF NOT EXISTS created_actions (
                id TEXT PRIMARY KEY, client_id TEXT, kind TEXT, description TEXT, owner TEXT,
                due TEXT, citations TEXT, created_by TEXT, at TEXT, briefing_id TEXT, suggestion_id TEXT,
                origin TEXT
            );
            """
        )
        # app.db outlives code versions: add columns introduced after it was created
        cols = {r["name"] for r in rows(conn, "PRAGMA table_info(created_actions)")}
        if "origin" not in cols:
            conn.execute("ALTER TABLE created_actions ADD COLUMN origin TEXT")


def data_built_at() -> str | None:
    path = config.VAR_DIR / "ingestion_report.json"
    return json.loads(path.read_text()).get("built_at") if path.exists() else None


def load_owned(briefing_id: str, user_id: str) -> dict:
    """A saved briefing, only for its owner: briefings reflect one viewer's entitlements."""
    r = rows(app_db(), "SELECT * FROM briefings WHERE briefing_id=?", (briefing_id,))
    if not r:
        raise HTTPException(404, {"code": "NOT_FOUND", "message": "Briefing not found"})
    if r[0]["user_id"] != user_id:
        raise HTTPException(403, {"code": "FORBIDDEN", "message": "Briefing belongs to another user"})
    return r[0]


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_app_db()
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
            with app_db() as conn:  # API-11: keep what the banker was shown
                conn.execute(
                    "INSERT INTO briefings VALUES (?,?,?,?,?,?,?)",
                    (b.briefing_id, req.user_id, client_id, req.meeting_id, datetime.now().isoformat(),
                     data_built_at(), b.model_dump_json()),
                )  # fmt: skip
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


def _same_access(b: Briefing, viewer) -> bool:
    """A saved briefing is only shown if it was generated under the viewer's current access:
    otherwise it may hold content they can no longer see."""
    return (b.viewer.clearance, sorted(b.viewer.groups)) == (viewer.clearance, sorted(viewer.groups))


def _saved_rows(t: Tools, user_id: str, client_id: str) -> tuple[Viewer, list[dict]]:
    viewer = viewer_or_404(t, user_id)
    raise_for(t.get_client_profile(viewer, client_id))  # coverage re-checked at read time
    saved = rows(
        app_db(),
        "SELECT * FROM briefings WHERE user_id=? AND client_id=? ORDER BY created_at DESC",
        (user_id, t._cid(client_id)),
    )
    return viewer, saved


@app.get("/api/briefings/history")
def briefing_history(user_id: str, client_id: str):
    """API-12: the viewer's saved briefings for a client, newest first."""
    viewer, saved = _saved_rows(tools(), user_id, client_id)
    current_data = data_built_at()
    out = []
    for r in saved:
        b = Briefing.model_validate_json(r["json"])
        if not _same_access(b, viewer):
            continue
        claims = [c for s in b.sections for c in s.claims]
        out.append(
            {
                "briefing_id": b.briefing_id,
                "created_at": r["created_at"],
                "stale": r["data_built_at"] != current_data,
                "claims": len(claims),
                "verified": sum(c.status == "verified" for c in claims),
                "conflicts": len(b.conflicts),
            }
        )
    return out


@app.get("/api/briefings/latest")
def latest_briefing(user_id: str, client_id: str, briefing_id: str | None = None):
    """API-11: the viewer's most recent saved briefing for a client (or the version `briefing_id`),
    with their reviews and created actions. Coverage and access are re-checked at read time."""
    viewer, saved = _saved_rows(tools(), user_id, client_id)
    if briefing_id:
        saved = [r for r in saved if r["briefing_id"] == briefing_id]
    for r in saved:
        b = Briefing.model_validate_json(r["json"])
        if _same_access(b, viewer):
            break
    else:
        raise HTTPException(404, {"code": "NOT_FOUND", "message": "No saved briefing"})
    conn = app_db()
    reviews, review_notes = {}, {}
    for x in rows(conn, "SELECT * FROM claim_reviews WHERE briefing_id=? ORDER BY at", (b.briefing_id,)):
        reviews[x["claim_id"]] = x["decision"]  # the latest decision wins
        review_notes[x["claim_id"]] = x["note"] or ""
        if x["decision"] == "clear":
            del reviews[x["claim_id"]], review_notes[x["claim_id"]]
    created = {
        x["suggestion_id"]: x["id"]
        for x in rows(
            conn, "SELECT id, suggestion_id FROM created_actions WHERE briefing_id=?", (b.briefing_id,)
        )
        if x["suggestion_id"]
    }
    return {
        "briefing": b,
        "created_at": r["created_at"],
        "stale": r["data_built_at"] != data_built_at(),
        "reviews": reviews,
        "review_notes": review_notes,
        "created_suggestions": list(created),
        "created_actions": created,  # suggestion_id -> action_id, so a tick can be undone
    }


@app.get("/api/briefings/{briefing_id}")
def get_briefing(briefing_id: str, user_id: str):
    return Briefing.model_validate_json(load_owned(briefing_id, user_id)["json"])


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
    decision: Literal["accept", "reject", "clear"]  # clear = undo; rows are appended, never edited
    note: str = ""  # reject reason: wrong | outdated | not_relevant (feeds EVAL-11)


@app.post("/api/briefings/{briefing_id}/claims/{claim_id}/review")
def review(briefing_id: str, claim_id: str, r: Review):
    load_owned(briefing_id, r.user_id)
    with app_db() as conn:
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
    briefing_id: str | None = None
    suggestion_id: str | None = None
    # records | conflict | ai (a ticked suggestion), notes (confirmed from meeting notes), user (typed in)
    origin: str = "user"


@app.post("/api/actions")
def create_action(a: NewAction):
    """API-8: create an action, either by ticking a suggestion or by typing one in."""
    t = tools()
    raise_for(t.get_client_profile(viewer_or_404(t, a.user_id), a.client_id))  # coverage check
    action_id = f"N-{uuid.uuid4().hex[:6]}"
    with app_db() as conn:
        conn.execute(
            """INSERT INTO created_actions (id, client_id, kind, description, owner, due, citations,
                                          created_by, at, briefing_id, suggestion_id, origin)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""",
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
                a.briefing_id,
                a.suggestion_id,
                a.origin,
            ),
        )
    return {"action_id": action_id}


@app.get("/api/actions")
def list_actions(user_id: str, client_id: str):
    """API-16: the viewer's own actions for a client, newest first, so they carry into later
    briefings. Coverage is re-checked."""
    t = tools()
    raise_for(t.get_client_profile(viewer_or_404(t, user_id), client_id))
    with app_db() as conn:
        found = rows(
            conn,
            "SELECT * FROM created_actions WHERE created_by=? AND client_id=? ORDER BY at DESC",
            (user_id, client_id),
        )
    keys = ["kind", "description", "due", "at", "briefing_id", "suggestion_id", "origin"]
    return [{"action_id": r["id"], **{k: r[k] for k in keys}} for r in found]


@app.delete("/api/actions/{action_id}")
def delete_action(action_id: str, user_id: str):
    """API-17: untick or remove an action. Only its creator can."""
    with app_db() as conn:
        r = rows(conn, "SELECT created_by FROM created_actions WHERE id=?", (action_id,))
        if not r:
            raise HTTPException(404, {"code": "NOT_FOUND", "message": "No such action"})
        if r[0]["created_by"] != user_id:
            raise HTTPException(
                403, {"code": "FORBIDDEN", "message": "Only the creator can remove an action"}
            )
        conn.execute("DELETE FROM created_actions WHERE id=?", (action_id,))
    return {"ok": True}


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


# ---------------------------------------------------------------- API-13 search, API-14 ask, API-15 home


@app.get("/api/clients/search")
def search_clients(user_id: str, q: str = ""):
    """API-13: company search for the top bar, within the viewer's coverage (TOOL-14)."""
    t = tools()
    r = t.search_clients(viewer_or_404(t, user_id), q)
    raise_for(r)
    return {"results": r.data, "notice": r.warnings[0] if r.warnings else None}


class Ask(BaseModel):
    user_id: str
    question: str


@app.post("/api/clients/{client_id}/ask")
def ask(client_id: str, a: Ask):
    """API-14: a free-form question answered with cited, verified claims (ORC-15)."""
    t = tools()
    try:
        return orchestrator.answer_question(t, a.user_id, client_id, a.question)
    except orchestrator.BriefingError as e:
        raise HTTPException(HTTP_STATUS.get(e.code, 400), {"code": e.code, "message": str(e)}) from e
    except llm.LLMError as e:
        raise HTTPException(503, {"code": "UNAVAILABLE", "message": str(e)}) from e


@app.get("/api/home")
def home(user_id: str):
    """API-15: the signed-in dashboard: upcoming meetings, covered companies with headline revenue,
    and facilities with their maturities. Every value comes from the tools, so coverage and
    entitlements apply exactly as in a briefing."""
    t = tools()
    viewer = viewer_or_404(t, user_id)
    meetings = t.get_meetings(viewer).data
    saved = {}
    with app_db() as conn:
        for r in rows(
            conn,
            "SELECT client_id, MAX(created_at) AS at FROM briefings WHERE user_id=? GROUP BY client_id",
            (user_id,),
        ):
            saved[r["client_id"]] = r["at"]
    companies, facilities = [], []
    for cid in sorted(t._covered(viewer)):
        profile = t.get_client_profile(viewer, cid)
        if not profile.ok:
            continue
        p = profile.data
        total = (t.get_revenue(viewer, cid).data or {}).get("total", {})
        role = next((m["coverage_role"] for m in p["coverage_team"] if m["user_id"] == user_id), None)
        companies.append(
            {
                "client_id": cid,
                "name": p["client"]["legal_name"],
                "industry": p["client"]["industry"],
                "aliases": p["aliases"],
                "role": role.replace("_", " ") if role else None,
                "revenue_ttm": total.get("current_ttm"),
                "yoy_pct": total.get("yoy_pct"),
                "next_meeting_id": next((m["meeting_id"] for m in meetings if m["client_id"] == cid), None),
                "last_prepared": saved.get(cid),
            }
        )
        for h in t.get_holdings(viewer, cid).data or []:
            if h["notional_usd"]:
                facilities.append(
                    {
                        "client_id": cid,
                        "client": p["client"]["legal_name"],
                        "product": h["product"],
                        "notional_usd": h["notional_usd"],
                        "maturity_date": h["maturity_date"],
                        "matures_within_12m": h["matures_within_12m"],
                        "notes": h["notes"],
                    }
                )
    facilities.sort(key=lambda f: f["maturity_date"] or "9999")
    return {
        "today": config.TODAY.isoformat(),
        "meetings": [{**m, "last_prepared": saved.get(m["client_id"])} for m in meetings],
        "companies": companies,
        "facilities": facilities,
    }


# ---------------------------------------------------------------- API-10


@app.get("/api/health/data")
def data_health():
    path = config.VAR_DIR / "ingestion_report.json"
    if not path.exists():
        raise HTTPException(503, {"code": "UNAVAILABLE", "message": "Run ingestion first"})
    return json.loads(path.read_text())


# Demo mode: serve the built React app from the same port (npm run build in frontend/)
class _UI(StaticFiles):
    """The built UI. index.html is never cached: it names the current hashed bundles, so a cached
    copy would keep loading an old version after a rebuild. The bundles themselves can be cached."""

    async def get_response(self, path, scope):
        response = await super().get_response(path, scope)
        if response.media_type == "text/html":
            response.headers["Cache-Control"] = "no-cache"
        return response


_dist = config.ROOT / "frontend" / "dist"
if _dist.exists():
    app.mount("/", _UI(directory=_dist, html=True), name="ui")
