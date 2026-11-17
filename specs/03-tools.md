# 03 — Tool contracts

Status: DRAFT for review · Module: `briefing.tools` · No LLM calls inside tools.

Tools are methods on `Tools(conn)`. The envelope is a typed Pydantic model; `data` is a plain
dict/list whose shape is documented on each tool (per-tool output models are a planned
extension, and would also generate the MCP schemas). The orchestrator calls tools directly;
the same contracts can be exposed over MCP later without change (TOOL-12).

## Envelope

```python
class ToolResult(BaseModel):
    ok: bool
    data: Any                    # dict/list, shape documented per tool
    sources: list[Citation]      # every row/chunk the data came from (schemas.Citation, reused)
    warnings: list[str]          # e.g. "Revenue for 2026Q3 not available"
    error: ToolError | None
    access_limited: bool         # something was withheld by entitlement; never a count

class ToolError(BaseModel):
    code: Literal["NOT_FOUND", "AMBIGUOUS", "FORBIDDEN", "NOT_IN_COVERAGE", "INVALID_INPUT", "UNAVAILABLE"]
    message: str
    candidates: list[str] = []   # for AMBIGUOUS
```

`Citation` (schemas.py): `source_id` ("sql:revenue/C-001/summary", "doc:nw_email_001#0"),
`kind` (sql | document), `title`, `date`, `snippet` (row rendering or chunk text).
Computed values (TTM, YoY) get their own summary source so each number is traceable.

**TOOL-1 Viewer context.** Every tool takes `viewer: Viewer` as first argument.
Entitlement (DATA-1) and coverage (DATA-2) are enforced inside the tool. Filtered records are
silently excluded; if anything was excluded the result sets an internal flag that becomes
`Briefing.access_limited` — never a count.

**TOOL-2 Errors are values.** Tools never raise for expected conditions; they return
`ok=false` with an error code. Unexpected exceptions are caught by a decorator and returned
as `UNAVAILABLE` with the exception logged.

**TOOL-3 Every datum is sourced.** Any value in `data` must be traceable to an entry in
`sources`. Computed values (TTM, YoY) list all rows they were computed from.

## Tools

| ID | Signature | Returns | Notes |
|---|---|---|---|
| TOOL-4 | `resolve_client(viewer, query)` | `[{client_id, name, confidence, method}]` | ING-3; `AMBIGUOUS` if top two within 0.05; `NOT_IN_COVERAGE` if the only match is outside coverage |
| TOOL-5 | `get_client_profile(viewer, client_id)` | master record, aliases, merged IDs, coverage team, contacts (active + changed in last 180 days, with start/end dates) | Contact changes feed "what changed" |
| TOOL-6 | `get_revenue(viewer, client_id)` | per product line: current TTM, prior TTM, YoY %, last 8 quarters | Warning + no TTM if any of the last 4 quarters is missing (T8) |
| TOOL-7 | `get_holdings(viewer, client_id)` | holdings incl. maturity within 12 months flag | |
| TOOL-8 | `get_financials(viewer, client_id)` | company revenue, EBITDA margin, leverage by period | |
| TOOL-9 | `get_pipeline(viewer, client_id)` | opportunities (row-level entitlement), service issues, open actions with `overdue` computed vs today | |
| TOOL-10 | `get_interactions(viewer, client_id, limit)` | interaction log + `last_interaction_date` | Defines the "since" cut-off for changes |
| TOOL-11 | `search_documents(viewer, client_id, queries, doc_types=None, since=None, k=8)` | ranked chunks | `queries` is one string or a list; each query is ranked by BM25 and by vector similarity, and all rankings are fused with reciprocal-rank fusion (query embeddings batched). Candidate set = chunks linked to the client **plus** unlinked `research` / `product_update` chunks (firm-wide content that supports opportunities); unlinked news is never included (T10). Filters (entitlement, client link, not duplicate, approved, type, date) apply **before** ranking. Chunks carry `derived`, `stale`, `suspected_injection`, `link_method`, `link_confidence` |
| TOOL-13 | `get_meetings(viewer, client_id=None)` | upcoming meetings in the viewer's coverage | Used by ORC-1 (meeting header) and API-2 |
| TOOL-14 | `search_clients(viewer, query)` | covered clients from free text: a typed prefix of a legal name or alias, or a name mentioned inside a sentence ("overdue for NWL?"); falls back to TOOL-4 | A match outside coverage is reported without naming the client (API-13) |
| TOOL-12 | MCP exposure | — | Extension: same functions registered as MCP tools; not in v1 |

## Tests (`tests/test_tools.py`)

`test_TOOL_1_sam_cannot_see_confidential`, `test_TOOL_1_alex_cannot_see_restricted`,
`test_TOOL_1_kim_sees_aurora`, `test_TOOL_1_kim_not_in_coverage_for_northwind`,
`test_TOOL_6_northwind_ttm`, `test_TOOL_6_cascade_missing_quarter`,
`test_TOOL_9_overdue_actions`, `test_TOOL_11_filters_before_ranking`.
