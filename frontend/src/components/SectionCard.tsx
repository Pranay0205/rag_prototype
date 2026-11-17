// UI-3 section card, UI-6 claim review, sources with exact quotes (UI-4).
import { useState, type ReactNode } from 'react'
import type { Citation, Claim, Section } from '../types'
import { CARD, CardHeader, VerifiedPill, cn, readable } from './ui'

export type RejectReason = 'wrong' | 'outdated' | 'not_relevant'
export interface Review {
  decision: 'accept' | 'reject'
  reason?: RejectReason
}

const REASONS: { key: RejectReason; label: string; icon: ReactNode }[] = [
  { key: 'wrong', label: 'Wrong', icon: <path d="M6 6l8 8M14 6l-8 8" /> },
  { key: 'outdated', label: 'Outdated', icon: <path d="M10 5.5V10l3 2M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0Z" /> },
  { key: 'not_relevant', label: 'Not relevant', icon: <path d="M5 10h10" /> },
]

interface Props {
  title: string
  icon: ReactNode
  exhibit?: ReactNode // ORC-14 structured view, shown above the claims as soon as it arrives
  section?: Section
  reviews: Record<string, Review>
  onReview?: (claim: Claim, review: Review | null) => void // omitted: no human review controls
  onCite: (citation: Citation) => void
}

export function SectionCard({ title, icon, exhibit, section, reviews, onReview, onCite }: Props) {
  const verified = section?.claims.filter((c) => c.status === 'verified').length ?? 0
  return (
    <section className={cn(CARD, 'p-6')}>
      <div className="mb-3">
        <CardHeader
          icon={icon}
          title={title}
          right={
            section && <VerifiedPill confidence={section.confidence} verified={verified} total={section.claims.length} />
          }
        />
      </div>

      {exhibit}
      {!section && <SkeletonLines />}
      {section?.warnings.map((w) => (
        <p key={w} className="mb-2 flex items-start gap-2 rounded-lg bg-amber-50/70 px-3 py-2 text-sm text-amber-800">
          <WarnIcon /> {readable(w)}
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

/** Claim text with inline citation markers: "... on 30 Sep 2026 [1]" -> clickable superscripts.
 * `after` (the verification badge) is glued to the last word so it never wraps onto a line alone. */
export function ClaimText({ claim, onCite, after }: { claim: Claim; onCite: (c: Citation) => void; after?: ReactNode }) {
  const parts = claim.annotated ? claim.annotated.split(/(\[\d+\])/) : [claim.text]
  const nodes = parts.map((part, i) => {
    const n = /^\[(\d+)\]$/.exec(part)?.[1]
    if (!n) return readable(part)
    const citation = claim.citations[Number(n) - 1]
    if (!citation) return null
    return (
      <button
        key={i}
        onClick={() => onCite(citation)}
        title={citation.quote ?? citation.snippet}
        className="ml-[1px] align-super text-[10px] font-semibold leading-none tabular-nums text-indigo-500 hover:text-indigo-700 hover:underline"
      >
        {n}
      </button>
    )
  })
  if (!after) return <>{nodes}</>
  // Glue the tail together: last word, any citation markers, punctuation and the badge.
  const glue: ReactNode[] = []
  let i = nodes.length - 1
  for (; i >= 0; i--) {
    const node = nodes[i]
    if (typeof node === 'string' && /\s/.test(node)) {
      const cut = node.search(/\S+\s*$/)
      if (cut > 0) {
        glue.unshift(node.slice(cut))
        return (
          <>
            {nodes.slice(0, i)}
            {node.slice(0, cut)}
            <span className="whitespace-nowrap">
              {glue}
              {after}
            </span>
          </>
        )
      }
    }
    glue.unshift(node)
  }
  return (
    <span className="whitespace-nowrap">
      {glue}
      {after}
    </span>
  )
}

function ClaimRow({
  claim,
  review,
  onReview,
  onCite,
}: {
  claim: Claim
  review?: Review
  onReview?: (claim: Claim, review: Review | null) => void
  onCite: (citation: Citation) => void
}) {
  const [sourcesOpen, setSourcesOpen] = useState(false)
  const [askReason, setAskReason] = useState(false)
  const accepted = review?.decision === 'accept'
  const rejected = review?.decision === 'reject'
  const reason = REASONS.find((r) => r.key === review?.reason)
  const n = claim.citations.length

  return (
    <li className="group group/claim flex gap-4 py-3.5">
      <div className="min-w-0 flex-1">
        <p
          className={cn(
            'text-[14.5px] leading-relaxed text-slate-700',
            rejected && 'text-slate-400 line-through decoration-slate-300',
          )}
        >
          <ClaimText claim={claim} onCite={onCite} after={<VerificationTag status={claim.status} />} />
        </p>

        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
          <button
            onClick={() => setSourcesOpen((v) => !v)}
            aria-expanded={sourcesOpen}
            className="inline-flex items-center gap-1 text-[11.5px] font-medium text-slate-400 transition hover:text-indigo-600"
          >
            <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.6">
              <path d="M3 6.5 10 3l7 3.5-7 3.5-7-3.5Z" />
              <path d="m3 10 7 3.5 7-3.5M3 13.5 10 17l7-3.5" />
            </svg>
            {sourcesOpen ? 'Hide sources' : `${n} ${n === 1 ? 'source' : 'sources'}`}
          </button>
        </div>

        {askReason && (
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-[12px] text-slate-500">Why reject?</span>
            {REASONS.map((r) => (
              <button
                key={r.key}
                onClick={() => {
                  setAskReason(false)
                  onReview?.(claim, { decision: 'reject', reason: r.key })
                }}
                className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[12px] font-medium text-slate-600 ring-1 ring-slate-200 transition hover:bg-rose-50 hover:text-rose-700 hover:ring-rose-200"
              >
                <svg viewBox="0 0 20 20" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  {r.icon}
                </svg>
                {r.label}
              </button>
            ))}
            <button onClick={() => setAskReason(false)} className="px-1.5 text-[12px] text-slate-400 hover:text-slate-600">
              Cancel
            </button>
          </div>
        )}

        {sourcesOpen && <SourceList citations={claim.citations} onCite={onCite} />}
      </div>

      {/* UI-6 human review: words, not icons, so it never reads as the system's verification */}
      {onReview && (
        <div className="w-[164px] shrink-0 pt-0.5 text-right">
          {review ? (
            <button
              onClick={() => onReview(claim, null)}
              title="Click to undo your review"
              className={cn(
                'group/pill inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-1 text-[12px] font-medium ring-1 ring-inset transition',
                accepted
                  ? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
                  : 'bg-rose-50 text-rose-700 ring-rose-200',
              )}
            >
              <span className="group-hover/pill:hidden">
                {accepted ? 'Accepted' : `Rejected${reason ? ` · ${reason.label}` : ''}`}
              </span>
              <span className="hidden group-hover/pill:inline">Undo</span>
            </button>
          ) : (
            <span
              className={cn(
                'inline-flex gap-1 transition',
                askReason ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus-within:opacity-100',
              )}
            >
              <button
                onClick={() => {
                  setAskReason(false)
                  onReview(claim, { decision: 'accept' })
                }}
                className="rounded-full px-2.5 py-1 text-[12px] font-medium text-slate-600 ring-1 ring-slate-200 transition hover:bg-emerald-50 hover:text-emerald-700 hover:ring-emerald-200"
              >
                Accept
              </button>
              <button
                onClick={() => setAskReason((v) => !v)}
                className={cn(
                  'rounded-full px-2.5 py-1 text-[12px] font-medium ring-1 transition',
                  askReason
                    ? 'bg-rose-50 text-rose-700 ring-rose-200'
                    : 'text-slate-600 ring-slate-200 hover:bg-rose-50 hover:text-rose-700 hover:ring-rose-200',
                )}
              >
                Reject
              </button>
            </span>
          )}
        </div>
      )}
    </li>
  )
}

/** ORC-6: the system's own check, labelled in words next to the sources it was checked against. */
export function VerificationTag({ status }: { status: Claim['status'] }) {
  if (status === 'verified') {
    return (
      // Quiet by default: the shield alone; the word slides out while the claim is hovered.
      <span
        title="Verified by the system: cited sources exist, numbers match the database, and the sources support the claim"
        aria-label="Verified"
        className="ml-1.5 inline-flex items-center align-[-2px] text-[11.5px] font-medium text-emerald-600 no-underline"
      >
        <svg viewBox="0 0 20 20" className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
          <path d="M10 2.5 16 5v4.5c0 3.7-2.6 6.9-6 8-3.4-1.1-6-4.3-6-8V5l6-2.5Z" strokeLinejoin="round" />
          <path d="m7.2 10 2 2 3.6-4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span className="grid grid-cols-[0fr] opacity-0 transition-[grid-template-columns,opacity] duration-300 ease-out group-hover/claim:grid-cols-[1fr] group-hover/claim:opacity-100 motion-reduce:transition-none">
          <span className="overflow-hidden whitespace-nowrap pl-1" aria-hidden="true">
            Verified
          </span>
        </span>
      </span>
    )
  }
  return (
    <span
      title="The system could not fully confirm this claim against its sources. Open the sources before relying on it."
      className="ml-1.5 inline-flex items-center gap-1 align-[-2px] text-[11.5px] font-medium text-amber-600 no-underline"
    >
      <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="currentColor" aria-hidden="true">
        <path
          fillRule="evenodd"
          d="M8.49 2.86c.67-1.15 2.35-1.15 3.02 0l6.28 10.88c.67 1.15-.17 2.6-1.51 2.6H3.72c-1.34 0-2.18-1.45-1.51-2.6L8.49 2.86ZM10 6a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0v-3.5A.75.75 0 0 1 10 6Zm0 8a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z"
        />
      </svg>
      Check sources
    </span>
  )
}

/** Numbered sources, each with the exact sentence the claim rests on (located by the backend). */
function SourceList({ citations, onCite }: { citations: Citation[]; onCite: (c: Citation) => void }) {
  return (
    <ul className="mt-2.5 space-y-2.5">
      {citations.map((c, i) => (
        <li key={`${c.source_id}-${i}`}>
          <button onClick={() => onCite(c)} className="group/q w-full text-left">
            <div className="flex items-center gap-1.5 text-[11.5px] text-slate-500 group-hover/q:text-indigo-600">
              <span className="font-semibold tabular-nums text-indigo-500">{i + 1}</span>
              <SourceKindIcon citation={c} />
              <span className="truncate">{c.title}</span>
              {c.date && <span className="shrink-0 text-slate-400">· {readable(c.date)}</span>}
            </div>
            {c.quote && (
              <blockquote className="mt-1 border-l-2 border-slate-200 pl-3 text-[13px] leading-relaxed text-slate-500 group-hover/q:border-indigo-400 group-hover/q:text-slate-800">
                {readable(c.quote)}
              </blockquote>
            )}
          </button>
        </li>
      ))}
    </ul>
  )
}

/** Database icon for system-of-record rows, page icon for documents. Used wherever a source is named. */
export function SourceKindIcon({ citation, className = 'h-3.5 w-3.5' }: { citation: Citation; className?: string }) {
  if (citation.kind === 'sql') {
    return (
      <svg viewBox="0 0 20 20" className={cn('shrink-0 text-indigo-500', className)} fill="none" stroke="currentColor" strokeWidth="1.6" aria-label="database record">
        <ellipse cx="10" cy="5" rx="6" ry="2.5" />
        <path d="M4 5v10c0 1.4 2.7 2.5 6 2.5s6-1.1 6-2.5V5M4 10c0 1.4 2.7 2.5 6 2.5s6-1.1 6-2.5" />
      </svg>
    )
  }
  return (
    <svg viewBox="0 0 20 20" className={cn('shrink-0 text-slate-400', className)} fill="none" stroke="currentColor" strokeWidth="1.6" aria-label="document">
      <path d="M6 2.5h5.5L15 6v10.5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-13a1 1 0 0 1 1-1Z" />
      <path d="M11.5 2.5V6H15" />
    </svg>
  )
}

function WarnIcon() {
  return (
    <svg viewBox="0 0 20 20" className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" fill="currentColor" aria-hidden="true">
      <path
        fillRule="evenodd"
        d="M8.49 2.86c.67-1.15 2.35-1.15 3.02 0l6.28 10.88c.67 1.15-.17 2.6-1.51 2.6H3.72c-1.34 0-2.18-1.45-1.51-2.6L8.49 2.86ZM10 6a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0v-3.5A.75.75 0 0 1 10 6Zm0 8a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z"
      />
    </svg>
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
