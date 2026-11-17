// ORC-13 / UI-3: headline cards computed by code from the database. They arrive before any model
// call, so the page has real numbers within a second. Click a card to open the rows behind it.
import { useEffect, useId, useState } from 'react'
import type { Citation, KeyFigure } from '../types'
import { CARD, InfoTip, cn } from './ui'

// What each card shows, for the info icon in its corner
const INFO: Record<string, string> = {
  revenue:
    'Revenue Meridian earned from this client over the last four reported quarters, compared with the four before. Calculated from the revenue records; select the card to see the working.',
  facility:
    "The client's largest credit facility: its size, when it matures and how much of it is drawn. A facility maturing within 12 months is the next refinancing conversation.",
  pipeline:
    'Estimated revenue from opportunities not yet won or lost, summed. Only opportunities you are cleared to see are included.',
  actions: 'Commitments Meridian made to the client that are still open. Overdue means past the agreed due date.',
}

interface Props {
  figures: KeyFigure[]
  loading: boolean
  onCite: (citation: Citation) => void
}

const TONE = {
  good: { text: 'text-emerald-600', stroke: '#10b981' },
  bad: { text: 'text-rose-600', stroke: '#f43f5e' },
  warn: { text: 'text-amber-600', stroke: '#f59e0b' },
  neutral: { text: 'text-slate-600', stroke: '#14b8a6' },
}

export function KeyFigures({ figures, loading, onCite }: Props) {
  if (figures.length === 0) {
    if (!loading) return null
    return (
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-[118px] rounded-2xl bg-white p-4 ring-1 ring-slate-900/[0.04]">
            <div className="skeleton h-3 w-24 rounded-full" />
            <div className="skeleton mt-4 h-6 w-20 rounded-md" />
            <div className="skeleton mt-3 h-3 w-28 rounded-full" />
          </div>
        ))}
      </div>
    )
  }
  return (
    <div className={cn('grid gap-3', figures.length >= 4 ? 'grid-cols-2 lg:grid-cols-4' : 'grid-cols-3')}>
      {figures.map((f, i) => (
        <FigureCard key={f.key} figure={f} index={i} onCite={onCite} />
      ))}
    </div>
  )
}

function FigureCard({ figure, index, onCite }: { figure: KeyFigure; index: number; onCite: (c: Citation) => void }) {
  const tone = TONE[figure.tone] ?? TONE.neutral
  const first = figure.citations[0]
  const delta = figure.key === 'revenue' && /^[+-]/.test(figure.detail)
  return (
    <div className="relative">
      <button
        onClick={() => first && onCite(first)}
        disabled={!first}
        title={first ? 'Open the database rows behind this number' : undefined}
        style={{ animationDelay: `${index * 70}ms` }}
        className={cn(CARD, 'rise group relative flex h-full min-h-[118px] w-full flex-col overflow-hidden rounded-xl p-4 pr-10 text-left transition duration-300 hover:border-slate-300')}
      >
        <span className="line-clamp-2 text-[13px] leading-tight text-slate-600">{figure.label}</span>
  
        <div className="mt-2 text-[26px] font-bold leading-none tracking-tight text-slate-900 tabular-nums">
          <CountUp value={figure.value} />
        </div>
  
        {/* warnings read as pills (matures soon, overdue); trends as coloured text */}
        <div
          className={cn(
            'mt-2 flex items-start gap-1 text-[13px] font-medium leading-snug',
            !delta && (figure.tone === 'warn' || figure.tone === 'bad')
              ? cn('self-start rounded-full px-2 py-0.5 text-[12px] font-semibold', figure.tone === 'warn' ? 'bg-amber-50 text-amber-800' : 'bg-rose-50 text-rose-800')
              : tone.text,
          )}
        >
          {delta && (
            <svg viewBox="0 0 20 20" className="mt-px h-3.5 w-3.5 shrink-0" fill="currentColor" aria-hidden="true">
              {figure.detail.startsWith('-') ? <path d="M10 15 4 7h12l-6 8Z" /> : <path d="M10 5l6 8H4l6-8Z" />}
            </svg>
          )}
          <span>{delta ? figure.detail.replace(/^[+-]/, '') : figure.detail}</span>
        </div>
  
        {figure.bar_pct !== null && (
          <div className="mt-auto flex items-center gap-2 pt-3" role="img" aria-label={`${figure.bar_pct}% utilized`}>
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
              <div
                className="grow-x h-full rounded-full bg-indigo-500"
                style={{ width: `${Math.min(100, figure.bar_pct)}%` }}
              />
            </div>
            <span className="text-[11px] font-medium tabular-nums text-slate-500">{figure.bar_pct}% used</span>
          </div>
        )}
  
        {figure.trend.length > 1 && <Sparkline points={figure.trend} color={tone.stroke} />}
      </button>
        {INFO[figure.key] && (
        <span className="absolute right-3 top-3.5">
          <InfoTip text={INFO[figure.key]} align="right" />
        </span>
      )}
      </div>
  )
}

/** Quarterly trend drawn behind the bottom-right of the card. Shape only; the numbers are cited. */
function Sparkline({ points, color }: { points: number[]; color: string }) {
  const id = useId()
  const w = 120
  const h = 38
  const min = Math.min(...points)
  const max = Math.max(...points)
  const xy = points.map((p, i) => [
    (i / (points.length - 1)) * w,
    h - 4 - ((p - min) / (max - min || 1)) * (h - 10),
  ])
  const line = xy.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ')
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="pointer-events-none mt-auto block h-[30px] w-full pt-2" aria-hidden="true">
      <defs>
        <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.22" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${line} L${w},${h} L0,${h} Z`} fill={`url(#${id})`} />
      <path d={line} fill="none" stroke={color} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" className="draw" />
    </svg>
  )
}

/** Counts a figure like "$4.15M" or "3" up from zero once; non-numeric values render as is. */
function CountUp({ value }: { value: string }) {
  const m = /^(\$?)(\d+(?:\.\d+)?)(.*)$/.exec(value)
  const target = m ? Number(m[2]) : 0
  const decimals = m?.[2].split('.')[1]?.length ?? 0
  const [shown, setShown] = useState(m ? 0 : target)

  useEffect(() => {
    if (!m || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setShown(target)
      return
    }
    let frame = 0
    const start = performance.now()
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / 700)
      setShown(target * (1 - Math.pow(1 - t, 3)))
      if (t < 1) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  if (!m) return <>{value}</>
  return (
    <>
      {m[1]}
      {shown.toFixed(decimals)}
      {m[3]}
    </>
  )
}
