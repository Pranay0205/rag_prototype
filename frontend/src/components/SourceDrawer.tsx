// UI-4: the cited source, with the cited passage highlighted and its authority flags.
import { useEffect, useState } from 'react'
import { ApiError, api, type SourceDoc } from '../api'
import type { Citation } from '../types'
import { SourceKindIcon } from './SectionCard'
import { Badge, Spinner, cn, readable } from './ui'

interface Props {
  citation: Citation
  userId: string
  onClose: () => void
}

export function SourceDrawer({ citation, userId, onClose }: Props) {
  const [doc, setDoc] = useState<SourceDoc | null>(null)
  const [error, setError] = useState<string | null>(null)
  const isDoc = citation.kind === 'document'

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    if (!isDoc) return
    let cancelled = false
    api
      .source(citation.source_id, userId)
      .then((d) => !cancelled && setDoc(d))
      .catch((e: ApiError) => !cancelled && setError(e.message))
    return () => {
      cancelled = true
    }
  }, [citation.source_id, userId, isDoc])

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-slate-950/30 backdrop-blur-[2px]" onClick={onClose}>
      <aside
        role="dialog"
        className="flex h-full w-[540px] flex-col bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        aria-label="Source"
      >
        <header className="flex items-start justify-between border-b border-slate-200 px-5 py-4">
          <div>
            <div
              className={cn(
                'flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider',
                isDoc ? 'text-slate-400' : 'text-indigo-600',
              )}
            >
              <SourceKindIcon citation={citation} className="h-3.5 w-3.5 text-current" />
              {isDoc ? 'Source document' : 'Database record'}
            </div>
            <h3 className="mt-1 font-semibold text-slate-900">{doc?.title ?? citation.title}</h3>
            <div className="mt-0.5 text-[12px] text-slate-400" title={citation.source_id}>
              {isDoc ? citation.source_id : recordLocation(citation.source_id)}
            </div>
          </div>
          <button onClick={onClose} autoFocus className="rounded-full p-1.5 text-slate-400 hover:bg-slate-100" aria-label="Close">
            <svg viewBox="0 0 20 20" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M6 6l8 8M14 6l-8 8" />
            </svg>
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {!isDoc && <RecordView citation={citation} />}

          {isDoc && !doc && !error && (
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <Spinner /> Loading source
            </div>
          )}
          {error && <p className="rounded-md bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}

          {doc && (
            <>
              <DocFlags doc={doc} />
              <dl className="mb-4 grid grid-cols-[90px_1fr] gap-y-1 text-sm">
                <dt className="text-slate-400">Type</dt>
                <dd className="text-slate-700">{doc.doc_type.replace('_', ' ')}</dd>
                <dt className="text-slate-400">Date</dt>
                <dd className="text-slate-700">{readable(doc.date)}</dd>
                {doc.author && (
                  <>
                    <dt className="text-slate-400">Author</dt>
                    <dd className="text-slate-700">{doc.author}</dd>
                  </>
                )}
                <dt className="text-slate-400">Access</dt>
                <dd className="text-slate-700">{doc.classification}</dd>
              </dl>
              {citation.quote && (
                <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-slate-800">
                  <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-amber-700">
                    Sentence the claim relies on
                  </div>
                  {citation.quote}
                </div>
              )}
              <Highlighted body={doc.body} cited={citation.quote ?? doc.cited_text} />
            </>
          )}
        </div>
      </aside>
    </div>
  )
}

/** "sql:contacts/K-102" -> "contacts table · record K-102" */
function recordLocation(sourceId: string): string {
  const [table, ...key] = sourceId.replace(/^sql:/, '').split('/')
  return `${table.replace(/_/g, ' ')} table · record ${key.join(' / ')}`
}

const HIDDEN_FIELDS = new Set(['access_groups'])

function formatField(key: string, value: unknown): string | null {
  if (value === null || value === undefined || value === '' || value === '[]') return null
  if (typeof value === 'boolean' || ((key.startsWith('is_') || key === 'overdue') && (value === 0 || value === 1)))
    return value ? 'Yes' : 'No'
  if (typeof value === 'number' && /usd/.test(key)) return `$${value.toLocaleString('en-US')}`
  if (typeof value === 'string' && value.startsWith('[')) {
    try {
      return (JSON.parse(value) as unknown[]).join(', ')
    } catch {
      return value
    }
  }
  return readable(String(value))
}

/** UI-4 structured source: the database row itself, then the sentence the model was given.
 * Fields the cited sentence relies on are highlighted. Computed summaries have no single row. */
function RecordView({ citation }: { citation: Citation }) {
  const fields = Object.entries(citation.record ?? {})
    .filter(([k]) => !HIDDEN_FIELDS.has(k))
    .map(([k, v]) => [k, formatField(k, v), String(v)] as const)
    .filter((f): f is readonly [string, string, string] => f[1] !== null)
  const cited = (citation.quote ?? '').toLowerCase()
  return (
    <div className="space-y-4">
      {fields.length > 0 ? (
        <dl className="overflow-hidden rounded-xl ring-1 ring-slate-200">
          {fields.map(([k, v, raw]) => {
            // match the stored value: the quote is the raw row text ("2021-05-01"), not the display form
            const used = raw.length > 2 && cited.includes(raw.toLowerCase())
            return (
              <div
                key={k}
                className={cn(
                  'grid grid-cols-[150px_1fr] gap-3 border-b border-slate-100 px-4 py-2 text-sm last:border-0',
                  used && 'bg-indigo-50/70',
                )}
              >
                <dt className="text-slate-400">{k.replace(/_/g, ' ')}</dt>
                <dd className={cn('break-words text-slate-800', used && 'font-medium text-indigo-900')}>{v}</dd>
              </div>
            )
          })}
        </dl>
      ) : (
        <p className="flex items-center gap-2 rounded-lg bg-indigo-50/60 px-3 py-2 text-sm text-indigo-800">
          <SourceKindIcon citation={citation} className="h-4 w-4" />
          Computed by code from database rows. No model arithmetic.
        </p>
      )}
      <div>
        <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
          Given to the model as
        </div>
        <div className="rounded-lg bg-slate-50 p-3.5 text-sm">
          <Highlighted body={citation.snippet} cited={citation.quote ?? null} />
        </div>
      </div>
    </div>
  )
}

function DocFlags({ doc }: { doc: SourceDoc }) {
  return (
    <div className="mb-4 space-y-2">
      {doc.suspected_injection && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
          <strong>Suspected prompt injection.</strong> This document contains text addressed to AI systems. It is
          treated as data only, and claims citing it are never marked verified.
        </div>
      )}
      <div className="flex flex-wrap gap-1.5">
        {doc.derived ? <Badge tone="warn">Prior briefing: secondary source, may be outdated</Badge> : null}
        {doc.stale ? <Badge tone="warn">Older than 180 days</Badge> : null}
        {doc.link_method === 'inferred' && (
          <Badge tone="accent">
            No client ID in source. Linked by name, {Math.round(doc.link_confidence * 100)}% confidence
          </Badge>
        )}
      </div>
    </div>
  )
}

/** Collapse whitespace like the backend does, remembering where each character came from. */
function normalizeWithMap(text: string): { flat: string; map: number[] } {
  let flat = ''
  const map: number[] = []
  let inSpace = false
  for (let i = 0; i < text.length; i++) {
    if (/\s/.test(text[i])) {
      if (!inSpace && flat.length > 0) {
        flat += ' '
        map.push(i)
      }
      inSpace = true
    } else {
      flat += text[i]
      map.push(i)
      inSpace = false
    }
  }
  return { flat, map }
}

function Highlighted({ body, cited }: { body: string; cited: string | null }) {
  // Quotes are whitespace-normalized by the backend: find them in normalized text, then map the
  // match back onto the original body so line breaks and paragraphs are kept.
  const { flat, map } = normalizeWithMap(body)
  const needle = cited?.replace(/\s+/g, ' ').trim() ?? ''
  const at = needle ? flat.toLowerCase().indexOf(needle.toLowerCase()) : -1
  // Short documents are a single chunk; highlighting all of it adds nothing.
  if (!needle || at < 0 || needle.length > flat.length * 0.9) {
    return <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700">{body}</p>
  }
  const from = map[at]
  const to = map[at + needle.length - 1] + 1
  return (
    <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-500">
      {body.slice(0, from)}
      <mark className="rounded bg-amber-100 px-0.5 text-slate-900">{body.slice(from, to)}</mark>
      {body.slice(to)}
    </p>
  )
}
