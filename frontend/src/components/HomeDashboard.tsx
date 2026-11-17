// UI-11 home: the next meeting first, with what to know before going in; then this week's meetings,
// the clients covered and the facilities coming up for maturity. All from API-15, so coverage applies.
import { useEffect, useState } from 'react'
import { api, type HomeData } from '../api'
import { money } from './Exhibits'
import { CARD, ClientTile, Spinner, clientTone, cn, formatTime, readable, shortTitle } from './ui'

interface Props {
  userId: string
  name: string
  onOpenMeeting: (meetingId: string) => void
  onOpenClient: (clientId: string) => void
  onAsk: (clientId: string) => void
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
  if (n === 0) return 'today'
  if (n === 1) return 'tomorrow'
  if (n < 60) return `in ${n} days`
  return `in ${Math.round(n / 30)} months`
}

const short = (name: string) => name.replace(/ (Inc\.|plc|LLC)$/, '')

export function HomeDashboard({ userId, name, onOpenMeeting, onOpenClient, onAsk }: Props) {
  const [data, setData] = useState<HomeData | null>(null)

  useEffect(() => {
    setData(null)
    api.home(userId).then(setData)
  }, [userId])

  if (!data) {
    return (
      <div className="grid h-full place-items-center">
        <Spinner className="h-5 w-5 text-slate-400" />
      </div>
    )
  }
  const soon = data.facilities.filter((f) => f.matures_within_12m).length
  const next = data.meetings[0]
  return (
    <div className="mx-auto flex max-w-[1200px] flex-col gap-8 px-6 pb-16 pt-10">
      <div className="rise">
        <h1 className="text-[30px] font-bold leading-tight tracking-tight">
          {greeting()}, {name}
        </h1>
        <p className="mt-1.5 text-[15px] text-slate-600">
          {data.meetings.length} client {data.meetings.length === 1 ? 'meeting' : 'meetings'} coming up
          {soon > 0 && ` · ${soon} ${soon === 1 ? 'facility matures' : 'facilities mature'} within 12 months`}
        </p>
      </div>

      {next && <NextUp data={data} onOpenMeeting={onOpenMeeting} onAsk={onAsk} />}

      <div className="grid items-start gap-6 lg:grid-cols-2">
        <section className={cn(CARD, 'rise')} style={{ animationDelay: '120ms' }}>
          <header className="flex items-baseline justify-between px-6 pb-3 pt-5">
            <h2 className="text-[17px] font-semibold">This week</h2>
            <span className="text-[13px] text-slate-600">
              {data.meetings.length} {data.meetings.length === 1 ? 'meeting' : 'meetings'}
            </span>
          </header>
          <ul className="px-3 pb-3">
            {data.meetings.map((m) => {
              const when = new Date(m.start_time)
              return (
                <li key={m.meeting_id}>
                  <button
                    onClick={() => onOpenMeeting(m.meeting_id)}
                    className="flex w-full gap-4 rounded-xl px-3 py-3.5 text-left transition hover:bg-slate-50"
                  >
                    <span className="flex w-[52px] shrink-0 flex-col text-[13px] leading-tight">
                      <span className="font-semibold">
                        {when.toLocaleDateString('en-GB', { weekday: 'short' })} {when.getDate()}
                      </span>
                      <span className="text-slate-600">{formatTime(when)}</span>
                    </span>
                    <span aria-hidden="true" className={cn('w-1 shrink-0 rounded-full', clientTone(m.client_id).solid)} />
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="text-[15px] font-semibold">{m.legal_name}</span>
                      <span className="text-[14px] text-slate-700">{m.purpose}</span>
                      <span className="text-[13px] text-slate-600">{m.client_attendees.join(', ')}</span>
                    </span>
                    <span className="self-center">
                      <ReadyPill ready={!!m.last_prepared} />
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        </section>

        <section className={cn(CARD, 'rise')} style={{ animationDelay: '180ms' }}>
          <header className="flex items-baseline justify-between px-6 pb-3 pt-5">
            <h2 className="text-[17px] font-semibold">Clients</h2>
            <span className="text-[13px] text-slate-600">Relationship revenue, TTM</span>
          </header>
          <ul className="px-3 pb-3">
            {data.companies.map((c) => {
              const down = (c.yoy_pct ?? 0) < 0
              return (
                <li key={c.client_id}>
                  <button
                    onClick={() => onOpenClient(c.client_id)}
                    className="flex w-full items-center gap-3.5 rounded-xl px-3 py-3.5 text-left transition hover:bg-slate-50"
                  >
                    <ClientTile clientId={c.client_id} name={c.name} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px] font-semibold">{c.name}</span>
                      <span className="block text-[13px] text-slate-600">
                        {c.industry}
                        {c.role && <span className="capitalize"> · {c.role}</span>}
                      </span>
                      {c.aliases.length > 0 && (
                        <span className="mt-1.5 flex flex-wrap gap-1">
                          {c.aliases.slice(0, 3).map((a) => (
                            <span key={a} className="rounded bg-slate-100 px-2 py-0.5 text-[12px] text-slate-700">
                              {a}
                            </span>
                          ))}
                        </span>
                      )}
                    </span>
                    <span className="shrink-0 text-right">
                      {c.revenue_ttm === null ? (
                        <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[12px] font-semibold text-amber-800">
                          Data incomplete
                        </span>
                      ) : (
                        <>
                          <span className="block text-[15px] font-semibold tabular-nums">{money(c.revenue_ttm)}</span>
                          <span className={cn('block text-[13px] font-medium tabular-nums', down ? 'text-rose-700' : 'text-emerald-700')}>
                            {down ? '▼' : '▲'} {Math.abs(c.yoy_pct ?? 0)}%
                          </span>
                        </>
                      )}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        </section>
      </div>

      <Facilities data={data} onOpenClient={onOpenClient} />
    </div>
  )
}

/** The next meeting, with what to know before going in. */
function NextUp({
  data,
  onOpenMeeting,
  onAsk,
}: {
  data: HomeData
  onOpenMeeting: (meetingId: string) => void
  onAsk: (clientId: string) => void
}) {
  const m = data.meetings[0]
  const when = new Date(m.start_time)
  const company = data.companies.find((c) => c.client_id === m.client_id)
  const maturing = data.facilities.find((f) => f.client_id === m.client_id && f.matures_within_12m)
  const chips: { text: string; tone: string }[] = []
  if (company?.yoy_pct != null) {
    const down = company.yoy_pct < 0
    chips.push({
      text: `${down ? '▼' : '▲'} Revenue ${down ? 'down' : 'up'} ${Math.abs(company.yoy_pct)}% YoY`,
      tone: down ? 'bg-rose-50 text-rose-800' : 'bg-emerald-50 text-emerald-800',
    })
  } else if (company) {
    chips.push({ text: 'Revenue data incomplete', tone: 'bg-amber-50 text-amber-800' })
  }
  if (maturing?.maturity_date) {
    chips.push({ text: `Facility matures ${inDays(daysUntil(data.today, maturing.maturity_date))}`, tone: 'bg-amber-50 text-amber-800' })
  }
  for (const k of company?.new_contacts ?? []) {
    chips.push({ text: `New ${shortTitle(k.title)} since ${readable(k.since)}`, tone: 'bg-slate-100 text-slate-700' })
  }
  return (
    <section className={cn(CARD, 'rise overflow-hidden')} style={{ animationDelay: '60ms' }}>
      <div className="flex flex-wrap items-center gap-6 p-6">
        <span aria-hidden="true" className="flex h-[76px] w-[72px] shrink-0 flex-col items-center justify-center rounded-xl bg-slate-900 leading-tight text-white">
          <span className="text-[12px] font-semibold uppercase tracking-wider text-slate-300">
            {when.toLocaleDateString('en-GB', { weekday: 'short' })}
          </span>
          <span className="text-[28px] font-bold">{when.getDate()}</span>
        </span>
        <div className="flex min-w-0 flex-[1_1_360px] flex-col gap-1.5">
          <p className="flex flex-wrap items-center gap-2 text-[13px] text-slate-600">
            <span className="font-semibold uppercase tracking-wider text-slate-900">Next up</span>
            <span>·</span>
            <span>
              {formatTime(when)}, {inDays(daysUntil(data.today, m.start_time))}
            </span>
            <ReadyPill ready={!!m.last_prepared} />
          </p>
          <h2 className="text-[22px] font-bold tracking-tight">{m.legal_name}</h2>
          <p className="text-[15px] text-slate-700">
            {m.purpose} · {m.client_attendees.join(', ')}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => onAsk(m.client_id)}
            className="inline-flex h-11 items-center gap-2 rounded-[10px] border border-slate-300 bg-white px-4 text-[14px] font-medium text-slate-900 transition hover:bg-slate-100"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" />
            </svg>
            Ask about this client
          </button>
          <button
            onClick={() => onOpenMeeting(m.meeting_id)}
            className="inline-flex h-11 items-center gap-2 rounded-[10px] bg-slate-900 px-5 text-[14px] font-semibold text-white transition hover:bg-slate-800"
          >
            {m.last_prepared ? 'Open briefing' : 'Prepare briefing'}
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M5 12h14M13 6l6 6-6 6" />
            </svg>
          </button>
        </div>
      </div>
      {chips.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-slate-100 bg-slate-50 px-6 py-3.5 text-[13px]">
          <span className="mr-1 font-semibold text-slate-600">Before you go in</span>
          {chips.map((c) => (
            <span key={c.text} className={cn('inline-flex h-[26px] items-center rounded-full px-2.5 font-medium', c.tone)}>
              {c.text}
            </span>
          ))}
        </div>
      )}
    </section>
  )
}

/** Facilities on a shared timeline from now to the latest maturity; the next 12 months are shaded. */
function Facilities({ data, onOpenClient }: { data: HomeData; onOpenClient: (clientId: string) => void }) {
  const start = new Date(data.today)
  const lastYear = Math.max(start.getFullYear() + 5, ...data.facilities.map((f) => Number(f.maturity_date?.slice(0, 4) ?? 0)))
  const end = new Date(`${lastYear}-12-31`)
  const span = end.getTime() - start.getTime()
  const at = (iso: string) => Math.min(100, Math.max(0, ((Date.parse(iso) - start.getTime()) / span) * 100))
  const yearMark = (y: number) => at(`${y}-01-01`)
  const twelve = at(new Date(start.getTime() + 365 * 86_400_000).toISOString())
  const years = Array.from({ length: lastYear - start.getFullYear() }, (_, i) => start.getFullYear() + 1 + i)
    .filter((y) => yearMark(y) > 8) // a year mark right after Now would overlap its label

  return (
    <section className={cn(CARD, 'rise flex flex-col gap-4 px-6 pb-6 pt-5')} style={{ animationDelay: '240ms' }}>
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[17px] font-semibold">Facilities &amp; maturities</h2>
        <span className="inline-flex items-center gap-1.5 text-[13px] text-slate-600">
          <span aria-hidden="true" className="h-3 w-3 rounded-[3px] border border-amber-300 bg-amber-50" />
          Within 12 months
        </span>
      </header>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] border-collapse text-[14px]">
          <thead>
            <tr className="text-left text-[12px] text-slate-600">
              <th scope="col" className="pb-2.5 pr-4 font-medium">Facility</th>
              <th scope="col" className="pb-2.5 pr-4 text-right font-medium">Size</th>
              <th scope="col" className="w-[42%] pb-2.5 pr-4 font-medium">
                <span className="relative block h-4">
                  <span className="absolute left-0">Now</span>
                  {years.map((y) => (
                    <span key={y} className="absolute -translate-x-1/2" style={{ left: `${yearMark(y)}%` }}>
                      {y}
                    </span>
                  ))}
                </span>
              </th>
              <th scope="col" className="pb-2.5 text-right font-medium">Matures</th>
            </tr>
          </thead>
          <tbody>
            {data.facilities.map((f) => {
              const pos = f.maturity_date ? at(f.maturity_date) : 100
              const used = /utili[sz]ation\s+(\d+(?:\.\d+)?)%/i.exec(f.notes ?? '')?.[1]
              const tone = clientTone(f.client_id)
              return (
                <tr
                  key={`${f.client_id}-${f.product}`}
                  onClick={() => onOpenClient(f.client_id)}
                  className="cursor-pointer border-t border-slate-100 transition hover:bg-slate-50"
                >
                  <th scope="row" className="py-4 pr-4 text-left font-normal">
                    <span className="flex items-center gap-2.5">
                      <span aria-hidden="true" className={cn('h-2.5 w-2.5 rounded-full', tone.solid)} />
                      <span>
                        <span className="block font-semibold">{f.product}</span>
                        <span className="block text-[13px] text-slate-600">
                          {short(f.client)}
                          {used && ` · ${used}% drawn`}
                        </span>
                      </span>
                    </span>
                  </th>
                  <td className="py-4 pr-4 text-right font-semibold tabular-nums">{money(f.notional_usd)}</td>
                  <td className="py-4 pr-4" aria-hidden="true">
                    <div className="relative h-7">
                      <div className="absolute inset-y-0 left-0 rounded-md bg-amber-50" style={{ width: `${twelve}%` }} />
                      <div className="absolute inset-x-0 top-[13px] h-0.5 bg-slate-200" />
                      <div className={cn('grow-x absolute left-0 top-[11px] h-1.5 rounded-full', tone.solid)} style={{ width: `${pos}%` }} />
                      <div
                        className={cn(
                          'absolute top-[7px] -ml-[7px] h-3.5 w-3.5 rounded-full border-[3px] bg-white',
                          f.matures_within_12m ? 'border-amber-700' : 'border-slate-600',
                        )}
                        style={{ left: `${pos}%` }}
                      />
                    </div>
                  </td>
                  <td className="whitespace-nowrap py-4 text-right">
                    <span className="block">{f.maturity_date ? readable(f.maturity_date) : 'n/a'}</span>
                    {f.maturity_date && (
                      <span
                        className={cn(
                          'mt-0.5 inline-block rounded-full px-2 py-0.5 text-[12px]',
                          f.matures_within_12m ? 'bg-amber-50 font-semibold text-amber-800' : 'bg-slate-100 font-medium text-slate-600',
                        )}
                      >
                        {inDays(daysUntil(data.today, f.maturity_date)).replace(/^in/, 'In')}
                      </span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function ReadyPill({ ready }: { ready: boolean }) {
  return ready ? (
    <span className="inline-flex h-[22px] items-center gap-1 rounded-full bg-emerald-50 px-2 text-[12px] font-semibold text-emerald-800">
      <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M5 12l5 5L20 7" />
      </svg>
      Briefing ready
    </span>
  ) : (
    <span className="inline-flex h-[22px] items-center rounded-full bg-slate-100 px-2 text-[12px] font-medium text-slate-600">
      Not prepared
    </span>
  )
}
