# 00 — Overview: Client Meeting Briefing Intelligence

Status: Implemented in the prototype · Owner: Pranay · Last updated: 2026-11-17

## Problem

Before a client meeting, coverage analysts manually search CRM, revenue reports, prior
briefings, emails, call notes and news, then write a briefing by hand. It is slow, misses
open commitments, repeats stale facts, and can leak restricted information.

## Users

| User | Needs |
|---|---|
| Relationship manager (RM) | A trustworthy briefing in minutes; what to raise and what to avoid |
| Analyst | Prepares and reviews the briefing; follows up on actions |
| Deal-team banker | Same, but entitled to restricted deal information for their project only |

## Goals

- G1. Produce a cited briefing answering the 7 questions (see 04-orchestration) in < 60 s.
- G2. Every claim traceable to a source of record; numbers come only from structured data.
- G3. Never expose a record the viewer is not entitled to, directly or by implication.
- G4. Surface conflicts, stale data and gaps explicitly instead of hiding them.
- G5. Turn the briefing into a workflow: review claims, create follow-ups, capture post-meeting notes.
- G6. Be measurable: an evaluation suite proves G2–G4 before anyone relies on it.

## Non-goals (prototype)

- Real CRM/email/calendar integrations (synthetic data pack stands in).
- Real authentication (a user switcher simulates the signed-in user).
- Multi-tenant scale, high availability, production model hosting.

## Design principles

- P1. **Numbers come from SQL, never from the model.** The model may only restate numbers that appear in a cited structured source.
- P2. **Cite or omit.** A claim without a valid citation is not shown as fact; it becomes an Unknown.
- P3. **Entitlements before retrieval.** Restricted data is filtered inside the tools, so it never reaches the model's context.
- P4. **Fail visibly.** Missing, stale and conflicting data is reported in the briefing, not papered over.
- P5. **Untrusted text is data.** Emails, notes and news are never treated as instructions.
- P6. **Deterministic where possible, LLM where necessary.** See the boundary table.

## Architecture

```
 Source exports (CSV + markdown docs)
            │
            ▼
 ┌──────────────────────────┐   01-data, 02-ingestion
 │ Ingestion & unification  │   entity resolution, dedup, staleness,
 │ (deterministic)          │   entitlement tags, injection screening
 └──────────┬───────────────┘
            ▼
 ┌──────────────────────────┐
 │ SQLite: clean tables     │◄── structured facts (exact)
 │ + FTS5 (BM25) + vectors  │◄── document chunks (narrative)
 └──────────┬───────────────┘
            ▼
 ┌──────────────────────────┐   03-tools
 │ Typed tools (entitlement │   every result: data + sources + warnings
 │ enforced inside)         │
 └──────────┬───────────────┘
            ▼
 ┌──────────────────────────┐   04-orchestration
 │ Orchestrator             │   authorize → gather → retrieve per section
 │                          │   → generate (LLM) → verify → assemble
 └──────────┬───────────────┘
            ▼
 ┌──────────────────────────┐   05-api-ui
 │ FastAPI (SSE) + React    │   briefing workspace, review, actions
 └──────────────────────────┘
            ▲
 ┌──────────────────────────┐   06-eval
 │ Eval harness             │   golden answers, traps, red team, gates
 └──────────────────────────┘
```

## LLM boundary

| Step | LLM? | Why |
|---|---|---|
| Load and unify client master, merge duplicates | No | Exact rules (LEI match) are auditable |
| Resolve aliases / link documents to clients | No (fuzzy match) | Deterministic with confidence; LLM tie-break is a documented extension |
| Dedup, staleness, entitlement tagging, news approval filter | No | Rules, must be predictable |
| Retrieval (BM25 + vector) | No (embedding model only) | |
| Metrics, TTM, YoY, overdue checks | No | Arithmetic in SQL/Python |
| Writing each briefing section from evidence | **Yes (strong model)** | Synthesis of narrative + facts |
| Citation validity, number checks | No | Deterministic verifier |
| Claim-supported-by-snippet check | **Yes (fast model)** | Semantic entailment |
| Extracting commitments from post-meeting notes | **Yes (fast model)** | Free text → structured; human confirms |
| Choosing tools for a question across clients (ORC-16) | **Yes (fast model)** | Free-form questions need a plan; the tools still enforce access |
| Explaining the app's own labels (ORC-15) | No (written glossary) | A model guessed what "Check sources" means and got it wrong |
| Eval: fact recall judging | **Yes (`LLM_MODEL_EVAL`, deepseek-reasoner)** | A different model from the writer; string checks for forbidden content |

## Stack

Python 3.12 (uv), FastAPI, SQLite (+FTS5), fastembed (bge-small-en-v1.5), rapidfuzz,
OpenAI-compatible LLM gateway (DeepSeek in prototype; swappable for an internally hosted
model), React 19 + TypeScript + Vite + Tailwind.

## Spec conventions

- Each requirement has an ID (`ING-3`, `TOOL-5`, `ORC-7`, `UI-4`, `EVAL-2`, `T7` for traps).
- Code references IDs in docstrings; tests are named after the IDs they prove
  (`test_ING_3_alias_resolution`).
- File formats: YAML for hand-authored files (golden answers, traps, document front matter);
  JSON for anything produced or exchanged by the system (API, briefings, eval results).
- A requirement is done only when its acceptance criteria pass in `pytest` or the eval run.

## Spec index

| File | Covers |
|---|---|
| 01-data.md | Synthetic data pack, entitlement model, trap catalogue |
| 02-ingestion.md | Unification, entity resolution, dedup, indexing |
| 03-tools.md | Tool contracts, envelope, error codes |
| 04-orchestration.md | Briefing pipeline, prompts, verification |
| 05-api-ui.md | API endpoints, briefing workspace UX, actions |
| 06-eval.md | Metrics, golden set, red team, release gates |
