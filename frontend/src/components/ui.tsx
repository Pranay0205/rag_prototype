// Small shared presentational pieces.
import { useId, type ReactNode } from 'react'
import type { Confidence, SectionKey } from '../types'

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

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** Machine formats in display text made human: "2026-10-15" -> "15 Oct 2026", "2025Q4" -> "Q4 2025",
 * "proposal_pending" -> "proposal pending". Display only: verification and the source drawer keep
 * the original text. */
export function readable(text: string): string {
  return text
    .replace(/\b(\d{4})-(\d{2})-(\d{2})(?:T\d{2}:\d{2}(?::\d{2})?)?\b/g, (_, y, m, d) =>
      Number(m) >= 1 && Number(m) <= 12 ? `${Number(d)} ${MONTHS[Number(m) - 1]} ${y}` : `${y}-${m}-${d}`,
    )
    .replace(/\b(\d{4})Q([1-4])\b/g, 'Q$2 $1')
    .replace(/\b([a-z]+(?:_[a-z]+)+)\b/g, (w) => w.replace(/_/g, ' '))
}

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

export function Spinner({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg className={cn('animate-spin text-current', className)} viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
      <path d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}

/** The one card surface: sections, key figures, side panels and home cards all use it. */
export const CARD =
  'rounded-2xl bg-white ring-1 ring-slate-900/[0.06] shadow-[0_1px_2px_rgba(15,23,42,0.04),0_8px_24px_-16px_rgba(15,23,42,0.12)]'

const TILE = {
  indigo: 'bg-indigo-50 text-indigo-600',
  amber: 'bg-amber-50 text-amber-600',
  rose: 'bg-rose-50 text-rose-600',
  slate: 'bg-slate-100 text-slate-500',
}

/** The one card header: icon tile, title, optional count and a right-hand slot. */
export function CardHeader({
  icon,
  title,
  count,
  tone = 'indigo',
  right,
}: {
  icon: ReactNode
  title: string
  count?: number
  tone?: keyof typeof TILE
  right?: ReactNode
}) {
  return (
    <header className="flex items-center gap-2.5">
      <span className={cn('grid h-7 w-7 shrink-0 place-items-center rounded-lg', TILE[tone])}>
        <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          {icon}
        </svg>
      </span>
      <h2 className="text-[15px] font-semibold tracking-tight text-slate-900">{title}</h2>
      {count !== undefined && (
        <span className="rounded-full bg-slate-100 px-2 text-[11px] font-medium tabular-nums text-slate-500">{count}</span>
      )}
      {right && <span className="ml-auto">{right}</span>}
    </header>
  )
}

/** Icon paths for card headers, one visual language across the app. */
export const GLYPH: Record<string, ReactNode> = {
  client_overview: <path d="M3.5 16.5v-11l6-3v14M9.5 16.5v-8l7 2.5v5.5M2 16.5h16M6 8h1M6 11h1M12.5 12h1" />,
  changes_since_last: <path d="M16 10a6 6 0 1 1-1.8-4.3M16 4v3.5h-3.5" />,
  asks_commitments: <path d="M4 15.5V5.5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H7.5L4 15.5ZM7.5 7.5h5M7.5 10h3" />,
  key_metrics: <path d="M3 14.5 7.5 10l3 3L17 6.5M12.5 6.5H17V11" />,
  opportunities: <path d="M10 17a7 7 0 1 0 0-14 7 7 0 0 0 0 14Zm0-3.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm0-3.5h.01" />,
  news_events: <path d="M4 4.5h10v11H5.5A1.5 1.5 0 0 1 4 14V4.5ZM14 7.5h2v6.5a1.5 1.5 0 0 1-3 0M6.5 7.5h5M6.5 10h5M6.5 12.5h3" />,
  uncertainty: <path d="M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0ZM8 8a2 2 0 1 1 2.8 1.8c-.5.2-.8.7-.8 1.2v.5M10 14h.01" />,
  actions: <path d="M8 5.5h9M8 10h9M8 14.5h9M3.5 5.5l1 1 1.75-2M3.5 10l1 1 1.75-2M3.5 14.5l1 1 1.75-2" />,
  conflicts: <path d="M7 4 3.5 7.5 7 11M3.5 7.5h10M13 9l3.5 3.5L13 16m3.5-3.5h-10" />,
  gaps: <path d="M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0ZM8 8a2 2 0 1 1 2.8 1.8c-.5.2-.8.7-.8 1.2v.5M10 14h.01" />,
  meetings: <path d="M3.5 6.5h13v10h-13zM3.5 9.5h13M7 3.5v3M13 3.5v3" />,
  companies: <path d="M3.5 16.5v-11l6-3v14M9.5 16.5v-8l7 2.5v5.5M2 16.5h16M6 8h1M6 11h1M12.5 12h1" />,
  facilities: <path d="M5.5 2.5h6.5l3.5 3.5v11.5h-10zM12 2.5V6h3.5M8 10h5M8 13h5" />,
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
