# Architecture

![Briefing Desk architecture](images/architecture.png)

<sub>Source: [`images/architecture.html`](images/architecture.html), rendered to PNG. The diagrams below are
Mermaid, so they render on GitHub and stay editable as text.</sub>

The [design walkthrough](DESIGN.md) explains *why*; this page shows *what runs where*. Requirement
IDs point into [`specs/`](../specs/00-overview.md).

## Components

```mermaid
flowchart TB
  subgraph Browser["Browser: React workspace"]
    Home["Home cards<br/>meetings, companies, facilities"]
    Brief["Briefing page<br/>key figures, 7 sections, attention panel"]
    Chat["Ask chat<br/>floating, every page"]
    Drawer["Source drawer<br/>document or database row"]
  end

  subgraph Server["FastAPI process"]
    API["api.py<br/>REST + server-sent events"]
    Orch["orchestrator.py<br/>authorize, gather, retrieve,<br/>generate, verify, assemble"]
    Verify["verify.py<br/>numbers, quote location"]
    Tools["tools.py<br/>typed queries, access checked"]
    Emb["embeddings.py<br/>bge-small, local"]
    LLMG["llm.py<br/>OpenAI-compatible gateway"]
  end

  subgraph Storage["var/"]
    BDB[("briefing.db<br/>tables + FTS5 + vectors")]
    ADB[("app.db<br/>briefings, reviews, actions")]
    Runs[["runs/*.json<br/>audit logs"]]
  end

  Ingest["ingest.py<br/>run once or on data change"]
  Data[/"data/: 13 CSV tables, 31 documents"/]
  Provider(["LLM provider<br/>DeepSeek today"])

  Data --> Ingest --> BDB
  Home & Brief & Chat & Drawer --> API
  API --> Orch
  API --> Tools
  API --> ADB
  Orch --> Tools --> BDB
  Tools --> Emb
  Orch --> Verify
  Orch --> LLMG --> Provider
  Orch --> Runs
```

| Module | Responsibility | Specs |
|---|---|---|
| `ingest.py` | Load, unify, resolve, dedup, flag, screen, chunk, index; writes an ingestion report | ING-1..11 |
| `entities.py` | Name to client: exact, then guarded fuzzy matching | ING-3 |
| `tools.py` | The only data access layer: fixed SQL, entitlement and coverage checks, citable sources | TOOL-1..14, DATA-1/2 |
| `embeddings.py` | Local embedding model, loaded once per process | ING-10 |
| `orchestrator.py` | Briefing and question pipelines, key figures, exhibits, backstop | ORC-1..15 |
| `verify.py` | Quantity extraction and matching, quote location | ORC-6 |
| `prompts.py` | Every prompt in one reviewable file | ORC-5, ORC-6 |
| `llm.py` | One gateway: JSON mode, schema validation, one repair retry, usage accounting | |
| `api.py` | HTTP API, background briefing jobs, SSE, saved briefings and reviews | API-1..15 |
| `eval.py` | Evaluation harness and release gates | EVAL-1..11 |
| `frontend/src` | React workspace | UI-1..13 |

## One briefing, end to end

```mermaid
sequenceDiagram
  autonumber
  actor Banker
  participant UI as React UI
  participant API as FastAPI
  participant O as Orchestrator
  participant T as Tools
  participant DB as briefing.db
  participant M as LLM

  Banker->>UI: Prepare briefing
  UI->>API: POST /api/briefings {user, meeting}
  API->>T: coverage check (ORC-1)
  API-->>UI: briefing_id
  UI->>API: GET /api/briefings/{id}/stream (SSE)
  API->>O: run_briefing in a background thread
  O->>T: gather facts: profile, revenue, holdings, financials, pipeline, interactions
  T->>DB: parameterized SQL, entitlement filters
  O-->>UI: event figures, event exhibits (computed by code, no model)
  loop each of 7 sections (milliseconds)
    O->>T: search_documents: filters first, then BM25 + vectors fused
  end
  par 7 sections in parallel
    O->>M: evidence pack E1..En, documents fenced as untrusted
    M-->>O: JSON claims with inline evidence IDs
    O->>O: verify IDs, numbers, quotes, injection cap
    O->>M: judge: do the cited sources support each claim?
    O-->>UI: event section (verified claims stream in)
  end
  O->>O: assemble conflicts, gaps, actions, backstop
  O->>O: write run log (var/runs)
  API->>API: save to app.db for this viewer
  API-->>UI: event briefing (complete)
```

Typical timings: facts and cards in well under a second; the full briefing in about 8 seconds, almost
all of it the parallel model calls. A failing section is isolated and reported; the rest still arrive.

**The chat** (`POST /api/clients/{id}/ask`) runs the same path for one question: coverage check,
gather, retrieve with the question as the query, generate, verify. It returns a single answer instead
of streaming sections.

## Ingestion

```mermaid
flowchart LR
  CSV[/CSV tables/] --> L[Load tables]
  L --> U[Merge duplicate clients by LEI<br/>rewrite IDs to the survivor]
  DOC[/Markdown documents/] --> K[Link to client<br/>by ID, else by name: inferred]
  U --> K
  K --> D{Duplicate?}
  D -- yes --> X1[Keep, never index]
  D -- no --> N{Unapproved news?}
  N -- yes --> X2[Quarantine]
  N -- no --> F[Flag stale, derived,<br/>suspected injection]
  F --> C[Chunk ~800 chars]
  C --> I[FTS5 index + local embeddings]
  I --> R[(briefing.db)]
  R --> REP[[Ingestion report]]
```

Ingestion is deterministic and idempotent: running it again rebuilds `briefing.db` from `data/`.
User state lives in a separate `app.db`, so re-ingesting never loses saved briefings or reviews;
briefings prepared on older data are marked "Source data changed since this was prepared".

## Access control layers

```mermaid
flowchart TB
  R[Request with user ID] --> C{Client in the<br/>user's coverage?}
  C -- no --> F1[403 before any data is read]
  C -- yes --> E[Tools filter every row and document:<br/>classification at or below clearance,<br/>and access group membership]
  E --> P[Only permitted evidence reaches<br/>the model's context]
  P --> O[Output: a yes/no notice that something<br/>was withheld, never a count or a name]
  O --> S[Every source fetch and saved briefing<br/>is re-checked on read]
  S --> V[Eval leak sweep across every user<br/>and client before release]
```

Access is decided in code at every layer and never delegated to the model: it cannot leak what it
never receives, and it is not allowed to withhold what the viewer is cleared for.

## Storage

| Store | Contents | Lifecycle |
|---|---|---|
| `var/briefing.db` | Source tables after unification, document chunks, FTS5 index, embedding vectors | Rebuilt by ingestion |
| `var/app.db` | Saved briefings (per viewer), claim reviews with reasons, created actions | Persistent; never touched by ingestion |
| `var/runs/*.json` | Per briefing and per question: evidence, model output, verification decisions, timing, tokens | Audit trail |
| `var/eval/` | Eval results as JSON plus a markdown summary | Per eval run |
| `var/models/` | Embedding model cache | Downloaded on first run |

## API surface

| Endpoint | Purpose |
|---|---|
| `GET /api/users`, `GET /api/meetings`, `GET /api/home` | Profiles, upcoming meetings, dashboard cards |
| `POST /api/briefings`, `GET /api/briefings/{id}/stream` | Start a briefing; stream `figures`, `exhibits`, `section`, `briefing`, `error` |
| `GET /api/briefings/latest`, `/history`, `/{id}` | Saved briefings and versions, owner only, access re-checked |
| `GET /api/sources/{id}` | Full source for the drawer, access re-checked |
| `POST /api/briefings/{id}/claims/{claim}/review` | Accept, reject with reason, or undo |
| `POST /api/actions`, `POST /api/clients/{id}/notes` | Create follow-ups; extract commitments from notes |
| `POST /api/clients/{id}/ask`, `GET /api/clients/search` | Chat answers; client search by name or alias |
| `GET /api/health/data` | Ingestion report |

## Deployment

| | Prototype | Production direction |
|---|---|---|
| Process | One FastAPI process serves the API and the built UI (`./run.sh`) | Stateless API replicas behind the firm's gateway; briefing jobs on a queue |
| Data | SQLite files | Postgres (+ pgvector) or the firm's search platform; CDC connectors from source systems |
| Identity | Demo profiles | Firm SSO and entitlement service, information barriers for MNPI |
| Model | DeepSeek via an OpenAI-compatible gateway | Internally hosted or approved provider behind the same gateway, versions pinned |
| Audit | JSON run logs | Immutable audit store with retention policy |
