# 02 — Ingestion & unification

Status: Implemented in the prototype · Entry point: `uv run python -m briefing.ingest` · No LLM calls.

Output: `var/briefing.db` (SQLite) + `var/ingestion_report.json`. Re-running is idempotent
(drops and rebuilds).

## Requirements

**ING-1 Load.** Load every CSV in `data/structured/` into SQLite tables named after the file.
Parse dates, booleans, `;`-separated lists. Missing optional columns get defaults
(`classification=internal`, `access_groups=[]`).

**ING-2 Client master unification.** Group `clients` rows by LEI. Survivor = earliest
`created_date`. Write `client_merge(merged_id, survivor_id, rule, evidence)`.
Every table with `client_id` is rewritten to the survivor ID (keep `source_client_id`).
Merged record's aliases and short_name are added to the survivor's aliases.
Acceptance: C-007 → C-002; Helios TTM revenue query returns 3,500,000 (T5).

**ING-3 Entity resolution (name → client).** `resolve(name) -> [(client_id, confidence, method)]`:
1. Exact, case-insensitive match on alias / legal_name / short_name → confidence 1.0, `exact`.
2. Else fuzzy (rapidfuzz `token_set_ratio` on normalized names, legal suffixes stripped)
   ≥ 90 → confidence = min(0.95, score/100), `fuzzy`, **unless** the query contains a
   distinguishing token absent from all of the client's names (e.g. "Systems" vs "Partners")
   → reject. Generic corporate words (holdings, group, company, international, global) are not
   distinguishing. Names shorter than 4 characters (e.g. "CHP") match exactly only.
3. Otherwise unresolved.
Acceptance: "Northwind Logistics Holdings" → C-001 fuzzy (T1);
"Cascade Health Systems" → unresolved (T10).

**ING-4 Document linking.** For each document:
- `client_id` present → linked, confidence 1.0, method `source_id`.
- absent → resolve each `mentions` entry. Only when `mentions` is empty, fall back to scanning
  the title/body for known names (scanning a tagged article would re-link "Cascade Health
  Systems" through the substring "Cascade Health"). One client wins → linked with method `inferred`, confidence = min(0.9, best score).
  Multiple clients → `ambiguous`, not linked. None → unlinked.
- The source ID is mapped through ING-2 merges.
Acceptance: nw_call_006 linked to C-001, method `inferred`, confidence ≤ 0.9 (T2).

**ING-5 Dedup.** Normalize body (lowercase, collapse whitespace, strip forwarded headers and
quoted prefixes). Exact hash match or `token_set_ratio ≥ 95` with the same client and dates
within 7 days → later document gets `duplicate_of = <earlier doc_id>` and is not indexed.
Same date → the longer document is the duplicate (forwards and replies quote the original).
Acceptance: nw_email_001_fw duplicate_of nw_email_001 (T3).

**ING-6 Staleness / derivation.** `prior_briefing` documents are flagged `derived = true`
(secondary source; lower authority than structured data and primary communications).
Any document older than 180 days before "today" gets `stale = true`.

**ING-7 News approval.** News with `approved: false` is quarantined (stored, never indexed).
Acceptance: news_ca_001 not in the index (T9).

**ING-8 Injection screening.** Each chunk is scanned with pattern rules (e.g. "ignore
(all|previous) instructions", "you are an AI", "system prompt", instructions addressed to an
assistant). Matches set `suspected_injection = true`. The chunk stays retrievable (it may hold
real facts) but is labelled and passed to the model inside a fenced untrusted-content block.
Acceptance: nw_email_007 has a flagged chunk (T11).

**ING-9 Chunking.** Split bodies on paragraph boundaries into ~800-character chunks (no
splitting inside a paragraph unless it exceeds 1,600 chars). Each chunk inherits document
metadata. `chunk_id = <doc_id>#<n>`.

**ING-10 Indexing.** SQLite FTS5 table over chunk text (BM25) + embeddings from fastembed
`BAAI/bge-small-en-v1.5` stored as float32 blobs. Only non-duplicate, non-quarantined chunks.
Model cached in `var/models/` (not `/tmp`, which WSL may clear), loaded once per process,
query embeddings batched per briefing. Measured: ~6.6 s to embed 120 chunks (one-time),
~0.04 s for 28 batched queries, ~12 ms similarity over all chunks.

**ING-11 Ingestion report.** JSON with counts (rows per table, docs, chunks), merges,
links by method, unresolved/ambiguous docs, duplicates, quarantined news, injection flags.
Shown on the data page (UI-15).

**ING-12 Quality checks.** After unification, run checks on the data. Each check is a SQL query
that returns the rows breaking it, with a severity:
- **error:** the data is wrong. Examples: a record for an unknown client, two clients with one LEI,
  an original record reporting a quarter and product line twice, negative revenue, no primary banker
  or more than one, an unknown owner, a facility maturing before it opens, a contact leaving before
  joining, a probability outside 0 to 100.
- **warning:** a gap the app reports instead of filling, such as a client missing one of the last 8
  revenue quarters.
- **info:** rows held out on purpose, such as news about a look-alike company.

Results (pass, failure count, up to 5 failing rows, the SQL) go in the ingestion report. Nothing is
fixed or hidden. After a merge, two records' rows for the same quarter are both real (Helios's green
loan was booked under C-007), so uniqueness is checked per original record (`source_client_id`).

## Tests (pytest, `tests/test_ingestion.py`)

`test_ING_2_lei_merge`, `test_ING_3_alias_exact`, `test_ING_3_fuzzy_holdings`,
`test_ING_3_rejects_name_collision`, `test_ING_4_missing_id_linked`, `test_ING_5_forward_dedup`,
`test_ING_7_unapproved_news_quarantined`, `test_ING_8_injection_flagged`.
