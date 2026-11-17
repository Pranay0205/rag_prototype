// UI-11 home: what a coverage banker needs on sign-in. Upcoming meetings, the companies they cover,
// and the facilities (credit contracts) coming up for maturity. All from API-15, so coverage applies.
import { useEffect, useState, type ReactNode } from 'react'
import { api, type HomeData } from '../api'
import { money } from './Exhibits'
import { Spinner, cn, formatTime, readable } from './ui'

interface Props {
  userId: string
  name: string
  onOpenMeeting: (meetingId: string) => void
  onOpenClient: (clientId: string) => void
}

function greeting(): string {
  const h = new Date().getHours()
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'
}

/** Whole days from the data world's "today" (API-15) to an ISO date. */
function daysUntil(today: string, iso: string): number {
  return Math.round((Date.parse(iso.slice(0, 10)) - Date.parse(today)) / 86_400_000)
}

function inDays(n: number): string {
  if (n === 0) return 'Today'
  if (n === 1) return 'Tomorrow'
  if (n < 60) return `In ${n} days`
  return `In ${Math.round(n / 30)} months`
}

function initials(name: string): string {
  return name
    .split(' ')
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
}

export function HomeDashboard({ userId, name, onOpenMeeting, onOpenClient }: Props) {
  const [data, setData] = useState<HomeData | null>(null)

  useEffect(() => {
    setData(null)
    api.home(userId).then(setData)
  }, [userId])

  if (!data) {
    return (
      <div className="grid h-full place-items-center">
        <Spinner className="h-5 w-5 text-slate-300" />
      </div>
    )
  }
  const soon = data.facilities.filter((f) => f.matures_within_12m).length
  return (
    <div className="mx-auto max-w-[1240px] px-8 py-10">
      <h1 className="rise text-3xl font-semibold tracking-tight text-slate-900">
        {greeting()}, {name}
      </h1>
      <p className="rise mt-1.5 text-[15px] text-slate-500" style={{ animationDelay: '60ms' }}>
        {data.meetings.length} client {data.meetings.length === 1 ? 'meeting' : 'meetings'} coming up
        {soon > 0 && ` · ${soon} ${soon === 1 ? 'facility matures' : 'facilities mature'} within 12 months`}
      </p>

      <div className="mt-8 grid gap-5 lg:grid-cols-3">
        <Card title="Meetings" count={data.meetings.length} index={0} icon={<path d="M3.5 6.5h13v10h-13zM3.5 9.5h13M7 3.5v3M13 3.5v3" />}>
          {data.meetings.map((m) => {
            const when = new Date(m.start_time)
            const days = daysUntil(data.today, m.start_time)
            return (
              <Row key={m.meeting_id} onClick={() => onOpenMeeting(m.meeting_id)}>
                <div className="flex items-center justify-between gap-2 text-[12px]">
                  <span className="font-medium text-indigo-600">
                    {when.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })} ·{' '}
                    {formatTime(when)}
                  </span>
                  <span className={cn('font-medium', days <= 2 ? 'text-amber-600' : 'text-slate-400')}>{inDays(days)}</span>
                </div>
                <div className="mt-1 text-[15px] font-semibold text-slate-900">{m.legal_name}</div>
                <div className="mt-0.5 text-[13px] text-slate-500">{m.purpose}</div>
                <div className="mt-2.5 flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2">
                    <span className="flex -space-x-1">
                      {m.client_attendees.map((a) => (
                        <span
                          key={a}
                          title={a}
                          className="grid h-6 w-6 place-items-center rounded-full bg-slate-100 text-[9px] font-semibold text-slate-600 ring-2 ring-white"
                        >
                          {initials(a)}
                        </span>
                      ))}
                    </span>
                    <span className="truncate text-[12px] text-slate-400">{m.client_attendees.join(', ')}</span>
                  </span>
                  <PreparedChip at={m.last_prepared} />
                </div>
              </Row>
            )
          })}
        </Card>

        <Card title="Companies" count={data.companies.length} index={1} icon={<path d="M3.5 16.5v-11l6-3v14M9.5 16.5v-8l7 2.5v5.5M2 16.5h16M6 8h1M6 11h1M12.5 12h1" />}>
          {data.companies.map((c) => {
            const down = (c.yoy_pct ?? 0) < 0
            return (
              <Row key={c.client_id} onClick={() => onOpenClient(c.client_id)}>
                <div className="flex items-center gap-3">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-indigo-50 to-violet-100 text-[12px] font-semibold text-indigo-700">
                    {initials(c.name)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-semibold text-slate-900">{c.name}</span>
                    <span className="block truncate text-[12px] text-slate-500">
                      {c.industry}
                      {c.role && <span className="capitalize"> · {c.role}</span>}
                    </span>
                  </span>
                  <span className="text-right">
                    <span className="block text-[15px] font-semibold tabular-nums text-slate-900">
                      {c.revenue_ttm === null ? 'n/a' : money(c.revenue_ttm)}
                    </span>
                    <span
                      className={cn(
                        'block text-[11.5px] font-medium tabular-nums',
                        c.yoy_pct === null ? 'text-amber-600' : down ? 'text-rose-600' : 'text-emerald-600',
                      )}
                    >
                      {c.yoy_pct === null ? 'Incomplete' : `${down ? '▼' : '▲'} ${Math.abs(c.yoy_pct)}% YoY`}
                    </span>
                  </span>
                </div>
                {c.aliases.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1 pl-[52px]">
                    {c.aliases.slice(0, 3).map((a) => (
                      <span key={a} className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10.5px] text-slate-500">
                        {a}
                      </span>
                    ))}
                  </div>
                )}
              </Row>
            )
          })}
        </Card>

        <Card title="Facilities & maturities" count={data.facilities.length} index={2} icon={<path d="M5.5 2.5h6.5l3.5 3.5v11.5h-10zM12 2.5V6h3.5M8 10h5M8 13h5" />}>
          {data.facilities.map((f) => {
            const days = f.maturity_date ? daysUntil(data.today, f.maturity_date) : null
            const used = /utili[sz]ation\s+(\d+(?:\.\d+)?)%/i.exec(f.notes ?? '')?.[1]
            return (
              <Row key={`${f.client_id}-${f.product}`} onClick={() => onOpenClient(f.client_id)}>
                <div className="flex items-start justify-between gap-3">
                  <span className="min-w-0">
                    <span className="block truncate text-[14px] font-semibold text-slate-900">{f.product}</span>
                    <span className="block truncate text-[12px] text-slate-500">{f.client}</span>
                  </span>
                  <span className="text-[15px] font-semibold tabular-nums text-slate-900">{money(f.notional_usd)}</span>
                </div>
                <div className="mt-2 flex items-center justify-between gap-2 text-[12px]">
                  <span className="text-slate-500">{f.maturity_date ? `Matures ${readable(f.maturity_date)}` : 'No maturity'}</span>
                  {days !== null && (
                    <span
                      className={cn(
                        'rounded-md px-1.5 py-0.5 text-[11px] font-semibold ring-1 ring-inset',
                        f.matures_within_12m ? 'bg-amber-50 text-amber-700 ring-amber-200' : 'bg-slate-50 text-slate-500 ring-slate-200',
                      )}
                    >
                      {inDays(days)}
                    </span>
                  )}
                </div>
                {used && (
                  <div className="mt-2 flex items-center gap-2">
                    <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                      <span className="grow-x block h-full rounded-full bg-gradient-to-r from-indigo-500 to-violet-500" style={{ width: `${used}%` }} />
                    </span>
                    <span className="text-[11px] tabular-nums text-slate-500">{used}% used</span>
                  </div>
                )}
              </Row>
            )
          })}
        </Card>
      </div>
    </div>
  )
}

function Card({ title, count, index, icon, children }: { title: string; count: number; index: number; icon: ReactNode; children: ReactNode }) {
  return (
    <section
      className="rise flex flex-col overflow-hidden rounded-2xl bg-white shadow-[0_1px_2px_rgba(15,23,42,0.03),0_12px_32px_-16px_rgba(15,23,42,0.12)] ring-1 ring-slate-900/[0.05]"
      style={{ animationDelay: `${120 + index * 80}ms` }}
    >
      <header className="flex items-center gap-2.5 border-b border-slate-100 px-5 py-4">
        <span className="grid h-7 w-7 place-items-center rounded-lg bg-indigo-50 text-indigo-600">
          <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            {icon}
          </svg>
        </span>
        <h2 className="text-[15px] font-semibold tracking-tight text-slate-900">{title}</h2>
        <span className="rounded-full bg-slate-100 px-2 text-[11px] font-medium tabular-nums text-slate-500">{count}</span>
      </header>
      <div className="divide-y divide-slate-100">{children}</div>
    </section>
  )
}

function Row({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button onClick={onClick} className="block w-full px-5 py-4 text-left transition hover:bg-indigo-50/40">
      {children}
    </button>
  )
}

function PreparedChip({ at }: { at: string | null }) {
  if (!at) {
    return <span className="shrink-0 rounded-md bg-slate-50 px-1.5 py-0.5 text-[11px] font-medium text-slate-400 ring-1 ring-inset ring-slate-200">Not prepared</span>
  }
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-emerald-50 px-1.5 py-0.5 text-[11px] font-medium text-emerald-700 ring-1 ring-inset ring-emerald-200">
      <svg viewBox="0 0 20 20" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
        <path d="M5 10.5 8.5 14 15 6" />
      </svg>
      Briefing ready
    </span>
  )
}
