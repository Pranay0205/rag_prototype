# 05 — API & briefing workspace UX

Status: DRAFT for review

## Workflow the UI supports

```
1 Trigger    upcoming meetings list → "Prepare briefing"
2 Generate   sections stream in, each with citations + confidence
3 Review     analyst accepts / rejects claims; inspects conflicts & unknowns
4 Act        create follow-ups, flag stale data, verify-with-owner tasks
5 Share      export approved briefing (markdown), role-filtered
6 Close loop paste post-meeting notes → extracted commitments → confirm → open actions
             → next briefing's "what changed" reflects them
```

## API (FastAPI, JSON; `/api` prefix)

| ID | Method & path | Purpose |
|---|---|---|
| API-1 | `GET /users` | Users for the switcher |
| API-2 | `GET /meetings?user_id=` | Upcoming meetings in the user's coverage |
| API-3 | `POST /briefings` `{user_id, client_id \| meeting_id}` | Start a briefing; returns `briefing_id` |
| API-4 | `GET /briefings/{id}/stream` | SSE: `section`, `conflicts`, `actions`, `done`, `error` events |
| API-5 | `GET /briefings/{id}` | Full `Briefing` JSON (after done) |
| API-6 | `GET /sources/{source_id}?user_id=` | Full source text for the citation drawer (entitlement re-checked) |
| API-7 | `POST /briefings/{id}/claims/{claim_id}/review` `{decision: accept\|reject, note}` | Human review; stored with user + timestamp |
| API-8 | `POST /actions` `{client_id, kind, description, owner, due, citations}` | Create follow-up / flag stale |
| API-9 | `POST /clients/{id}/notes` `{user_id, text}` | Post-meeting notes → proposed commitments (fast model); returns proposals, nothing saved until confirmed |
| API-10 | `GET /health/data` | Ingestion report (ING-11) |
| API-11 | `GET /briefings/latest?user_id&client_id[&briefing_id]` | The viewer's last saved briefing with their reviews and created actions; `stale` if data was re-ingested since. Saved per viewer, never shared; coverage re-checked on read; not served if the viewer's clearance or groups changed since (must regenerate). User state lives in `var/app.db`, separate from the rebuildable source DB |
| API-12 | `GET /briefings/history?user_id&client_id` | The viewer's own saved versions for a client, newest first: `briefing_id`, `created_at`, `stale`, claim / verified / conflict counts. Opening one goes through API-11 with `briefing_id`, so the same access checks apply |

Errors: tool error codes map to HTTP (`FORBIDDEN`/`NOT_IN_COVERAGE` → 403, `NOT_FOUND` → 404,
`AMBIGUOUS` → 409 with candidates, `UNAVAILABLE` → 503).

## UI (React, single page)

**UI-1 Header:** user switcher (alex / sam / kim) showing role and clearance; switching
clears the current briefing.

**UI-2 Left rail:** upcoming meetings for the user; client search box (uses resolve_client;
ambiguous → pick list).

**UI-3 Briefing panel:** meeting header (client, time, attendees); seven section cards in fixed
order, each with skeleton loading → content as SSE arrives; confidence badge per section;
each claim shows status (verified / unverified / conflict), inline numbered citation markers
(hover shows the quote, click opens the drawer) and numbered citation chips. The header's
"Prepared ..." menu lists past versions (API-12).

**UI-4 Citation drawer:** clicking a chip opens the source (API-6) with the cited snippet
highlighted, source type, date and authority flags (derived, stale, inferred link,
suspected injection).

**UI-5 Right rail – "Needs attention":** conflicts (both values side by side + resolution),
unknowns, `access_limited` notice ("Some sources are not available at your access level"),
suggested actions with Create / Dismiss.

**UI-6 Claim review:** accept / reject per claim; rejected claims collapse and are excluded
from export.

**UI-7 Export:** copy-as-markdown of accepted + unreviewed claims with citations.

**UI-8 Post-meeting capture:** text area → proposed commitments list → confirm creates actions.

**UI-9 Data health:** small panel/modal showing the ingestion report.

**UI-10 Cost & latency footer:** tokens, cost (if provider reports it), generation time.

## Priorities for tonight

Must: UI-1, 2, 3, 4, 5. Should: UI-6, 7, 8. Could: UI-9, 10.
