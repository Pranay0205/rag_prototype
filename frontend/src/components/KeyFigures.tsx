// ORC-13 / UI-3: headline cards computed by code from the database. They arrive before any model
// call, so the page has real numbers within a second. Click a card to open the rows behind it.
import { useEffect, useId, useState, type ReactNode } from 'react'
import type { Citation, KeyFigure } from '../types'
import { cn } from './ui'

interface Props {
  figures: KeyFigure[]
  loading: boolean
  onCite: (citation: Citation) => void
}

const TONE = {
  good: { text: 'text-emerald-600', stroke: '#10b981', soft: 'bg-emerald-50 text-emerald-600' },
  bad: { text: 'text-rose-600', stroke: '#f43f5e', soft: 'bg-rose-50 text-rose-600' },
  warn: { text: 'text-amber-600', stroke: '#f59e0b', soft: 'bg-amber-50 text-amber-600' },
  neutral: { text: 'text-slate-500', stroke: '#6366f1', soft: 'bg-indigo-50 text-indigo-600' },
}

const ICONS: Record<string, ReactNode> = {
  revenue: <path d="M3 14.5 7.5 10l3 3L17 6.5M12.5 6.5H17V11" />,
  facility: <path d="M3 8 10 3.5 17 8M4.5 8v7.5M8 8v7.5M12 8v7.5M15.5 8v7.5M3 16.5h14" />,
  pipeline: <path d="M3 4.5h14l-5.25 6.25V16l-3.5-1.75v-3.5L3 4.5Z" />,
  actions: <path d="M8 5.5h9M8 10h9M8 14.5h9M3.5 5.5l1 1 1.75-2M3.5 10l1 1 1.75-2M3.5 14.5l1 1 1.75-2" />,
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
    <button
      onClick={() => first && onCite(first)}
      disabled={!first}
      title={first ? 'Open the database rows behind this number' : undefined}
      style={{ animationDelay: `${index * 70}ms` }}
      className="rise group relative flex min-h-[118px] flex-col overflow-hidden rounded-2xl bg-white p-4 text-left shadow-[0_1px_2px_rgba(15,23,42,0.03)] ring-1 ring-slate-900/[0.05] transition duration-300 hover:-translate-y-0.5 hover:shadow-[0_12px_32px_-12px_rgba(79,70,229,0.25)] hover:ring-indigo-200"
    >
      <div className="flex items-center gap-2">
        <span className={cn('grid h-6 w-6 shrink-0 place-items-center rounded-lg', tone.soft)}>
          <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            {ICONS[figure.key] ?? ICONS.revenue}
          </svg>
        </span>
        <span className="line-clamp-2 text-[12px] font-medium leading-tight text-slate-500">{figure.label}</span>
      </div>

      <div className="mt-3 text-[26px] font-semibold leading-none tracking-tight text-slate-900 tabular-nums">
        <CountUp value={figure.value} />
      </div>

      <div className={cn('mt-2 flex items-start gap-1 text-[12px] font-medium leading-snug', tone.text)}>
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
              className="grow-x h-full rounded-full bg-gradient-to-r from-indigo-500 to-violet-500"
              style={{ width: `${Math.min(100, figure.bar_pct)}%` }}
            />
          </div>
          <span className="text-[11px] font-medium tabular-nums text-slate-500">{figure.bar_pct}% used</span>
        </div>
      )}

      {figure.trend.length > 1 && <Sparkline points={figure.trend} color={tone.stroke} />}
    </button>
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
