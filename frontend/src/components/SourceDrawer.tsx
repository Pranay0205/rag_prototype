// UI-4: the cited source, with the cited passage highlighted and its authority flags.
import { useEffect, useState } from 'react'
import { ApiError, api, type SourceDoc } from '../api'
import type { Citation } from '../types'
import { Badge, Spinner } from './ui'

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
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              {isDoc ? 'Source document' : 'Structured data (system of record)'}
            </div>
            <h3 className="mt-1 font-semibold text-slate-900">{doc?.title ?? citation.title}</h3>
            <div className="mt-0.5 font-mono text-[11px] text-slate-400">{citation.source_id}</div>
          </div>
          <button onClick={onClose} autoFocus className="rounded-full p-1.5 text-slate-400 hover:bg-slate-100" aria-label="Close">
            <svg viewBox="0 0 20 20" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M6 6l8 8M14 6l-8 8" />
            </svg>
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {!isDoc && (
            <div className="rounded-lg bg-slate-50 p-4">
              <Highlighted body={citation.snippet} cited={citation.quote ?? null} />
            </div>
          )}

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
                <dd className="text-slate-700">{doc.date}</dd>
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
