// Small shared presentational pieces.
import { useId, type ReactNode } from 'react'
import type { ClaimStatus, Confidence, SectionKey } from '../types'

export function cn(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(' ')
}

/** Fixed section order, so skeletons can render before any data arrives. */
export const SECTION_ORDER: { key: SectionKey; title: string }[] = [
  { key: 'client_overview', title: 'Client overview' },
  { key: 'changes_since_last', title: 'What changed since the last interaction' },
  { key: 'asks_commitments', title: 'Asks, commitments and open items' },
  { key: 'key_metrics', title: 'Key metrics and performance' },
  { key: 'opportunities', title: 'Opportunities to discuss' },
  { key: 'news_events', title: 'Recent news' },
  { key: 'uncertainty', title: 'Uncertain, conflicting or unavailable' },
]

/** 12-hour time, minutes only when not on the hour: "10 AM", "3 PM", "10:30 AM". */
export function formatTime(d: Date): string {
  const hour = d.getHours() % 12 || 12
  const minutes = d.getMinutes()
  const suffix = d.getHours() < 12 ? 'AM' : 'PM'
  return minutes === 0 ? `${hour} ${suffix}` : `${hour}:${String(minutes).padStart(2, '0')} ${suffix}`
}

/** "Wed, 18 Nov · 10 AM" */
export function formatMeetingTime(iso: string): string {
  const d = new Date(iso)
  const day = d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
  return `${day} · ${formatTime(d)}`
}

type Tone = 'neutral' | 'accent' | 'good' | 'warn' | 'bad'

const TONES: Record<Tone, string> = {
  neutral: 'bg-slate-100 text-slate-600 ring-slate-200',
  accent: 'bg-indigo-50 text-indigo-700 ring-indigo-200',
  good: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  warn: 'bg-amber-50 text-amber-800 ring-amber-200',
  bad: 'bg-rose-50 text-rose-700 ring-rose-200',
}

export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset',
        TONES[tone],
      )}
    >
      {children}
    </span>
  )
}

export function StatusIcon({ status }: { status: ClaimStatus }) {
  if (status === 'verified') {
    return (
      <span title="Verified against cited sources" className="mt-0.5 shrink-0 text-emerald-600">
        <svg viewBox="0 0 20 20" className="h-4 w-4" fill="currentColor" aria-label="verified">
          <path
            fillRule="evenodd"
            d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm3.86-9.86a.75.75 0 0 0-1.22-.88l-3.24 4.5-1.6-1.6a.75.75 0 1 0-1.06 1.06l2.22 2.22a.75.75 0 0 0 1.14-.09l3.76-5.21Z"
          />
        </svg>
      </span>
    )
  }
  return (
    <span title="Could not be fully verified. Check the sources." className="mt-0.5 shrink-0 text-amber-500">
      <svg viewBox="0 0 20 20" className="h-4 w-4" fill="currentColor" aria-label="unverified">
        <path
          fillRule="evenodd"
          d="M8.49 2.86c.67-1.15 2.35-1.15 3.02 0l6.28 10.88c.67 1.15-.17 2.6-1.51 2.6H3.72c-1.34 0-2.18-1.45-1.51-2.6L8.49 2.86ZM10 6a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0v-3.5A.75.75 0 0 1 10 6Zm0 8a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z"
        />
      </svg>
    </span>
  )
}

export function Spinner({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg className={cn('animate-spin text-current', className)} viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
      <path d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}

export function PanelTitle({ children, count }: { children: ReactNode; count?: number }) {
  return (
    <h3 className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
      {children}
      {count !== undefined && <span className="rounded-full bg-slate-200 px-1.5 text-slate-600">{count}</span>}
    </h3>
  )
}


/** Brand mark: a briefing sheet with a verified check. Every claim is checked against its source. */
export function Logo({ size = 32 }: { size?: number }) {
  const id = useId()
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <defs>
        <linearGradient id={`${id}-bg`} x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#6366F1" />
          <stop offset="1" stopColor="#3730A3" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill={`url(#${id}-bg)`} />
      <path d="M10.5 7.5h8l4.5 4.5v10a2 2 0 0 1-2 2H10.5a2 2 0 0 1-2-2v-12.5a2 2 0 0 1 2-2Z" fill="#fff" />
      <path d="M18.5 7.5v3a1.5 1.5 0 0 0 1.5 1.5h3Z" fill="#C7D2FE" />
      <rect x="11.5" y="14" width="8" height="1.6" rx="0.8" fill="#3730A3" opacity="0.55" />
      <rect x="11.5" y="17.6" width="5" height="1.6" rx="0.8" fill="#3730A3" opacity="0.3" />
      <circle cx="22.5" cy="22.5" r="5.2" fill="#10B981" stroke="#3730A3" strokeWidth="1.6" />
      <path d="m20.3 22.6 1.5 1.5 2.9-3.1" fill="none" stroke="#fff" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function Wordmark({ dark = false }: { dark?: boolean }) {
  return (
    <span className={cn('text-[15px] tracking-tight', dark ? 'text-white' : 'text-slate-900')}>
      <span className="font-semibold">Briefing</span>
      <span className={cn('font-normal', dark ? 'text-slate-400' : 'text-slate-500')}> Desk</span>
    </span>
  )
}

export function Avatar({ name, size = 'md' }: { name: string; size?: 'sm' | 'md' | 'lg' }) {
  const initials = name
    .split(' ')
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
  const dims = { sm: 'h-8 w-8 text-xs', md: 'h-10 w-10 text-sm', lg: 'h-16 w-16 text-xl' }[size]
  return (
    <span
      className={cn(
        'grid shrink-0 place-items-center rounded-full bg-gradient-to-br from-slate-700 to-slate-900 font-semibold text-white ring-2 ring-white/10',
        dims,
      )}
    >
      {initials}
    </span>
  )
}

/** "High · 5/6 verified": confidence and the count it is computed from, in one quiet pill. */
export function VerifiedPill({ confidence, verified, total }: { confidence: Confidence; verified: number; total: number }) {
  const dot = { high: 'bg-emerald-500', medium: 'bg-amber-400', low: 'bg-rose-500' }[confidence]
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-600 tabular-nums"
      title={`${confidence} confidence: ${verified} of ${total} claims matched their cited sources`}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full', dot)} />
      <span className="capitalize">{confidence}</span>
      {total > 0 && <span className="text-slate-400">· {verified}/{total} verified</span>}
    </span>
  )
}
