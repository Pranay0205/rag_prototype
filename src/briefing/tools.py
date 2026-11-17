"""Typed tools over the unified store (specs/03-tools.md). Deterministic, no LLM calls.

Every tool takes the viewer first, enforces coverage (DATA-2) and entitlement (DATA-1) inside,
and returns a ToolResult envelope instead of raising (TOOL-2).
"""

import functools
import logging
import re
import sqlite3
from datetime import date, timedelta
from typing import Any, Literal

import numpy as np
from pydantic import BaseModel

from briefing import config
from briefing.db import jlist, rows
from briefing.entities import EntityResolver
from briefing.schemas import Calculation, Citation, SourceKind, Viewer

log = logging.getLogger(__name__)

ErrorCode = Literal["NOT_FOUND", "AMBIGUOUS", "FORBIDDEN", "NOT_IN_COVERAGE", "INVALID_INPUT", "UNAVAILABLE"]
GENERAL_DOC_TYPES = ("research", "product_update")  # firm-wide content, searchable for any client
RRF_K = 60


class ToolError(BaseModel):
    code: ErrorCode
    message: str
    candidates: list[str] = []


class ToolResult(BaseModel):
    ok: bool
    data: Any = None
    sources: list[Citation] = []
    warnings: list[str] = []
    error: ToolError | None = None
    access_limited: bool = False  # TOOL-1: something was withheld; never a count


def _fail(code: ErrorCode, message: str, candidates: list[str] | None = None) -> ToolResult:
    return ToolResult(ok=False, error=ToolError(code=code, message=message, candidates=candidates or []))


def _sql_source(
    source_id: str,
    title: str,
    snippet: str,
    on: str | None = None,
    record: dict | None = None,
    calculation: Calculation | None = None,
) -> Citation:
    return Citation(
        source_id=f"sql:{source_id}",
        kind=SourceKind.SQL,
        title=title,
        date=date.fromisoformat(on) if on else None,
        snippet=snippet,
        record=record,
        calculation=calculation,
    )


def _shown_sql(sql: str, params: tuple) -> str:
    """TOOL-16: the query as it ran, with its parameters filled in for reading (display only; the
    query itself always runs parameterized)."""
    out = sql
    for p in params:
        out = out.replace("?", repr(p) if isinstance(p, str) else str(p), 1)
    return " ".join(out.split())


def _day(iso: str) -> str:
    """2026-10-15 -> 15 Oct 2026"""
    d = date.fromisoformat(iso)
    return f"{d.day} {d:%b %Y}"


def _quarter(period: str) -> str:
    """2026Q3 -> Q3 2026"""
    return f"Q{period[-1]} {period[:4]}"


def _usd(v: float | int | None) -> str:
    return "n/a" if v is None else f"${v:,.0f}"


def _revenue_calculation(
    sql: str, params: tuple, recs: list[dict], data: dict, current: list[str], prior: list[str]
) -> Calculation:
    """TOOL-16: the arithmetic behind relationship revenue TTM and YoY, step by step."""
    by_q = {q["period"]: q["total"] for q in data["quarterly"]}

    def window(label: str, quarters: list[str], total: float | None) -> str:
        parts = " + ".join(f"{_quarter(q)} {_usd(by_q[q])}" for q in quarters)
        head = f"{label} ({_quarter(quarters[0])} to {_quarter(quarters[-1])})"
        if total is None:
            gap = ", ".join(_quarter(q) for q in quarters if by_q[q] is None)
            return f"{head}: {gap} has no rows, so no total is given (never estimated)"
        return f"{head}: {parts} = {_usd(total)}"

    total = data["total"]
    steps = [
        f"Each quarter's total is the sum of its product-line rows ({len(recs)} rows in all)",
        window("Last 12 months", current, total["current_ttm"]),
        window("Prior 12 months", prior, total["prior_ttm"]),
    ]
    if total["yoy_pct"] is not None:
        steps.append(
            f"Change: ({_usd(total['current_ttm'])} - {_usd(total['prior_ttm'])}) "
            f"/ {_usd(total['prior_ttm'])} = {total['yoy_pct']:+.1f}%"
        )
    steps += [
        f"{b['product_line']}: {_usd(b['current_ttm'])} vs {_usd(b['prior_ttm'])}"
        + (f" = {b['yoy_pct']:+.1f}%" if b["yoy_pct"] is not None else "")
        for b in data["by_product_line"]
    ]
    return Calculation(
        rule="Relationship revenue for the last 12 months is the sum of the last four reported quarters "
        "across all product lines. The change compares it with the four quarters before. "
        "If a quarter is missing, no total is given rather than an estimate.",
        query=_shown_sql(sql, params),
        inputs=[
            {k: r[k] for k in ("period", "product_line", "revenue_usd", "source_client_id")} for r in recs
        ],
        steps=steps,
    )


def _mentions(text: str, name: str) -> bool:
    """`name` appears in `text` as whole words, case-insensitively ("nwl?" mentions "NWL")."""
    return len(name) >= 3 and re.search(rf"\b{re.escape(name.lower())}\b", text) is not None


def can_see(viewer: Viewer, classification: str, access_groups: list[str]) -> bool:
    """DATA-1: classification <= clearance, and group membership when the record has groups.
    Restricted records are visible only through group membership."""
    if access_groups and not set(access_groups) & set(viewer.groups):
        return False
    if classification == "restricted":
        return bool(access_groups)
    order = config.CLEARANCE_ORDER
    return order.index(classification) <= order.index(viewer.clearance)


def tool(fn):
    """TOOL-2: unexpected exceptions become UNAVAILABLE results; expected errors are returned."""

    @functools.wraps(fn)
    def wrapper(self, viewer: Viewer, *args, **kwargs) -> ToolResult:
        try:
            if "client_id" in kwargs or args:
                client_id = kwargs.get("client_id", args[0] if args else None)
                denied = self._check_coverage(viewer, client_id)
                if denied:
                    return denied
            return fn(self, viewer, *args, **kwargs)
        except Exception as e:  # noqa: BLE001 - deliberate catch-all at the tool boundary
            log.exception("tool %s failed", fn.__name__)
            return _fail("UNAVAILABLE", f"{fn.__name__} failed: {e}")

    return wrapper


class Tools:
    def __init__(self, conn: sqlite3.Connection):
        self.conn = conn
        self.resolver = EntityResolver.from_db(conn)
        self.merge_map = {r["merged_id"]: r["survivor_id"] for r in rows(conn, "SELECT * FROM client_merge")}

    # ------------------------------------------------------------ viewer & coverage

    def viewer(self, user_id: str) -> Viewer | None:
        r = rows(self.conn, "SELECT * FROM users WHERE user_id=?", (user_id,))
        if not r:
            return None
        u = r[0]
        return Viewer(
            user_id=u["user_id"], role=u["title"], clearance=u["clearance"], groups=jlist(u["groups"])
        )

    def _covered(self, viewer: Viewer) -> set[str]:
        return {
            r["client_id"]
            for r in rows(self.conn, "SELECT client_id FROM coverage WHERE user_id=?", (viewer.user_id,))
        }

    def _check_coverage(self, viewer: Viewer, client_id: str) -> ToolResult | None:
        """DATA-2. Merged IDs (C-007) are accepted and mapped to the survivor."""
        cid = self.merge_map.get(client_id, client_id)
        if not rows(self.conn, "SELECT 1 FROM clients WHERE client_id=?", (cid,)):
            return _fail("NOT_FOUND", f"No client {client_id}")
        if cid not in self._covered(viewer):
            return _fail("NOT_IN_COVERAGE", f"{viewer.user_id} does not cover {cid}")
        return None

    def _cid(self, client_id: str) -> str:
        return self.merge_map.get(client_id, client_id)

    # ------------------------------------------------------------ TOOL-4

    def resolve_client(self, viewer: Viewer, query: str) -> ToolResult:
        """TOOL-4: name -> client, limited to the viewer's coverage."""
        try:
            matches = self.resolver.resolve(query)
            if not matches:
                return _fail("NOT_FOUND", f"No client matches '{query}'")
            covered = self._covered(viewer)
            visible = [m for m in matches if m.client_id in covered]
            if not visible:
                return _fail(
                    "NOT_IN_COVERAGE", f"'{query}' matches a client outside {viewer.user_id}'s coverage"
                )
            if len(visible) > 1 and visible[0].confidence - visible[1].confidence < 0.05:
                return _fail(
                    "AMBIGUOUS", f"'{query}' matches several clients", [m.client_id for m in visible]
                )
            names = {
                r["client_id"]: r["legal_name"]
                for r in rows(self.conn, "SELECT client_id, legal_name FROM clients")
            }
            data = [
                {
                    "client_id": m.client_id,
                    "name": names[m.client_id],
                    "confidence": m.confidence,
                    "method": m.method,
                }
                for m in visible
            ]
            sources = [
                _sql_source(
                    f"clients/{m.client_id}",
                    names[m.client_id],
                    f"matched '{query}' to '{m.matched_name}' ({m.method})",
                )
                for m in visible
            ]
            return ToolResult(ok=True, data=data, sources=sources)
        except Exception as e:  # noqa: BLE001
            log.exception("resolve_client failed")
            return _fail("UNAVAILABLE", str(e))

    # ------------------------------------------------------------ TOOL-13

    def get_meetings(self, viewer: Viewer, client_id: str | None = None) -> ToolResult:
        """TOOL-13: upcoming meetings (from TODAY) for clients in the viewer's coverage."""
        covered = self._covered(viewer)
        ms = rows(
            self.conn,
            """SELECT m.*, c.legal_name FROM meetings m JOIN clients c USING (client_id)
                                WHERE m.start_time >= ? ORDER BY m.start_time""",
            (config.TODAY.isoformat(),),
        )
        ms = [
            m
            for m in ms
            if m["client_id"] in covered and (client_id is None or m["client_id"] == self._cid(client_id))
        ]
        for m in ms:
            m["our_attendees"], m["client_attendees"] = (
                jlist(m["our_attendees"]),
                jlist(m["client_attendees"]),
            )
        return ToolResult(ok=True, data=ms)

    # ------------------------------------------------------------ TOOL-15

    @tool
    def list_documents(self, viewer: Viewer, client_id: str) -> ToolResult:
        """TOOL-15: the client's documents the viewer may see, newest first: no duplicates, no
        quarantined news, entitlements applied (DATA-1). Metadata only; the text is read through
        API-6, which re-checks access."""
        cid = self._cid(client_id)
        docs = rows(
            self.conn,
            """SELECT doc_id, doc_type, title, date, author, classification, access_groups, derived,
                      stale, link_method FROM documents
               WHERE client_id=? AND duplicate_of IS NULL AND quarantined=0 ORDER BY date DESC""",
            (cid,),
        )
        visible = [d for d in docs if can_see(viewer, d["classification"], jlist(d["access_groups"]))]
        keys = [
            "doc_id",
            "doc_type",
            "title",
            "date",
            "author",
            "classification",
            "derived",
            "stale",
            "link_method",
        ]
        sources = [
            Citation(
                source_id=f"doc:{d['doc_id']}#0",
                kind=SourceKind.DOCUMENT,
                title=d["title"],
                date=date.fromisoformat(d["date"]) if d["date"] else None,
                snippet="",
            )
            for d in visible
        ]
        return ToolResult(
            ok=True,
            data=[{k: d[k] for k in keys} for d in visible],
            sources=sources,
            access_limited=len(visible) < len(docs),
        )

    # ------------------------------------------------------------ TOOL-14

    def search_clients(self, viewer: Viewer, query: str) -> ToolResult:
        """TOOL-14: find covered clients from free text, by legal name or alias. Matches a typed prefix
        ("north") or a name mentioned inside a sentence ("what is overdue for NWL?"). When nothing in
        coverage matches, falls back to TOOL-4 (fuzzy and alias resolution), which says a match is
        outside coverage without naming it. Not wrapped in @tool: its argument is free text, not a
        client_id, and coverage is applied to every result below."""
        q = " ".join(query.split()).lower()
        if not q:
            return ToolResult(ok=True, data=[])
        covered = self._covered(viewer)
        clients = rows(self.conn, "SELECT client_id, legal_name FROM clients ORDER BY legal_name")
        aliases = rows(self.conn, "SELECT alias, client_id FROM client_aliases")
        out = []
        for c in clients:
            if c["client_id"] not in covered:
                continue
            own = [a["alias"] for a in aliases if a["client_id"] == c["client_id"]]
            via = None
            if q not in c["legal_name"].lower():
                via = next((a for a in own if q in a.lower()), None)  # typed prefix of an alias
                if via is None:  # the client is named somewhere in a sentence
                    via = next((a for a in [c["legal_name"], *own] if _mentions(q, a)), None)
                if via is None:
                    continue
            out.append({"client_id": c["client_id"], "name": c["legal_name"], "matched_alias": via})
        if out:
            return ToolResult(ok=True, data=out)
        resolved = self.resolve_client(viewer, query)
        if resolved.ok:
            return ToolResult(
                ok=True,
                data=[
                    {"client_id": r["client_id"], "name": r["name"], "matched_alias": query}
                    for r in resolved.data
                ],
            )
        if resolved.error.code == "NOT_IN_COVERAGE":
            return ToolResult(
                ok=True, data=[], warnings=["A client matches, but it is outside your coverage"]
            )
        return ToolResult(ok=True, data=[])

    # ------------------------------------------------------------ TOOL-5

    @tool
    def get_client_profile(self, viewer: Viewer, client_id: str) -> ToolResult:
        """TOOL-5: master record, aliases, merges, coverage team, contacts (active or changed recently)."""
        cid = self._cid(client_id)
        c = rows(self.conn, "SELECT * FROM clients WHERE client_id=?", (cid,))[0]
        aliases = [
            r["alias"] for r in rows(self.conn, "SELECT alias FROM client_aliases WHERE client_id=?", (cid,))
        ]
        merged = rows(self.conn, "SELECT merged_id, rule FROM client_merge WHERE survivor_id=?", (cid,))
        team = rows(
            self.conn,
            """SELECT u.user_id, u.name, cv.coverage_role, cv.is_primary
                                  FROM coverage cv JOIN users u USING (user_id) WHERE cv.client_id=?""",
            (cid,),
        )
        since = (config.TODAY - timedelta(days=config.STALE_AFTER_DAYS)).isoformat()
        contacts = rows(
            self.conn,
            """SELECT * FROM contacts WHERE client_id=?
                                      AND (is_active=1 OR end_date >= ? OR start_date >= ?)
                                      ORDER BY is_active DESC, start_date DESC""",
            (cid, since, since),
        )
        for k in contacts:
            k["changed_recently"] = (k["start_date"] or "") >= since or (k["end_date"] or "") >= since
        sources = [
            _sql_source(
                f"clients/{cid}",
                c["legal_name"],
                f"{c['legal_name']}; {c['segment']}; {c['industry']}; HQ {c['hq_city']}, {c['hq_country']}; "
                f"client since {c['created_date']}; LEI {c['lei']}",
                c["created_date"],
                record=c,
            )
        ]
        sources += [
            _sql_source(
                f"contacts/{k['contact_id']}",
                f"Contact: {k['name']}",
                f"{k['name']}, {k['title']} ({'active' if k['is_active'] else 'inactive'}); "
                f"from {k['start_date']}" + (f" to {k['end_date']}" if k["end_date"] else ""),
                k["end_date"] or k["start_date"],
                record=k,
            )
            for k in contacts
        ]
        sources += [
            _sql_source(
                f"client_merge/{m['merged_id']}",
                f"Merged record {m['merged_id']}",
                f"{m['merged_id']} merged into {cid}: {m['rule']}",
                record=m,
            )
            for m in merged
        ]
        data = {
            "client": c,
            "aliases": aliases,
            "merged_ids": [m["merged_id"] for m in merged],
            "coverage_team": team,
            "contacts": contacts,
        }
        return ToolResult(ok=True, data=data, sources=sources)

    # ------------------------------------------------------------ TOOL-6

    @tool
    def get_revenue(self, viewer: Viewer, client_id: str) -> ToolResult:
        """TOOL-6: TTM, prior TTM and YoY by product line. No TTM if any of the last 4 quarters is missing."""
        cid = self._cid(client_id)
        current = _last_quarters(config.TODAY, 4)
        prior = _last_quarters(config.TODAY, 8)[:4]
        sql = (
            "SELECT * FROM revenue WHERE client_id=? AND period IN ({}) ORDER BY period, product_line".format(
                ",".join("?" * 8)
            )
        )
        params = (cid, *prior, *current)
        recs = rows(self.conn, sql, params)
        present = {r["period"] for r in recs}
        missing = [q for q in prior + current if q not in present]
        warnings = [f"Revenue for {q} not available" for q in missing]
        cur_ok = not any(q in missing for q in current)
        pri_ok = not any(q in missing for q in prior)
        if not cur_ok:
            warnings.append("Trailing twelve-month revenue cannot be computed (missing quarter)")

        def summarize(line: str | None) -> dict:
            sel = [r for r in recs if line is None or r["product_line"] == line]
            cur = sum(r["revenue_usd"] for r in sel if r["period"] in current) if cur_ok else None
            pri = sum(r["revenue_usd"] for r in sel if r["period"] in prior) if pri_ok else None
            yoy = round((cur - pri) / pri * 100, 1) if cur is not None and pri else None
            return {"current_ttm": cur, "prior_ttm": pri, "yoy_pct": yoy}

        lines = sorted({r["product_line"] for r in recs})
        by_line = [{"product_line": ln, **summarize(ln)} for ln in lines]
        total = summarize(None)
        quarterly = [
            {
                "period": q,
                "total": sum(r["revenue_usd"] for r in recs if r["period"] == q) if q in present else None,
            }
            for q in prior + current
        ]
        data = {
            "as_of_quarter": current[-1],
            "current_period": f"{current[0]}-{current[-1]}",
            "prior_period": f"{prior[0]}-{prior[-1]}",
            "total": total,
            "by_product_line": by_line,
            "quarterly": quarterly,
            "missing_quarters": missing,
        }

        # Computed figures get their own source so every number can be traced (TOOL-3, ORC-6)
        lines_txt = "; ".join(
            f"{b['product_line']}: {_usd(b['current_ttm'])} vs {_usd(b['prior_ttm'])}"
            + (f" ({b['yoy_pct']:+.1f}%)" if b["yoy_pct"] is not None else "")
            for b in by_line
        )
        summary = (
            f"Relationship revenue TTM {data['current_period']}: {_usd(total['current_ttm'])}; prior TTM "
            f"{data['prior_period']}: {_usd(total['prior_ttm'])}"
            + (f"; YoY {total['yoy_pct']:+.1f}%" if total["yoy_pct"] is not None else "")
            + f". By product line: {lines_txt}. Quarterly totals: "
            + ", ".join(f"{q['period']} {_usd(q['total'])}" for q in quarterly)
            + (f". Missing: {', '.join(missing)}" if missing else "")
            + f". Computed from {len(recs)} revenue rows."
        )
        sources = [
            _sql_source(
                f"revenue/{cid}/summary",
                "Relationship revenue summary",
                summary,
                calculation=_revenue_calculation(sql, params, recs, data, current, prior),
            )
        ]
        sources += [
            _sql_source(
                f"revenue/{cid}/{r['period']}/{r['product_line']}",
                f"Revenue {r['period']} {r['product_line']}",
                f"{r['period']} {r['product_line']}: {_usd(r['revenue_usd'])}"
                + (f" (booked under {r['source_client_id']})" if r["source_client_id"] != cid else ""),
                record=r,
            )
            for r in recs
        ]
        return ToolResult(ok=True, data=data, sources=sources, warnings=warnings)

    # ------------------------------------------------------------ TOOL-7

    @tool
    def get_holdings(self, viewer: Viewer, client_id: str) -> ToolResult:
        """TOOL-7: products held, with maturity-within-12-months flag."""
        cid = self._cid(client_id)
        horizon = (config.TODAY + timedelta(days=365)).isoformat()
        holdings_sql = "SELECT * FROM holdings WHERE client_id=? ORDER BY holding_id"
        hs = rows(self.conn, holdings_sql, (cid,))
        for h in hs:
            h["matures_within_12m"] = bool(h["maturity_date"] and h["maturity_date"] <= horizon)

        def maturity_calc(h: dict) -> Calculation | None:
            if not h["maturity_date"]:
                return None
            within = "within 12 months" if h["matures_within_12m"] else "not within 12 months"
            return Calculation(
                rule=f"A facility matures within 12 months when its maturity date is on or before "
                f"{_day(horizon)} (today, {_day(config.TODAY.isoformat())}, plus 365 days).",
                query=_shown_sql(holdings_sql, (cid,)),
                inputs=[{k: h[k] for k in ("holding_id", "product", "maturity_date")}],
                steps=[f"Matures {_day(h['maturity_date'])}, compared with {_day(horizon)}: {within}"],
            )

        sources = [
            _sql_source(
                f"holdings/{h['holding_id']}",
                h["product"],
                f"{h['product']} ({h['status']})"
                + (f", {_usd(h['notional_usd'])}" if h["notional_usd"] else "")
                + f", opened {h['opened_date']}"
                + (f", matures {h['maturity_date']}" if h["maturity_date"] else "")
                + (f". {h['notes']}" if h["notes"] else ""),
                h["opened_date"],
                record=h,
                calculation=maturity_calc(h),
            )
            for h in hs
        ]
        return ToolResult(ok=True, data=hs, sources=sources)

    # ------------------------------------------------------------ TOOL-8

    @tool
    def get_financials(self, viewer: Viewer, client_id: str) -> ToolResult:
        """TOOL-8: the client's own reported financials."""
        cid = self._cid(client_id)
        fs = rows(self.conn, "SELECT * FROM financials WHERE client_id=? ORDER BY fiscal_period", (cid,))
        sources = [
            _sql_source(
                f"financials/{cid}/{f['fiscal_period'].replace(' ', '_')}",
                f"Financials {f['fiscal_period']}",
                f"{f['fiscal_period']}: company revenue ${f['company_revenue_usd_m']:,.0f}M, EBITDA margin "
                f"{f['ebitda_margin_pct']}%, net leverage {f['net_leverage_x']}x (source: {f['source']})",
                record=f,
            )
            for f in fs
        ]
        warnings = [] if fs else ["No reported financials available"]
        return ToolResult(ok=True, data=fs, sources=sources, warnings=warnings)

    # ------------------------------------------------------------ TOOL-9

    @tool
    def get_pipeline(self, viewer: Viewer, client_id: str) -> ToolResult:
        """TOOL-9: opportunities (row-level entitlement), service issues, open actions with overdue flag."""
        cid = self._cid(client_id)
        today = config.TODAY.isoformat()
        opps_all = rows(self.conn, "SELECT * FROM opportunities WHERE client_id=? ORDER BY opp_id", (cid,))
        opps = [o for o in opps_all if can_see(viewer, o["classification"], jlist(o["access_groups"]))]
        issues_all = rows(
            self.conn, "SELECT * FROM service_issues WHERE client_id=? ORDER BY opened_date", (cid,)
        )
        issues = [i for i in issues_all if can_see(viewer, i["classification"], jlist(i["access_groups"]))]
        actions_sql = "SELECT * FROM open_actions WHERE client_id=? ORDER BY due_date"
        actions = rows(self.conn, actions_sql, (cid,))
        for a in actions:
            a["overdue"] = a["status"] == "open" and a["due_date"] < today
            a["days_overdue"] = (config.TODAY - date.fromisoformat(a["due_date"])).days if a["overdue"] else 0

        def overdue_calc(a: dict) -> Calculation | None:
            if a["status"] != "open":
                return None
            due, now = _day(a["due_date"]), _day(today)
            step = (
                f"Due {due}, today {now}: {a['days_overdue']} days overdue"
                if a["overdue"]
                else f"Due {due} is not before today ({now}): not overdue"
            )
            return Calculation(
                rule="An open action is overdue when its due date is before today. "
                "Days overdue = today minus the due date.",
                query=_shown_sql(actions_sql, (cid,)),
                inputs=[{k: a[k] for k in ("action_id", "status", "due_date")}],
                steps=[step],
            )

        sources = [
            _sql_source(
                f"opportunities/{o['opp_id']}",
                o["product"],
                f"{o['product']}: stage {o['stage']}, est. revenue {_usd(o['est_revenue_usd'])}, "
                f"{o['probability_pct']}% probability, owner {o['owner']}; next step: {o['next_step']} "
                f"(updated {o['last_updated']})",
                o["last_updated"],
                record=o,
            )
            for o in opps
        ]
        sources += [
            _sql_source(
                f"service_issues/{i['issue_id']}",
                f"Service issue {i['issue_id']}",
                f"{i['summary']} (severity {i['severity']}, {i['status']}, opened {i['opened_date']}"
                + (f", resolved {i['resolved_date']})" if i["resolved_date"] else ")"),
                i["opened_date"],
                record=i,
            )
            for i in issues
        ]
        sources += [
            _sql_source(
                f"open_actions/{a['action_id']}",
                f"Action {a['action_id']}",
                f"{a['description']} (owner {a['owner']}, due {a['due_date']}, {a['status']}"
                + (f", OVERDUE by {a['days_overdue']} days" if a["overdue"] else "")
                + ")",
                a["due_date"],
                record=a,
                calculation=overdue_calc(a),
            )
            for a in actions
        ]
        data = {"opportunities": opps, "service_issues": issues, "open_actions": actions}
        limited = len(opps) < len(opps_all) or len(issues) < len(issues_all)
        return ToolResult(ok=True, data=data, sources=sources, access_limited=limited)

    # ------------------------------------------------------------ TOOL-10

    @tool
    def get_interactions(self, viewer: Viewer, client_id: str, limit: int = 10) -> ToolResult:
        """TOOL-10: interaction log; last_interaction_date defines the 'since' cut-off for changes."""
        cid = self._cid(client_id)
        its = rows(
            self.conn, "SELECT * FROM interactions WHERE client_id=? ORDER BY date DESC LIMIT ?", (cid, limit)
        )
        sources = [
            _sql_source(
                f"interactions/{i['interaction_id']}",
                i["subject"],
                f"{i['date']} {i['type']}: {i['subject']} (with {', '.join(jlist(i['client_attendees']))})",
                i["date"],
                record=i,
            )
            for i in its
        ]
        warnings = [] if its else ["No logged interactions"]
        data = {"last_interaction_date": its[0]["date"] if its else None, "interactions": its}
        return ToolResult(ok=True, data=data, sources=sources, warnings=warnings)

    # ------------------------------------------------------------ TOOL-11

    @tool
    def search_documents(
        self,
        viewer: Viewer,
        client_id: str,
        queries: str | list[str],
        doc_types: list[str] | None = None,
        since: str | None = None,
        k: int = 8,
    ) -> ToolResult:
        """TOOL-11: hybrid BM25 + vector search, fused with reciprocal rank fusion.
        Filters (client link, entitlement, dedup, approved news, type, date) apply BEFORE ranking."""
        from briefing.embeddings import embed_queries

        cid = self._cid(client_id)
        queries = [queries] if isinstance(queries, str) else queries
        if not queries or not any(q.strip() for q in queries):
            return _fail("INVALID_INPUT", "At least one non-empty query is required")

        general_types = ",".join("?" * len(GENERAL_DOC_TYPES))
        sql = f"""
            SELECT c.chunk_id, c.text, c.suspected_injection, d.*
            FROM chunks c JOIN documents d USING (doc_id)
            WHERE c.indexed = 1
              AND (d.client_id = ? OR (d.client_id IS NULL AND d.doc_type IN ({general_types})))
        """
        params: list = [cid, *GENERAL_DOC_TYPES]
        if doc_types:
            sql += f" AND d.doc_type IN ({','.join('?' * len(doc_types))})"
            params += doc_types
        if since:
            sql += " AND d.date >= ?"
            params.append(since)
        candidates = rows(self.conn, sql, tuple(params))
        allowed = {
            c["chunk_id"]: c
            for c in candidates
            if can_see(viewer, c["classification"], jlist(c["access_groups"]))
        }
        limited = len(allowed) < len(candidates)
        if not allowed:
            return ToolResult(ok=True, data=[], warnings=["No matching documents"], access_limited=limited)

        rankings: list[list[str]] = []
        for q in queries:  # BM25 per query, restricted to allowed chunks
            terms = " OR ".join(f'"{t}"' for t in re.findall(r"[A-Za-z0-9]+", q))
            if terms:
                hits = rows(
                    self.conn,
                    "SELECT chunk_id FROM chunk_fts WHERE chunk_fts MATCH ? ORDER BY bm25(chunk_fts)",
                    (terms,),
                )
                rankings.append([h["chunk_id"] for h in hits if h["chunk_id"] in allowed])
        ids = list(allowed)
        vecs = {
            r["chunk_id"]: np.frombuffer(r["vec"], dtype=np.float32)
            for r in rows(
                self.conn,
                f"SELECT chunk_id, vec FROM chunk_vectors WHERE chunk_id IN ({','.join('?' * len(ids))})",
                tuple(ids),
            )
        }
        ids = [i for i in ids if i in vecs]
        if ids:
            matrix = np.stack([vecs[i] for i in ids])
            for qv in embed_queries(queries):  # one batched embedding call for all queries
                order = np.argsort(-(matrix @ qv))
                rankings.append([ids[j] for j in order])

        scores: dict[str, float] = {}
        for ranking in rankings:
            for rank, chunk_id in enumerate(ranking):
                scores[chunk_id] = scores.get(chunk_id, 0.0) + 1.0 / (RRF_K + rank + 1)
        top = sorted(scores, key=lambda c: -scores[c])[:k]

        data, sources = [], []
        for chunk_id in top:
            c = allowed[chunk_id]
            data.append(
                {
                    "chunk_id": chunk_id,
                    "doc_id": c["doc_id"],
                    "doc_type": c["doc_type"],
                    "title": c["title"],
                    "date": c["date"],
                    "author": c["author"],
                    "text": c["text"],
                    "score": round(scores[chunk_id], 4),
                    "derived": bool(c["derived"]),
                    "stale": bool(c["stale"]),
                    "suspected_injection": bool(c["suspected_injection"]),
                    "link_method": c["link_method"],
                    "link_confidence": c["link_confidence"],
                    "classification": c["classification"],
                }
            )
            sources.append(
                Citation(
                    source_id=f"doc:{chunk_id}",
                    kind=SourceKind.DOCUMENT,
                    title=c["title"],
                    date=date.fromisoformat(c["date"]),
                    snippet=c["text"],
                )
            )
        return ToolResult(ok=True, data=data, sources=sources, access_limited=limited)


def _last_quarters(today: date, n: int) -> list[str]:
    """Last n complete quarters before `today`, oldest first (2026-11-16 -> ..., 2026Q3)."""
    year, q = today.year, (today.month - 1) // 3  # quarter before the current one
    if q == 0:
        year, q = year - 1, 4
    out = []
    for _ in range(n):
        out.append(f"{year}Q{q}")
        q -= 1
        if q == 0:
            year, q = year - 1, 4
    return out[::-1]
