// UI-3 section card, UI-6 claim review, sources with exact quotes (UI-4).
import { useState, type ReactNode } from 'react'
import type { Citation, Claim, Section } from '../types'
import { StatusIcon, VerifiedPill, cn } from './ui'

export type Review = 'accept' | 'reject'

interface Props {
  title: string
  section?: Section
  reviews: Record<string, Review>
  onReview: (claim: Claim, decision: Review) => void
  onCite: (citation: Citation) => void
}

export function SectionCard({ title, section, reviews, onReview, onCite }: Props) {
  const verified = section?.claims.filter((c) => c.status === 'verified').length ?? 0
  return (
    <section className="rounded-2xl bg-white p-6 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_32px_-16px_rgba(15,23,42,0.12)] ring-1 ring-slate-900/[0.04]">
      <header className="mb-3 flex items-center justify-between gap-4">
        <h2 className="text-[15px] font-semibold tracking-tight text-slate-900">{title}</h2>
        {section && (
          <VerifiedPill confidence={section.confidence} verified={verified} total={section.claims.length} />
        )}
      </header>

      {!section && <SkeletonLines />}
      {section?.warnings.map((w) => (
        <p key={w} className="mb-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {w}
        </p>
      ))}
      {section && section.claims.length === 0 && section.warnings.length === 0 && (
        <p className="text-sm text-slate-400">Nothing supported by the evidence.</p>
      )}
      <ul className="divide-y divide-slate-100">
        {section?.claims.map((claim) => (
          <ClaimRow key={claim.id} claim={claim} review={reviews[claim.id]} onReview={onReview} onCite={onCite} />
        ))}
      </ul>
    </section>
  )
}

/** A claim may quote the same source twice; show one chip per source. */
function uniqueSources(citations: Citation[]): Citation[] {
  const seen = new Set<string>()
  return citations.filter((c) => !seen.has(c.source_id) && seen.add(c.source_id))
}

function ClaimRow({
  claim,
  review,
  onReview,
  onCite,
}: {
  claim: Claim
  review?: Review
  onReview: (claim: Claim, decision: Review) => void
  onCite: (citation: Citation) => void
}) {
  const [open, setOpen] = useState(false)
  const rejected = review === 'reject'
  return (
    <li className={cn('group flex gap-3 py-3.5', rejected && 'opacity-40')}>
      <StatusIcon status={claim.status} />
      <div className="min-w-0 flex-1">
        <p className={cn('text-[14.5px] leading-relaxed text-slate-800', rejected && 'line-through')}>{claim.text}</p>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
          {uniqueSources(claim.citations).map((c) => (
            <CitationChip key={c.source_id} citation={c} onClick={() => onCite(c)} />
          ))}
          <button
            onClick={() => setOpen((v) => !v)}
            className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-400 hover:text-indigo-600"
            aria-expanded={open}
          >
            <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="currentColor" aria-hidden="true">
              <path d="M4.5 5.5A2.5 2.5 0 0 1 7 3h.5v2H7a.5.5 0 0 0-.5.5V7H8a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1H5.5a1 1 0 0 1-1-1V5.5Zm7 0A2.5 2.5 0 0 1 14 3h.5v2H14a.5.5 0 0 0-.5.5V7H15a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1h-2.5a1 1 0 0 1-1-1V5.5Z" />
            </svg>
            {open ? 'Hide quotes' : 'Quotes'}
          </button>
        </div>
        {open && <QuoteList citations={claim.citations} onCite={onCite} />}
      </div>
      <div
        className={cn(
          'flex shrink-0 items-start gap-1 transition',
          review ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
        )}
      >
        <ReviewButton active={review === 'accept'} tone="good" label="Accept" onClick={() => onReview(claim, 'accept')}>
          <path d="M5 10.5 8.5 14 15 6" />
        </ReviewButton>
        <ReviewButton active={rejected} tone="bad" label="Reject" onClick={() => onReview(claim, 'reject')}>
          <path d="M6 6l8 8M14 6l-8 8" />
        </ReviewButton>
      </div>
    </li>
  )
}

/** Each source with the exact sentence the claim rests on (located in the source by the backend). */
function QuoteList({ citations, onCite }: { citations: Citation[]; onCite: (c: Citation) => void }) {
  return (
    <ul className="mt-3 space-y-2">
      {citations.map((c, i) => (
        <li key={`${c.source_id}-${i}`}>
          <button onClick={() => onCite(c)} className="group/q w-full text-left">
            <blockquote className="border-l-2 border-indigo-200 pl-3 text-[13px] leading-relaxed text-slate-600 group-hover/q:border-indigo-500 group-hover/q:text-slate-900">
              {c.quote ?? <span className="italic text-slate-400">Open the source to read it in full.</span>}
            </blockquote>
            <div className="mt-1 pl-3 text-[11px] text-slate-400">
              {c.title}
              {c.date && ` · ${c.date}`}
            </div>
          </button>
        </li>
      ))}
    </ul>
  )
}

function ReviewButton({
  active,
  tone,
  label,
  onClick,
  children,
}: {
  active: boolean
  tone: 'good' | 'bad'
  label: string
  onClick: () => void
  children: ReactNode
}) {
  const activeClass = tone === 'good' ? 'bg-emerald-600 text-white' : 'bg-rose-600 text-white'
  return (
    <button
      title={label}
      aria-label={label}
      onClick={onClick}
      className={cn(
        'grid h-7 w-7 place-items-center rounded-full transition',
        active ? activeClass : 'text-slate-400 hover:bg-slate-100 hover:text-slate-700',
      )}
    >
      <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.2">
        {children}
      </svg>
    </button>
  )
}

export function CitationChip({ citation, onClick }: { citation: Citation; onClick: () => void }) {
  const isSql = citation.kind === 'sql'
  return (
    <button
      onClick={onClick}
      title={citation.quote ?? citation.snippet}
      className="inline-flex max-w-[240px] items-center gap-1.5 text-[11.5px] text-slate-500 transition hover:text-indigo-600"
    >
      {isSql ? (
        <svg viewBox="0 0 20 20" className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.6">
          <ellipse cx="10" cy="5" rx="6" ry="2.5" />
          <path d="M4 5v10c0 1.4 2.7 2.5 6 2.5s6-1.1 6-2.5V5M4 10c0 1.4 2.7 2.5 6 2.5s6-1.1 6-2.5" />
        </svg>
      ) : (
        <svg viewBox="0 0 20 20" className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.6">
          <path d="M6 2.5h5.5L15 6v10.5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-13a1 1 0 0 1 1-1Z" />
          <path d="M11.5 2.5V6H15" />
        </svg>
      )}
      <span className="truncate underline-offset-2 hover:underline">{citation.title}</span>
    </button>
  )
}

function SkeletonLines() {
  return (
    <div className="space-y-4 py-2">
      {[92, 78, 85].map((w) => (
        <div key={w} className="space-y-2">
          <div className="skeleton h-3 rounded-full" style={{ width: `${w}%` }} />
          <div className="skeleton h-3 rounded-full" style={{ width: `${w - 30}%` }} />
        </div>
      ))}
    </div>
  )
}
