// Mirrors src/briefing/schemas.py. Keep the two in sync.

export type SectionKey =
  | 'client_overview'
  | 'changes_since_last'
  | 'asks_commitments'
  | 'key_metrics'
  | 'opportunities'
  | 'news_events'
  | 'uncertainty'

export type SourceKind = 'sql' | 'document'
export type Confidence = 'high' | 'medium' | 'low'
export type ClaimStatus = 'verified' | 'unverified' | 'conflict'

export interface Citation {
  source_id: string
  kind: SourceKind
  title: string
  date: string | null
  snippet: string
}

export interface Claim {
  id: string
  text: string
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
  access_limited: boolean
}
