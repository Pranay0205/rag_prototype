// Small shared presentational pieces.
import { type ReactNode } from 'react'
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

/** One colour per client, used everywhere that client appears (tile, meeting bar, timeline). */
const CLIENT_TONES = [
  { tile: 'bg-teal-100 text-teal-800', solid: 'bg-teal-500' },
  { tile: 'bg-amber-100 text-amber-800', solid: 'bg-amber-500' },
  { tile: 'bg-pink-100 text-pink-800', solid: 'bg-pink-600' },
  { tile: 'bg-sky-100 text-sky-800', solid: 'bg-sky-500' },
]

export function clientTone(clientId: string) {
  const n = Number(clientId.replace(/\D/g, '')) || 0
  return CLIENT_TONES[(n + CLIENT_TONES.length - 1) % CLIENT_TONES.length]
}

export function initials(name: string): string {
  return name
    .replace(/ (Inc\.|plc|LLC)$/, '')
    .split(' ')
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
}

/** "Chief Financial Officer" -> "CFO"; other titles unchanged. */
export function shortTitle(title: string): string {
  const known: Record<string, string> = {
    'chief executive officer': 'CEO',
    'chief financial officer': 'CFO',
    'chief operating officer': 'COO',
  }
  return known[title.toLowerCase()] ?? title
}

/** The client's initials on its colour. */
export function ClientTile({ clientId, name, size = 'md' }: { clientId: string; name: string; size?: 'md' | 'lg' }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'grid shrink-0 place-items-center font-bold',
        clientTone(clientId).tile,
        size === 'lg' ? 'h-14 w-14 rounded-[14px] text-[18px]' : 'h-10 w-10 rounded-[10px] text-[13px]',
      )}
    >
      {initials(name)}
    </span>
  )
}

/** The one card surface: sections, key figures, side panels and home cards all use it. */
export const CARD = 'rounded-2xl border border-slate-200 bg-white'

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
  // Ink tile, a "b" for Briefing, and a teal centre dot for the verified core.
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="#1A1814" />
      <g transform="translate(4 4)">
        <path d="M7 3.5v16" stroke="#FFFFFF" strokeWidth="2.6" strokeLinecap="round" fill="none" />
        <circle cx="12.6" cy="14.2" r="5.3" stroke="#FFFFFF" strokeWidth="2.6" fill="none" />
        <circle cx="12.6" cy="14.2" r="1.7" fill="#2DD4BF" />
      </g>
    </svg>
  )
}

export function Wordmark({ dark = false }: { dark?: boolean }) {
  return (
    <span className={cn('text-[16px] font-bold tracking-tight', dark ? 'text-white' : 'text-slate-900')}>
      Briefing Desk
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
  const tone = {
    high: ['bg-emerald-50 text-emerald-800', 'bg-emerald-500'],
    medium: ['bg-amber-50 text-amber-800', 'bg-amber-500'],
    low: ['bg-rose-50 text-rose-800', 'bg-rose-500'],
  }[confidence]
  return (
    <span
      className={cn('inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-[12.5px] font-medium tabular-nums', tone[0])}
      title={`${confidence} confidence: ${verified} of ${total} claims matched their cited sources`}
    >
      <span className={cn('h-2 w-2 rounded-full', tone[1])} />
      <span>{confidence.charAt(0).toUpperCase() + confidence.slice(1)} confidence</span>
      {total > 0 && <span className="opacity-70">· {verified}/{total} verified</span>}
    </span>
  )
}
