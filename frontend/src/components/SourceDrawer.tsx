// UI-4: the cited source. Database rows show the record itself; documents show the text with the
// sentence the claim relies on highlighted; both keep "AI input", the exact text the model was given.
import { useEffect, useState, type ReactNode } from 'react'
import { ApiError, api, type SourceDoc } from '../api'
import type { Citation } from '../types'
import { SourceKindIcon } from './SectionCard'
import { Spinner, cn, readable } from './ui'

interface Props {
  citation: Citation
  userId: string
  onClose: () => void
}

type Tab = 'main' | 'ai'

export function SourceDrawer({ citation, userId, onClose }: Props) {
  const [doc, setDoc] = useState<SourceDoc | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('main')
  const isDoc = citation.kind === 'document'
  const isRecord = !isDoc && Object.keys(citation.record ?? {}).length > 0

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    setTab('main')
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

  const mainLabel = isDoc ? 'Document' : isRecord ? 'Record' : 'Summary'
  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-slate-950/30 backdrop-blur-[2px]" onClick={onClose}>
      <aside
        role="dialog"
        aria-label="Source"
        className="flex h-full w-[560px] flex-col bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="border-b border-slate-200/80 px-6 pt-5">
          <div className="flex items-center justify-between">
            <span
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px] font-semibold ring-1 ring-inset',
                isDoc ? 'bg-slate-50 text-slate-600 ring-slate-200' : 'bg-indigo-50 text-indigo-700 ring-indigo-200',
              )}
            >
              <SourceKindIcon citation={citation} className="h-3.5 w-3.5 text-current" />
              {isDoc ? (doc ? docType(doc.doc_type) : 'Document') : isRecord ? 'Database record' : 'Computed from database'}
            </span>
            <button
              onClick={onClose}
              autoFocus
              aria-label="Close"
              className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
            >
              <svg viewBox="0 0 20 20" className="h-4.5 w-4.5" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M6 6l8 8M14 6l-8 8" strokeLinecap="round" />
              </svg>
            </button>
          </div>
          <h3 className="mt-3 text-[19px] font-semibold leading-snug tracking-tight text-slate-900">
            {doc?.title ?? citation.title}
          </h3>
          <p className="mt-1 text-[13px] text-slate-500">
            {isDoc
              ? doc
                ? [readable(doc.date), doc.author].filter(Boolean).join(' · ')
                : ' '
              : recordLocation(citation.source_id)}
          </p>
          <nav className="mt-4 flex gap-5 text-[13px] font-medium" aria-label="Views">
            {(['main', 'ai'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                aria-current={tab === t}
                className={cn(
                  '-mb-px border-b-2 pb-2.5 transition',
                  tab === t ? 'border-indigo-600 text-slate-900' : 'border-transparent text-slate-500 hover:text-slate-800',
                )}
              >
                {t === 'main' ? mainLabel : 'AI input'}
              </button>
            ))}
          </nav>
        </header>

        <div className="flex-1 overflow-y-auto bg-slate-50/40 px-6 py-5">
          {tab === 'ai' ? (
            <AiInput text={isDoc ? (doc?.cited_text ?? citation.snippet) : citation.snippet} cited={citation.quote ?? null} isDoc={isDoc} />
          ) : !isDoc ? (
            isRecord ? <RecordView citation={citation} /> : <SummaryView citation={citation} />
          ) : (
            <>
              {!doc && !error && (
                <div className="flex items-center gap-2 text-sm text-slate-500">
                  <Spinner /> Loading source
                </div>
              )}
              {error && <p className="rounded-xl bg-rose-50 p-4 text-sm text-rose-700">{error}</p>}
              {doc && <DocumentView doc={doc} citation={citation} />}
            </>
          )}
        </div>

        <footer className="flex items-center justify-between gap-3 border-t border-slate-200/80 px-6 py-3 text-[12px] text-slate-500">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="truncate font-mono text-[11.5px] text-slate-400">{citation.source_id}</span>
            <CopyButton text={citation.source_id} label="Copy source ID" />
          </span>
          <span className="flex shrink-0 items-center gap-1.5 text-emerald-700">
            <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
              <path d="M10 2.5 16 5v4.5c0 3.7-2.6 6.9-6 8-3.4-1.1-6-4.3-6-8V5l6-2.5Z" strokeLinejoin="round" />
              <path d="m7.2 10 2 2 3.6-4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Access re-checked for you
          </span>
        </footer>
      </aside>
    </div>
  )
}

// ------------------------------------------------------------------ database record

/** "sql:contacts/K-102" -> "contacts · K-102" */
function recordLocation(sourceId: string): string {
  const [table, ...key] = sourceId.replace(/^sql:/, '').split('/')
  return `${table.replace(/_/g, ' ')} · ${key.join(' / ')}`
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

function titleCase(key: string): string {
  const s = key.replace(/_/g, ' ')
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/** The database row as properties. Fields the cited sentence relies on are highlighted. */
function RecordView({ citation }: { citation: Citation }) {
  const fields = Object.entries(citation.record ?? {})
    .filter(([k]) => !HIDDEN_FIELDS.has(k))
    .map(([k, v]) => [k, formatField(k, v), String(v)] as const)
    .filter((f): f is readonly [string, string, string] => f[1] !== null)
  const cited = (citation.quote ?? '').toLowerCase()
  const used = fields.filter(([, , raw]) => raw.length > 2 && cited.includes(raw.toLowerCase())).length
  return (
    <div className="space-y-3">
      {used > 0 && (
        <p className="flex items-center gap-2 text-[12.5px] text-slate-500">
          <span className="h-2.5 w-2.5 rounded-sm bg-indigo-200" />
          {used === 1 ? '1 field' : `${used} fields`} the claim relies on
        </p>
      )}
      <dl className="overflow-hidden rounded-xl bg-white ring-1 ring-slate-200/80">
        {fields.map(([k, v, raw]) => {
          // match the stored value: the quote is the raw row text ("2021-05-01"), not the display form
          const hit = raw.length > 2 && cited.includes(raw.toLowerCase())
          return (
            <div
              key={k}
              className={cn(
                'grid grid-cols-[160px_1fr] gap-4 border-b border-slate-100 px-4 py-2.5 text-[13.5px] last:border-0',
                hit && 'bg-indigo-50/70',
              )}
            >
              <dt className={cn('text-slate-500', hit && 'text-indigo-700')}>{titleCase(k)}</dt>
              <dd className={cn('break-words text-slate-900', hit && 'font-medium text-indigo-950')}>{v}</dd>
            </div>
          )
        })}
      </dl>
    </div>
  )
}

/** A summary computed by code (no single row): its statements as a readable list. */
function SummaryView({ citation }: { citation: Citation }) {
  const items = readable(citation.snippet)
    .split(/;\s+|\.\s+(?=[A-Z])/)
    .map((s) => s.replace(/\.$/, '').trim())
    .filter(Boolean)
  const cited = (citation.quote ?? '').toLowerCase()
  return (
    <div className="space-y-3">
      <p className="flex items-center gap-2 rounded-xl bg-indigo-50/70 px-3.5 py-2.5 text-[13px] text-indigo-900 ring-1 ring-inset ring-indigo-100">
        <svg viewBox="0 0 20 20" className="h-4 w-4 shrink-0 text-indigo-500" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
          <path d="M4 5.5h12M4 10h12M4 14.5h7" strokeLinecap="round" />
        </svg>
        Computed by code from database rows. The model only restates these values.
      </p>
      <ul className="overflow-hidden rounded-xl bg-white ring-1 ring-slate-200/80">
        {items.map((item) => {
          const [label, ...rest] = item.split(/:\s+/)
          const value = rest.join(': ')
          const hit = cited.length > 0 && readable(cited).includes(item.toLowerCase().slice(0, 18))
          return (
            <li
              key={item}
              className={cn(
                'grid grid-cols-[160px_1fr] gap-4 border-b border-slate-100 px-4 py-2.5 text-[13.5px] last:border-0',
                hit && 'bg-indigo-50/70',
              )}
            >
              {value ? (
                <>
                  <span className="text-slate-500">{label.charAt(0).toUpperCase() + label.slice(1)}</span>
                  <span className="text-slate-900">{value}</span>
                </>
              ) : (
                <span className="col-span-2 text-slate-700">{item}</span>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

// ------------------------------------------------------------------ document

const ACCESS_TONE: Record<string, string> = {
  public: 'bg-slate-50 text-slate-600 ring-slate-200',
  internal: 'bg-slate-50 text-slate-600 ring-slate-200',
  confidential: 'bg-amber-50 text-amber-700 ring-amber-200',
  restricted: 'bg-rose-50 text-rose-700 ring-rose-200',
}

function docType(t: string): string {
  return titleCase(t)
}

function DocumentView({ doc, citation }: { doc: SourceDoc; citation: Citation }) {
  return (
    <div className="space-y-4">
      {doc.suspected_injection && (
        <Callout tone="rose" title="Suspected prompt injection">
          This document contains text addressed to AI systems. It is treated as data only, and claims citing it are
          never marked verified.
        </Callout>
      )}
      {doc.derived ? (
        <Callout tone="amber" title="Prior briefing">
          A secondary source that may be outdated. System records win when they disagree.
        </Callout>
      ) : null}

      <dl className="overflow-hidden rounded-xl bg-white ring-1 ring-slate-200/80">
        <Property label="Type">{docType(doc.doc_type)}</Property>
        <Property label="Date">
          {readable(doc.date)}
          {doc.stale ? <Pill className="ml-2 bg-amber-50 text-amber-700 ring-amber-200">Older than 180 days</Pill> : null}
        </Property>
        {doc.author && <Property label="Author">{doc.author}</Property>}
        <Property label="Access">
          <Pill className={ACCESS_TONE[doc.classification] ?? ACCESS_TONE.internal}>{titleCase(doc.classification)}</Pill>
        </Property>
        <Property label="Linked to client">
          {doc.link_method === 'inferred' ? (
            <Pill className="bg-violet-50 text-violet-700 ring-violet-200">
              By name, {Math.round(doc.link_confidence * 100)}% confidence
            </Pill>
          ) : (
            'By client ID'
          )}
        </Property>
      </dl>

      {citation.quote && (
        <figure className="rounded-xl border-l-[3px] border-amber-400 bg-white px-4 py-3 ring-1 ring-slate-200/80">
          <figcaption className="mb-1 text-[11.5px] font-semibold text-amber-700">The claim relies on</figcaption>
          <blockquote className="text-[14px] leading-relaxed text-slate-900">{citation.quote}</blockquote>
        </figure>
      )}

      <div className="rounded-xl bg-white px-4 py-3.5 ring-1 ring-slate-200/80">
        <Highlighted body={doc.body} cited={citation.quote ?? doc.cited_text} />
      </div>
    </div>
  )
}

function Property({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[160px_1fr] items-center gap-4 border-b border-slate-100 px-4 py-2.5 text-[13.5px] last:border-0">
      <dt className="text-slate-500">{label}</dt>
      <dd className="text-slate-900">{children}</dd>
    </div>
  )
}

function Pill({ className, children }: { className: string; children: ReactNode }) {
  return (
    <span className={cn('inline-flex rounded-md px-1.5 py-0.5 text-[11.5px] font-semibold ring-1 ring-inset', className)}>
      {children}
    </span>
  )
}

function Callout({ tone, title, children }: { tone: 'rose' | 'amber'; title: string; children: ReactNode }) {
  const styles = tone === 'rose' ? 'bg-rose-50 text-rose-900 ring-rose-200' : 'bg-amber-50 text-amber-900 ring-amber-200'
  return (
    <div className={cn('rounded-xl px-4 py-3 text-[13px] leading-relaxed ring-1 ring-inset', styles)}>
      <span className="font-semibold">{title}.</span> {children}
    </div>
  )
}

// ------------------------------------------------------------------ AI input

function AiInput({ text, cited, isDoc }: { text: string; cited: string | null; isDoc: boolean }) {
  return (
    <div className="space-y-3">
      <p className="text-[13px] leading-relaxed text-slate-500">
        The exact text placed in the model's evidence pack for this source.
        {isDoc
          ? ' Documents are fenced as untrusted content, so instructions inside them are never followed.'
          : ' Values come from the database; the model may restate them but never compute them.'}
      </p>
      <div className="overflow-hidden rounded-xl bg-slate-950 ring-1 ring-slate-900/10">
        <div className="flex items-center justify-between border-b border-white/10 px-4 py-2">
          <span className="text-[11px] font-medium uppercase tracking-wider text-slate-400">Model input</span>
          <CopyButton text={text} label="Copy model input" dark />
        </div>
        <pre className="whitespace-pre-wrap break-words px-4 py-3.5 font-mono text-[12.5px] leading-relaxed text-slate-300">
          <Highlighted body={text} cited={cited} dark />
        </pre>
      </div>
    </div>
  )
}

function CopyButton({ text, label, dark = false }: { text: string; label: string; dark?: boolean }) {
  const [done, setDone] = useState(false)
  return (
    <button
      onClick={async () => {
        await navigator.clipboard.writeText(text)
        setDone(true)
        setTimeout(() => setDone(false), 1200)
      }}
      title={label}
      aria-label={label}
      className={cn(
        'grid h-6 w-6 shrink-0 place-items-center rounded-md transition',
        dark ? 'text-slate-400 hover:bg-white/10 hover:text-white' : 'text-slate-400 hover:bg-slate-100 hover:text-slate-700',
        done && 'text-emerald-500',
      )}
    >
      <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
        {done ? (
          <path d="M5 10.5 8.5 14 15 6" strokeLinecap="round" strokeLinejoin="round" />
        ) : (
          <path d="M7 7V4.5A1.5 1.5 0 0 1 8.5 3h7A1.5 1.5 0 0 1 17 4.5v7a1.5 1.5 0 0 1-1.5 1.5H13M4.5 7h7A1.5 1.5 0 0 1 13 8.5v7a1.5 1.5 0 0 1-1.5 1.5h-7A1.5 1.5 0 0 1 3 15.5v-7A1.5 1.5 0 0 1 4.5 7Z" />
        )}
      </svg>
    </button>
  )
}

// ------------------------------------------------------------------ highlighting

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

function Highlighted({ body, cited, dark = false }: { body: string; cited: string | null; dark?: boolean }) {
  // Quotes are whitespace-normalized by the backend: find them in normalized text, then map the
  // match back onto the original body so line breaks and paragraphs are kept.
  const { flat, map } = normalizeWithMap(body)
  const needle = cited?.replace(/\s+/g, ' ').trim() ?? ''
  const at = needle ? flat.toLowerCase().indexOf(needle.toLowerCase()) : -1
  const base = dark ? '' : 'whitespace-pre-wrap text-[14px] leading-relaxed'
  // Short sources are a single chunk; highlighting all of it adds nothing.
  if (!needle || at < 0 || needle.length > flat.length * 0.9) {
    return <span className={cn(base, !dark && 'block text-slate-700')}>{body}</span>
  }
  const from = map[at]
  const to = map[at + needle.length - 1] + 1
  return (
    <span className={cn(base, !dark && 'block text-slate-500')}>
      {body.slice(0, from)}
      <mark className={cn('rounded px-0.5', dark ? 'bg-amber-400/20 text-amber-200' : 'bg-amber-100 text-slate-900')}>
        {body.slice(from, to)}
      </mark>
      {body.slice(to)}
    </span>
  )
}
