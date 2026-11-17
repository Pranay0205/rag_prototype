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
| API-4 | `GET /briefings/{id}/stream` | SSE: `figures` (ORC-13), `exhibits` (ORC-14), then `section`, `briefing`, `error` events |
| API-5 | `GET /briefings/{id}` | Full `Briefing` JSON (after done) |
| API-6 | `GET /sources/{source_id}?user_id=` | Full source text for the citation drawer (entitlement re-checked) |
| API-7 | `POST /briefings/{id}/claims/{claim_id}/review` `{decision: accept\|reject\|clear, note}` | Human review; appended with user + timestamp, latest wins, `clear` undoes. A reject carries a reason in `note` (wrong, outdated, not_relevant) |
| API-8 | `POST /actions` `{client_id, kind, description, owner, due, citations}` | Create follow-up / flag stale |
| API-9 | `POST /clients/{id}/notes` `{user_id, text}` | Post-meeting notes → proposed commitments (fast model); returns proposals, nothing saved until confirmed |
| API-10 | `GET /health/data` | Ingestion report (ING-11) |
| API-11 | `GET /briefings/latest?user_id&client_id[&briefing_id]` | The viewer's last saved briefing with their reviews and created actions; `stale` if data was re-ingested since. Saved per viewer, never shared; coverage re-checked on read; not served if the viewer's clearance or groups changed since (must regenerate). User state lives in `var/app.db`, separate from the rebuildable source DB |
| API-13 | `GET /clients/search?user_id&q` | Company search (TOOL-14); `notice` when only an out-of-coverage client matches |
| API-14 | `POST /clients/{id}/ask` `{user_id, question}` | Cited, verified answer (ORC-15) |
| API-15 | `GET /home?user_id` | Dashboard: upcoming meetings (with whether a briefing is prepared), covered companies with revenue TTM and YoY, facilities sorted by maturity |
| API-12 | `GET /briefings/history?user_id&client_id` | The viewer's own saved versions for a client, newest first: `briefing_id`, `created_at`, `stale`, claim / verified / conflict counts. Opening one goes through API-11 with `briefing_id`, so the same access checks apply |

Errors: tool error codes map to HTTP (`FORBIDDEN`/`NOT_IN_COVERAGE` → 403, `NOT_FOUND` → 404,
`AMBIGUOUS` → 409 with candidates, `UNAVAILABLE` → 503).

## UI (React, single page)

**UI-1 Header:** user switcher (alex / sam / kim) showing role and clearance; switching
clears the current briefing.

**UI-2 Left rail:** replaced by UI-11 (home cards). Originally: upcoming meetings and a client
search box.

**UI-3 Briefing panel:** meeting header (client, time, attendee chips with title and a New tag);
key figure cards (ORC-13), exhibits inside their sections (ORC-14),
clickable to their rows; seven section cards in fixed
order, each with skeleton loading → content as SSE arrives; confidence badge per section;
each claim shows status (verified / unverified / conflict), inline numbered citation markers
(hover shows the quote, click opens the drawer) and numbered citation chips. The header's
"Prepared ..." menu lists past versions (API-12).

**UI-4 Citation drawer:** clicking a citation opens the source. Documents (API-6) show the
cited sentence highlighted, source type, date and authority flags (derived, stale, inferred link,
suspected injection). Structured sources show the database row itself (`Citation.record`) as a
field table, named by table and record ID, with the sentence the model was given beneath it.

**UI-5 Side rails – "Needs attention":** left: what to do before the meeting (actions by urgency,
access notice); right: conflicts and gaps. Originally one right rail: conflicts (both values side by side + resolution),
unknowns, `access_limited` notice ("Some sources are not available at your access level"),
suggested actions with Create / Dismiss.

**UI-6 Claim review:** accept / reject per claim (click again to undo); reject asks why (wrong,
outdated, not relevant). Rejected claims fade and are excluded from export. The header shows
review progress ("12/34 reviewed", "Reviewed" when complete). The exported markdown records
who reviewed it and how many claims were checked and removed.

**UI-7 Export:** copy-as-markdown of accepted + unreviewed claims with citations.

**UI-8 Post-meeting capture:** text area → proposed commitments list → confirm creates actions.

**UI-9 Data health:** small panel/modal showing the ingestion report.

**UI-10 Cost & latency footer:** tokens, cost (if provider reports it), generation time.

**UI-11 Home:** after sign-in, three cards: Meetings (time, purpose, attendees, briefing ready or
not), Companies (industry, our role, revenue TTM and YoY, aliases) and Facilities & maturities
(notional, maturity, amber when within 12 months, utilization). Replaces the meeting sidebar.

**UI-12 Top bar:** brand (home) and the profile menu (switch profile, data health, sign out). A
company search box was tried and removed: the home cards list every covered client, and the chat
picks its client. API-13 remains available. Browser Back / Forward and reload follow the open
meeting (`#/meeting/<id>`); the briefing page has a Home link.

**UI-13 Ask chat:** a floating chat on every page (bottom right, clear of the attention panel on the left). Typing is never blocked. While
the user types, the client named in the question is detected (API-13, aliases included) and shown
("About Northwind Logistics, from NWL"); otherwise the client on screen is used; with neither, the
chat keeps the question and asks which client it is about. Suggested questions; each answer shows
inline citations, Verified / Check sources per claim and what the data does not contain.
Conversations are kept per client while the app is open.

## Priorities for tonight

Must: UI-1, 2, 3, 4, 5. Should: UI-6, 7, 8. Could: UI-9, 10.
