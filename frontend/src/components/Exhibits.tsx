// ORC-14 / UI-3: structured views shown inside the sections they answer. Built by code from the
// database, so every value is a system-of-record value; rows open their source like a citation.
import type { Citation, ContactRow, Exhibits, PipelineRow, RevenueLine } from '../types'
import { cn, readable } from './ui'

/** 1550000 -> "$1.55M", 450000 -> "$450K". Display only; the cited row keeps the exact value. */
export function money(v: number | null): string {
  if (v === null) return 'n/a'
  for (const [scale, unit] of [
    [1e9, 'B'],
    [1e6, 'M'],
    [1e3, 'K'],
  ] as const) {
    if (Math.abs(v) >= scale) return `$${(v / scale).toFixed(2).replace(/\.?0+$/, '')}${unit}`
  }
  return `$${v}`
}

function formatDay(iso: string | null | undefined): string {
  return iso ? readable(iso) : ''
}

const CONTACT_TAG = {
  new: { label: 'New', className: 'bg-amber-50 text-amber-700 ring-amber-200' },
  former: { label: 'Former', className: 'bg-slate-100 text-slate-500 ring-slate-200' },
  current: null,
}

/** Client overview: who the people are, who is in the room, and who has changed. */
export function ContactsExhibit({ exhibits, onCite }: { exhibits: Exhibits; onCite: (c: Citation) => void }) {
  if (exhibits.contacts.length === 0) return null
  return (
    <div className="mb-3 overflow-hidden rounded-xl border border-slate-100">
      <h3 className="border-b border-slate-100 bg-slate-50 px-4 py-2.5 text-[12px] font-semibold uppercase tracking-wider text-slate-600">
        Client contacts
      </h3>
      {exhibits.contacts.map((c) => (
        <ContactLine key={c.name} contact={c} onCite={onCite} />
      ))}
      {exhibits.coverage.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-slate-100 bg-slate-50/70 px-4 py-2 text-[12px] text-slate-500">
          <span className="font-medium text-slate-400">Our coverage</span>
          {exhibits.coverage.map((m) => (
            <span key={m.name}>
              <span className="font-medium text-slate-700">{m.name}</span> · {m.role}
              {m.primary && <span className="ml-1 text-indigo-600">(primary)</span>}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

function ContactLine({ contact: c, onCite }: { contact: ContactRow; onCite: (c: Citation) => void }) {
  const tag = CONTACT_TAG[c.status]
  const former = c.status === 'former'
  return (
    <button
      onClick={() => c.citation && onCite(c.citation)}
      disabled={!c.citation}
      className={cn(
        'flex w-full items-center gap-3 border-t border-slate-100 px-4 py-2.5 text-left text-[13.5px] transition first:border-t-0 hover:bg-indigo-50/40',
        former && 'bg-slate-50/60',
      )}
    >
      <span className="min-w-0 flex-1">
        <span className={cn('font-semibold', former ? 'text-slate-400 line-through decoration-slate-300' : 'text-slate-800')}>
          {c.name}
        </span>
        <span className="text-slate-500">
          {' '}
          · {c.title}
          {former && c.until ? `, left ${formatDay(c.until)}` : c.since ? ` since ${formatDay(c.since)}` : ''}
        </span>
      </span>
      {tag && (
        <span className={cn('rounded-md px-1.5 py-0.5 text-[11px] font-semibold ring-1 ring-inset', tag.className)}>
          {tag.label}
        </span>
      )}
      {c.attending && (
        <span className="inline-flex items-center gap-1 rounded-md bg-indigo-50 px-1.5 py-0.5 text-[11px] font-semibold text-indigo-700 ring-1 ring-inset ring-indigo-100">
          <svg viewBox="0 0 20 20" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M3 6.5h14v10H3zM3 9.5h14M7 3.5v3M13 3.5v3" strokeLinejoin="round" />
          </svg>
          Attending
        </span>
      )}
    </button>
  )
}

/** Key metrics: each product line, prior vs current TTM, so the driver of the change is visible. */
export function RevenueExhibit({ exhibits, onCite }: { exhibits: Exhibits; onCite: (c: Citation) => void }) {
  const lines = exhibits.revenue_lines
  if (lines.length === 0) return null
  const max = Math.max(...lines.flatMap((l) => [l.current ?? 0, l.prior ?? 0]), 1)
  return (
    <button
      onClick={() => exhibits.revenue_citation && onCite(exhibits.revenue_citation)}
      className="mb-3 block w-full rounded-xl bg-slate-50/70 p-4 text-left ring-1 ring-slate-100 transition hover:ring-indigo-200"
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-[12px] text-slate-500">
        <span className="font-semibold text-slate-700">Revenue by product line</span>
        <span className="flex gap-3">
          <Legend className="bg-slate-300" label="Prior TTM" />
          <Legend className="bg-indigo-500" label="Current TTM" />
        </span>
      </div>
      <div className="space-y-2.5">
        {lines.map((l) => (
          <RevenueBar key={l.line} line={l} max={max} />
        ))}
      </div>
    </button>
  )
}

function Legend({ className, label }: { className: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn('h-2 w-2 rounded-sm', className)} />
      {label}
    </span>
  )
}

function RevenueBar({ line: l, max }: { line: RevenueLine; max: number }) {
  const down = (l.yoy_pct ?? 0) < 0
  return (
    <div className="grid grid-cols-[110px_1fr_120px_56px] items-center gap-3 text-[13px]">
      <span className="truncate font-medium text-slate-700">{l.line}</span>
      <span className="space-y-[3px]">
        <span className="block h-1.5 rounded-full bg-slate-300" style={{ width: `${((l.prior ?? 0) / max) * 100}%` }} />
        <span
          className="grow-x block h-1.5 rounded-full bg-indigo-500"
          style={{ width: `${((l.current ?? 0) / max) * 100}%` }}
        />
      </span>
      <span className="text-right tabular-nums text-slate-700">
        {money(l.current)} <span className="text-slate-400">/ {money(l.prior)}</span>
      </span>
      <span
        className={cn(
          'text-right font-semibold tabular-nums',
          l.yoy_pct === null ? 'text-slate-400' : down ? 'text-rose-600' : 'text-emerald-600',
        )}
      >
        {l.yoy_pct === null ? 'n/a' : `${l.yoy_pct > 0 ? '+' : ''}${l.yoy_pct}%`}
      </span>
    </div>
  )
}

const STAGE_TONE: Record<string, string> = {
  mandated: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  'proposal pending': 'bg-indigo-50 text-indigo-700 ring-indigo-200',
  qualified: 'bg-indigo-50/60 text-indigo-600 ring-indigo-100',
  identified: 'bg-slate-100 text-slate-600 ring-slate-200',
  stalled: 'bg-amber-50 text-amber-700 ring-amber-200',
}

/** Opportunities: stage, size and likelihood at a glance, each row opening its pipeline record. */
export function PipelineExhibit({ exhibits, onCite }: { exhibits: Exhibits; onCite: (c: Citation) => void }) {
  if (exhibits.pipeline.length === 0) return null
  return (
    <div className="mb-3 overflow-hidden rounded-xl ring-1 ring-slate-100">
      {exhibits.pipeline.map((p) => (
        <PipelineLine key={p.product} row={p} onCite={onCite} />
      ))}
    </div>
  )
}

function PipelineLine({ row: p, onCite }: { row: PipelineRow; onCite: (c: Citation) => void }) {
  return (
    <button
      onClick={() => p.citation && onCite(p.citation)}
      disabled={!p.citation}
      className="grid w-full grid-cols-[1fr_auto] gap-x-4 gap-y-1.5 border-t border-slate-100 px-4 py-3 text-left transition first:border-t-0 hover:bg-indigo-50/40"
    >
      <span className="min-w-0">
        <span className="block truncate text-[13.5px] font-semibold text-slate-800">{p.product}</span>
        {p.next_step && <span className="block truncate text-[12px] text-slate-500">Next: {readable(p.next_step)}</span>}
      </span>
      <span className="text-right">
        <span className="block text-[15px] font-semibold tabular-nums text-slate-900">{money(p.est_revenue)}</span>
        <span className="text-[11px] text-slate-400">est. revenue</span>
      </span>
      <span className="col-span-2 flex items-center gap-3">
        <span
          className={cn(
            'w-[118px] shrink-0 rounded-md px-1.5 py-0.5 text-center text-[11px] font-semibold capitalize ring-1 ring-inset',
            STAGE_TONE[p.stage] ?? STAGE_TONE.identified,
          )}
        >
          {p.stage}
        </span>
        {p.probability !== null && (
          <span className="flex flex-1 items-center gap-2" title={`${p.probability}% probability`}>
            <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
              <span
                className="grow-x block h-full rounded-full bg-gradient-to-r from-indigo-400 to-indigo-600"
                style={{ width: `${p.probability}%` }}
              />
            </span>
            <span className="w-14 text-right text-[11px] tabular-nums text-slate-500">{p.probability}% likely</span>
          </span>
        )}
      </span>
    </button>
  )
}
