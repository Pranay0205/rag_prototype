// Mirrors src/briefing/schemas.py. Keep the two in sync.

export type SectionKey =
  | 'client_overview'
  | 'changes_since_last'
  | 'asks_commitments'
  | 'key_metrics'
  | 'opportunities'
  | 'news_events'
  | 'uncertainty'
  | 'ask' // ORC-15 answer, not a briefing section

export type SourceKind = 'sql' | 'document'
export type Confidence = 'high' | 'medium' | 'low'
export type ClaimStatus = 'verified' | 'unverified' | 'conflict'

export interface Citation {
  source_id: string
  kind: SourceKind
  title: string
  date: string | null
  snippet: string
  quote?: string | null // exact supporting span, located in the source by the backend
  record?: Record<string, unknown> | null // structured sources: the database row behind the snippet
}

export interface Claim {
  id: string
  text: string
  annotated?: string | null // text with inline markers [n] pointing at citations[n-1]
  citations: Citation[]
  confidence: Confidence
  status: ClaimStatus
}

export interface Section {
  key: SectionKey
  title: string
  claims: Claim[]
  confidence: Confidence
  warnings: string[]
}

export interface ConflictValue {
  value: string
  citation: Citation
  status?: 'outdated' | 'current' | null // set by code from the evidence (ORC-14)
}

export interface Conflict {
  topic: string
  values: ConflictValue[]
  resolution: string
}

export interface Unknown {
  question: string
  reason: string
}

/** ORC-13: headline number computed by code from structured data, never by the model. */
export interface KeyFigure {
  key: 'revenue' | 'facility' | 'pipeline' | 'actions' | string
  label: string
  value: string
  detail: string
  tone: 'good' | 'bad' | 'warn' | 'neutral'
  trend: number[]
  bar_pct: number | null
  citations: Citation[]
}

/** ORC-14: structured views built by code from the database. */
export interface ContactRow {
  name: string
  title: string
  status: 'new' | 'current' | 'former'
  attending: boolean
  since: string | null
  until: string | null
  citation: Citation | null
}

export interface RevenueLine {
  line: string
  current: number | null
  prior: number | null
  yoy_pct: number | null
}

export interface PipelineRow {
  product: string
  stage: string
  est_revenue: number | null
  probability: number | null
  next_step: string | null
  citation: Citation | null
}

export interface Exhibits {
  contacts: ContactRow[]
  coverage: { name: string; role: string; primary: boolean }[]
  revenue_lines: RevenueLine[]
  revenue_citation: Citation | null
  pipeline: PipelineRow[]
}

export const NO_EXHIBITS: Exhibits = { contacts: [], coverage: [], revenue_lines: [], revenue_citation: null, pipeline: [] }

export interface SuggestedAction {
  id: string
  kind: string
  description: string
  owner: string | null
  due: string | null
  citations: Citation[]
}

export interface Briefing {
  briefing_id: string
  client: { client_id: string; name: string; aliases: string[] }
  meeting: { meeting_id: string; date: string; purpose: string; attendees: string[] } | null
  viewer: { user_id: string; role: string; clearance: string; groups: string[] }
  generated_at: string
  sections: Section[]
  conflicts: Conflict[]
  unknowns: Unknown[]
  suggested_actions: SuggestedAction[]
  key_figures?: KeyFigure[]
  exhibits?: Exhibits
  access_limited: boolean
}
