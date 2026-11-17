// Typed client for the FastAPI backend (specs/05-api-ui.md). Vite proxies /api to :8000.
import type { Briefing, Citation, Conflict, Exhibits, KeyFigure, Section, Unknown } from './types'

export interface User {
  user_id: string
  name: string
  title: string
  clearance: string
  groups: string[]
  coverage: { legal_name: string; coverage_role: string }[]
}

export interface Meeting {
  meeting_id: string
  client_id: string
  legal_name: string
  start_time: string
  purpose: string
  our_attendees: string[]
  client_attendees: string[]
}

export interface SourceDoc {
  doc_id: string
  doc_type: string
  title: string
  date: string
  author: string | null
  classification: string
  link_method: string
  link_confidence: number
  derived: number
  stale: number
  body: string
  cited_text: string | null
  suspected_injection: boolean
}

export interface Commitment {
  description: string
  party: 'meridian' | 'client'
  due: string | null
  quote: string
  grounded: boolean
}

/** API-19: the data behind the app: tables, unification and quality checks (UI-15). */
export interface DataOverview {
  built_at: string
  today: string
  tables: {
    name: string
    group: string
    description: string
    rows: number
    columns: { name: string; role: 'key' | 'link' | 'lineage' | null; references: string | null }[]
  }[]
  merges: {
    merged_id: string
    survivor_id: string
    rule: string
    evidence: { lei: string; merged_legal_name: string; survivor_created: string; merged_created: string }
  }[]
  aliases: number
  contacts_deduplicated: string[]
  documents: {
    total: number
    by_link_method: Record<string, number>
    inferred_links: { doc_id: string; client_id: string; confidence: number }[]
    duplicates: { doc_id: string; duplicate_of: string }[]
    quarantined_news: string[]
    derived: string[]
    stale: string[]
    suspected_injection: string[]
    unlinked: string[]
  }
  index: { chunks_indexed: number; embedding_model: string } | null
  quality_checks: {
    id: string
    check: string
    severity: 'error' | 'warning' | 'info'
    passed: boolean
    failures: number
    examples: Record<string, unknown>[]
    sql: string
  }[]
}

export class ApiError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { 'content-type': 'application/json', ...init?.headers },
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    const detail = body.detail ?? {}
    throw new ApiError(res.status, detail.code ?? 'ERROR', detail.message ?? res.statusText)
  }
  return res.json() as Promise<T>
}

const post = <T>(path: string, body: unknown) =>
  request<T>(path, { method: 'POST', body: JSON.stringify(body) })

export interface SavedBriefing {
  briefing: Briefing
  created_at: string
  stale: boolean // source data was refreshed after this briefing was prepared
  reviews: Record<string, 'accept' | 'reject'>
  review_notes: Record<string, string> // reject reasons
  created_suggestions: string[]
  created_actions?: Record<string, string> // suggestion_id -> action_id
}

/** API-15: the signed-in dashboard. */
export interface HomeData {
  today: string
  meetings: (Meeting & { last_prepared: string | null })[]
  companies: {
    client_id: string
    name: string
    industry: string
    aliases: string[]
    role: string | null
    revenue_ttm: number | null
    yoy_pct: number | null
    next_meeting_id: string | null
    last_prepared: string | null
    new_contacts: { name: string; title: string; since: string }[]
  }[]
  facilities: {
    client_id: string
    client: string
    product: string
    notional_usd: number
    maturity_date: string | null
    matures_within_12m: boolean
    notes: string | null
  }[]
}

/** API-13: clients named in free text, within the viewer's coverage */
export interface ClientSearch {
  results: { client_id: string; name: string; matched_alias: string | null }[]
  notice: string | null
}

/** API-14 (ORC-15) */
export interface AskAnswer {
  ask_id: string
  question: string
  section: Section
  conflicts: Conflict[]
  unknowns: Unknown[]
  explanation: string | null // what a term means; general, not from client records
  explanation_source: 'glossary' | 'model' | null // the app's own guide, or a labelled model explanation
  access_limited: boolean
}

/** Where an action came from: a suggestion's origin, confirmed meeting notes, or typed in. */
export type ActionOrigin = 'records' | 'conflict' | 'ai' | 'notes' | 'user'

/** API-16 */
export interface ClientAction {
  action_id: string
  kind: string
  description: string
  due: string | null
  at: string
  briefing_id: string | null
  suggestion_id: string | null
  origin: ActionOrigin | null
}

type Cited = { citation: Citation | null }

/** API-18: the client as a whole. Rows carry the citation that opens them in the source drawer. */
export interface ClientOverview {
  client: Cited & {
    client_id: string
    legal_name: string
    short_name: string
    lei: string
    segment: string
    industry: string
    hq_city: string
    hq_country: string
    created_date: string
  }
  aliases: string[]
  coverage: { user_id: string; name: string; coverage_role: string; is_primary: number }[]
  contacts: (Cited & {
    contact_id: string
    name: string
    title: string
    is_active: number
    start_date: string
    end_date: string | null
    changed_recently: boolean
  })[]
  revenue: Cited & {
    as_of_quarter?: string
    current_period?: string
    total?: { current_ttm: number | null; prior_ttm: number | null; yoy_pct: number | null }
    by_product_line?: { product_line: string; current_ttm: number | null; prior_ttm: number | null; yoy_pct: number | null }[]
    quarterly?: { period: string; total: number | null }[]
    missing_quarters?: string[]
  }
  holdings: (Cited & {
    holding_id: string
    product: string
    notional_usd: number | null
    opened_date: string
    maturity_date: string | null
    notes: string | null
    matures_within_12m: boolean
  })[]
  financials: (Cited & {
    fiscal_period: string
    company_revenue_usd_m: number
    ebitda_margin_pct: number
    net_leverage_x: number
    source: string
  })[]
  opportunities: (Cited & {
    opp_id: string
    product: string
    stage: string
    est_revenue_usd: number
    probability_pct: number
    next_step: string | null
  })[]
  issues: (Cited & {
    issue_id: string
    severity: string
    status: string
    summary: string
    opened_date: string
    resolved_date: string | null
  })[]
  actions: (Cited & {
    action_id: string
    description: string
    owner: string
    due_date: string
    status: string
    overdue: boolean
    days_overdue: number
  })[]
  interactions: (Cited & {
    interaction_id: string
    date: string
    type: string
    subject: string
    client_attendees: string
  })[]
  meetings: Meeting[]
  documents: (Cited & {
    doc_id: string
    doc_type: string
    title: string
    date: string
    classification: string
    derived: number
    link_method: string
  })[]
  access_limited: boolean
  loaded_at: string | null // when the data was last ingested
}

export interface HistoryItem {
  briefing_id: string
  created_at: string
  stale: boolean
  claims: number
  verified: number
  conflicts: number
}

export interface StreamHandlers {
  onFigures: (figures: KeyFigure[]) => void
  onExhibits: (exhibits: Exhibits) => void
  onSection: (section: Section) => void
  onBriefing: (briefing: Briefing) => void
  onError: (message: string) => void
}

export const api = {
  users: () => request<User[]>('/api/users'),

  meetings: (userId: string) => request<Meeting[]>(`/api/meetings?user_id=${userId}`),

  startBriefing: (userId: string, meetingId: string) =>
    post<{ briefing_id: string }>('/api/briefings', { user_id: userId, meeting_id: meetingId }),

  /** Opens the SSE stream. Returns a function that closes it. */
  streamBriefing(briefingId: string, handlers: StreamHandlers): () => void {
    const source = new EventSource(`/api/briefings/${briefingId}/stream`)
    source.addEventListener('figures', (e) => handlers.onFigures(JSON.parse(e.data)))
    source.addEventListener('exhibits', (e) => handlers.onExhibits(JSON.parse(e.data)))
    source.addEventListener('section', (e) => handlers.onSection(JSON.parse(e.data)))
    source.addEventListener('briefing', (e) => {
      handlers.onBriefing(JSON.parse(e.data))
      source.close()
    })
    source.addEventListener('error', (e) => {
      // Server-sent "error" events carry data; a bare Event means the connection dropped.
      const message = e instanceof MessageEvent && e.data ? JSON.parse(e.data).message : 'Connection lost'
      handlers.onError(message)
      source.close()
    })
    return () => source.close()
  },

  source: (sourceId: string, userId: string) =>
    request<SourceDoc>(`/api/sources/${encodeURIComponent(sourceId)}?user_id=${userId}`),

  review: (briefingId: string, claimId: string, userId: string, decision: 'accept' | 'reject' | 'clear', note = '') =>
    post(`/api/briefings/${briefingId}/claims/${claimId}/review`, { user_id: userId, decision, note }),

  createAction: (action: {
    user_id: string
    client_id: string
    kind: string
    description: string
    owner?: string | null
    due?: string | null
    citations?: string[]
    briefing_id?: string | null
    suggestion_id?: string
    origin?: ActionOrigin
  }) => post<{ action_id: string }>('/api/actions', action),

  /** API-16: the viewer's own actions for a client, so they carry into later briefings. */
  listActions: (userId: string, clientId: string) =>
    request<ClientAction[]>(`/api/actions?user_id=${userId}&client_id=${clientId}`),

  /** API-17: untick or remove an action (creator only). */
  deleteAction: (actionId: string, userId: string) =>
    request<{ ok: boolean }>(`/api/actions/${actionId}?user_id=${userId}`, { method: 'DELETE' }),

  /** The viewer's last saved briefing for this client (or a given version), or null if none. */
  async latestBriefing(userId: string, clientId: string, briefingId?: string): Promise<SavedBriefing | null> {
    const version = briefingId ? `&briefing_id=${briefingId}` : ''
    try {
      return await request<SavedBriefing>(`/api/briefings/latest?user_id=${userId}&client_id=${clientId}${version}`)
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) return null
      throw e
    }
  },

  extractCommitments: (clientId: string, userId: string, text: string) =>
    post<Commitment[]>(`/api/clients/${clientId}/notes`, { user_id: userId, text }),

  history: (userId: string, clientId: string) =>
    request<HistoryItem[]>(`/api/briefings/history?user_id=${userId}&client_id=${clientId}`),

  dataOverview: (userId: string) => request<DataOverview>(`/api/data/overview?user_id=${userId}`),

  home: (userId: string) => request<HomeData>(`/api/home?user_id=${userId}`),

  searchClients: (userId: string, q: string) =>
    request<ClientSearch>(`/api/clients/search?user_id=${userId}&q=${encodeURIComponent(q)}`),

  clientOverview: (clientId: string, userId: string) =>
    request<ClientOverview>(`/api/clients/${clientId}/overview?user_id=${userId}`),

  ask: (clientId: string, userId: string, question: string) =>
    post<AskAnswer>(`/api/clients/${clientId}/ask`, { user_id: userId, question }),
}
