// Typed client for the FastAPI backend (specs/05-api-ui.md). Vite proxies /api to :8000.
import type { Briefing, Section } from './types'

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

export interface DataHealth {
  merges: { merged_id: string; survivor_id: string }[]
  documents: {
    total: number
    inferred_links: { doc_id: string; client_id: string; confidence: number }[]
    duplicates: { doc_id: string; duplicate_of: string }[]
    quarantined_news: string[]
    suspected_injection: string[]
    unlinked: string[]
  }
  index: { chunks_indexed: number; embedding_model: string }
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
  created_suggestions: string[]
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

  review: (briefingId: string, claimId: string, userId: string, decision: 'accept' | 'reject') =>
    post(`/api/briefings/${briefingId}/claims/${claimId}/review`, { user_id: userId, decision }),

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
  }) => post<{ action_id: string }>('/api/actions', action),

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

  dataHealth: () => request<DataHealth>('/api/health/data'),
}
