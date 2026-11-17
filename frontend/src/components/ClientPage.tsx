// UI-14 client profile: the relationship as a whole, not one meeting. Opened from Home's client list
// and facilities. Everything comes from API-18 (typed tools, access applied, no model), and every row
// opens its source in the drawer.
import { useEffect, useState, type ReactNode } from 'react'
import { ApiError, api, type ClientOverview } from '../api'
import type { Citation } from '../types'
import { money } from './Exhibits'
import { SourceKindIcon } from './SectionCard'
import { CARD, ClientTile, InfoTip, Spinner, cn, formatMeetingTime, readable } from './ui'

interface Props {
  clientId: string
  userId: string
  onCite: (c: Citation) => void
  onOpenMeeting: (meetingId: string) => void
  onAsk: (clientId: string) => void
  openRevenue?: boolean // the Home "try" card: show the revenue calculation straight away
}

// What each card shows, for the info icon beside its title
const INFO: Record<string, string> = {
  'Relationship revenue (TTM)':
    'Revenue Meridian earned from this client over the last four reported quarters, compared with the four before. Calculated from the revenue records; select the card to see the working.',
  'Products held':
    'Products and facilities the client holds with Meridian. Credit facilities are those with a committed amount.',
  'Open pipeline':
    'Estimated revenue from opportunities not yet won or lost, summed. Only opportunities you are cleared to see are included.',
  'Open actions': 'Commitments Meridian made to the client that are still open. Overdue means past the agreed due date.',
  Revenue:
    'Quarterly relationship revenue over two years. The four highlighted quarters make up the current twelve-month figure; the table shows which product lines drove the change.',
  'Products & facilities':
    'Each product the client holds, with its size, maturity and how much is drawn. A facility maturing within 12 months is the next refinancing conversation.',
  Pipeline: 'Open opportunities with their stage, estimated revenue and probability, and the next step on record.',
  'Interaction history': 'Calls and meetings logged in the CRM, most recent first.',
  'Upcoming meetings': 'Scheduled meetings with this client. Select one to open or prepare its briefing.',
  People:
    'Client contacts, current and former, and the Meridian team covering the client. Contacts who joined recently are marked New.',
  'Open actions & service issues':
    'Open commitments to the client, and problems the client raised with Meridian, with their dates and status.',
  'Company performance': "The client's own reported results, taken from its filings. These are not Meridian revenue.",
  Documents: 'Emails, notes, news and prior briefings linked to this client that you are cleared to see, newest first.',
}

const DOCS_SHOWN = 5 // most recent first; the rest behind "Show all"

const STAGE: Record<string, string> = {
  mandated: 'bg-emerald-50 text-emerald-800',
  proposal_pending: 'bg-indigo-50 text-indigo-700',
  qualified: 'bg-indigo-50 text-indigo-700',
  identified: 'bg-slate-100 text-slate-700',
  stalled: 'bg-amber-50 text-amber-800',
}

export function ClientPage({ clientId, userId, onCite, onOpenMeeting, onAsk, openRevenue }: Props) {
  const [data, setData] = useState<ClientOverview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [allDocs, setAllDocs] = useState(false)

  useEffect(() => {
    setData(null)
    setError(null)
    api.clientOverview(clientId, userId).then((d) => {
      setData(d)
      if (openRevenue && d.revenue.citation) onCite(d.revenue.citation)
    }, (e: ApiError) => setError(e.message))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, userId])

  if (error) return <p className="mx-auto mt-10 max-w-3xl rounded-xl bg-rose-50 p-4 text-sm text-rose-700">{error}</p>
  if (!data) {
    return (
      <div className="grid h-64 place-items-center">
        <Spinner className="h-5 w-5 text-slate-400" />
      </div>
    )
  }

  const c = data.client
  const total = data.revenue.total ?? { current_ttm: null, prior_ttm: null, yoy_pct: null }
  const openOpps = data.opportunities
  const openActions = data.actions.filter((a) => a.status === 'open')
  const overdue = openActions.filter((a) => a.overdue).length
  const nextMeeting = data.meetings[0]
  const short = c.short_name
  const current = data.contacts.filter((k) => k.is_active)
  const former = data.contacts.filter((k) => !k.is_active)

  return (
    <div className="mx-auto flex max-w-[1240px] flex-col gap-6 px-6 pb-28 pt-8">
      {/* header */}
      <header className="flex flex-wrap items-start gap-5">
        <ClientTile clientId={c.client_id} name={c.legal_name} size="lg" />
        <div className="min-w-0 flex-[1_1_420px]">
          <p className="text-[13px] text-slate-600">
            {c.industry} · {c.segment} · {c.hq_city}, {c.hq_country} · client since {readable(c.created_date)}
          </p>
          <h1 className="mt-1.5 text-[30px] font-bold leading-tight tracking-tight">{c.legal_name}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[12px]">
            <span className="text-slate-500">Also known as</span>
            {data.aliases.map((a) => (
              <span key={a} className="rounded bg-slate-100 px-2 py-0.5 text-slate-700">
                {a}
              </span>
            ))}
            <button onClick={() => c.citation && onCite(c.citation)} className="ml-1 font-mono text-[11.5px] text-slate-400 hover:text-slate-700">
              LEI {c.lei}
            </button>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => onAsk(c.client_id)}
            className="inline-flex h-11 items-center gap-2 rounded-[10px] border border-slate-300 bg-white px-4 text-[14px] font-medium transition hover:bg-slate-100"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" />
            </svg>
            Ask about {short}
          </button>
          {nextMeeting && (
            <button
              onClick={() => onOpenMeeting(nextMeeting.meeting_id)}
              className="inline-flex h-11 items-center gap-2 rounded-[10px] bg-slate-900 px-5 text-[14px] font-semibold text-white transition hover:bg-slate-800"
            >
              Next meeting briefing
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M5 12h14M13 6l6 6-6 6" />
              </svg>
            </button>
          )}
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-[13px] text-slate-600">
        <DataAsOf data={data} />
        {data.access_limited && (
          <p className="flex items-center gap-2">
            <LockIcon /> Some records for this client are restricted for your profile.
          </p>
        )}
      </div>

      {/* headline numbers */}
      <section aria-label="Relationship at a glance" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="Relationship revenue (TTM)"
          value={total.current_ttm == null ? 'Incomplete' : money(total.current_ttm)}
          note={
            total.yoy_pct == null
              ? `${(data.revenue.missing_quarters ?? []).join(', ') || 'A quarter'} not reported`
              : `${total.yoy_pct < 0 ? '▼' : '▲'} ${Math.abs(total.yoy_pct)}% vs ${money(total.prior_ttm ?? 0)} prior`
          }
          tone={total.yoy_pct == null ? 'warn' : total.yoy_pct < 0 ? 'bad' : 'good'}
          onClick={() => data.revenue.citation && onCite(data.revenue.citation)}
        />
        <Stat label="Products held" value={String(data.holdings.length)} note={`${data.holdings.filter((h) => h.notional_usd).length} credit facilities`} />
        <Stat
          label="Open pipeline"
          value={money(openOpps.reduce((s, o) => s + (o.est_revenue_usd ?? 0), 0))}
          note={`${openOpps.length} ${openOpps.length === 1 ? 'opportunity' : 'opportunities'}`}
        />
        <Stat
          label="Open actions"
          value={String(openActions.length)}
          note={overdue ? `${overdue} overdue` : 'None overdue'}
          tone={overdue ? 'bad' : 'good'}
        />
      </section>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="flex min-w-0 flex-col gap-6">
          <Panel title="Revenue" note={data.revenue.current_period ? `TTM ${readable(data.revenue.current_period)}` : undefined}>
            <QuarterChart quarters={data.revenue.quarterly ?? []} />
            <table className="mt-4 w-full text-[14px]">
              <thead>
                <tr className="text-left text-[12px] text-slate-600">
                  <th className="pb-2 font-medium">Product line</th>
                  <th className="pb-2 text-right font-medium">Current TTM</th>
                  <th className="pb-2 text-right font-medium">Prior TTM</th>
                  <th className="pb-2 text-right font-medium">Change</th>
                </tr>
              </thead>
              <tbody>
                {(data.revenue.by_product_line ?? []).map((l) => (
                  <tr key={l.product_line} className="border-t border-slate-100">
                    <td className="py-2.5 font-medium">{l.product_line}</td>
                    <td className="py-2.5 text-right tabular-nums">{l.current_ttm == null ? 'n/a' : money(l.current_ttm)}</td>
                    <td className="py-2.5 text-right tabular-nums text-slate-600">{l.prior_ttm == null ? 'n/a' : money(l.prior_ttm)}</td>
                    <td
                      className={cn(
                        'py-2.5 text-right font-semibold tabular-nums',
                        l.yoy_pct == null ? 'text-slate-400' : l.yoy_pct < 0 ? 'text-rose-700' : 'text-emerald-700',
                      )}
                    >
                      {l.yoy_pct == null ? 'n/a' : `${l.yoy_pct > 0 ? '+' : ''}${l.yoy_pct}%`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>

          <Panel title="Products & facilities" note={`${data.holdings.length} held`}>
            <ul>
              {data.holdings.map((h) => {
                const used = /utili[sz]ation\s+(\d+(?:\.\d+)?)%/i.exec(h.notes ?? '')?.[1]
                return (
                  <Row key={h.holding_id} onClick={() => h.citation && onCite(h.citation)}>
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold">{h.product}</span>
                      <span className="block text-[13px] text-slate-600">
                        Since {readable(h.opened_date)}
                        {h.maturity_date && ` · matures ${readable(h.maturity_date)}`}
                        {used && ` · ${used}% drawn`}
                        {!used && h.notes && ` · ${readable(h.notes)}`}
                      </span>
                    </span>
                    {h.matures_within_12m && <Pill tone="bg-amber-50 text-amber-800">Matures within 12 months</Pill>}
                    <span className="w-20 text-right font-semibold tabular-nums">{h.notional_usd ? money(h.notional_usd) : ''}</span>
                  </Row>
                )
              })}
            </ul>
          </Panel>

          <Panel title="Pipeline" note={`${openOpps.length} open`}>
            {openOpps.length === 0 && <Empty>No open opportunities.</Empty>}
            <ul>
              {openOpps.map((o) => (
                <Row key={o.opp_id} onClick={() => o.citation && onCite(o.citation)}>
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold">{o.product}</span>
                    <span className="block text-[13px] text-slate-600">Next: {readable(o.next_step ?? 'not set')}</span>
                  </span>
                  <Pill tone={STAGE[o.stage] ?? STAGE.identified}>{o.stage.replace(/_/g, ' ')}</Pill>
                  <span className="w-24 text-right">
                    <span className="block font-semibold tabular-nums">{money(o.est_revenue_usd)}</span>
                    <span className="block text-[12px] text-slate-500">{o.probability_pct}% likely</span>
                  </span>
                </Row>
              ))}
            </ul>
          </Panel>

          <Panel title="Interaction history" note="Most recent first">
            {data.interactions.length === 0 && <Empty>No logged interactions.</Empty>}
            <ol className="relative ml-2 border-l border-slate-200 pl-5">
              {data.interactions.map((i) => (
                <li key={i.interaction_id} className="relative pb-5 last:pb-1">
                  <span className="absolute -left-[27px] top-1 h-3 w-3 rounded-full border-2 border-white bg-slate-400 ring-1 ring-slate-300" />
                  <button onClick={() => i.citation && onCite(i.citation)} className="text-left">
                    <span className="block text-[12px] text-slate-500">
                      {readable(i.date)} · {i.type.replace(/_/g, ' ')}
                    </span>
                    <span className="block font-medium hover:text-indigo-700">{i.subject}</span>
                    <span className="block text-[13px] text-slate-600">With {JSON.parse(i.client_attendees || '[]').join(', ')}</span>
                  </button>
                </li>
              ))}
            </ol>
          </Panel>
        </div>

        <div className="flex flex-col gap-6">
          {data.meetings.length > 0 && (
            <Panel title="Upcoming meetings">
              <ul>
                {data.meetings.map((m) => (
                  <Row key={m.meeting_id} onClick={() => onOpenMeeting(m.meeting_id)}>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] font-medium text-indigo-700">{formatMeetingTime(m.start_time)}</span>
                      <span className="block font-semibold">{m.purpose}</span>
                      <span className="block text-[13px] text-slate-600">{m.client_attendees.join(', ')}</span>
                    </span>
                    <span className="text-[13px] font-medium text-slate-900">Briefing →</span>
                  </Row>
                ))}
              </ul>
            </Panel>
          )}

          <Panel title="People">
            <ul>
              {current.map((k) => (
                <Row key={k.contact_id} onClick={() => k.citation && onCite(k.citation)}>
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold">{k.name}</span>
                    <span className="block text-[13px] text-slate-600">
                      {k.title} · since {readable(k.start_date)}
                    </span>
                  </span>
                  {k.changed_recently && <Pill tone="bg-amber-50 text-amber-800">New</Pill>}
                </Row>
              ))}
              {former.map((k) => (
                <Row key={k.contact_id} onClick={() => k.citation && onCite(k.citation)}>
                  <span className="min-w-0 flex-1 text-slate-500">
                    <span className="block font-semibold line-through decoration-slate-300">{k.name}</span>
                    <span className="block text-[13px]">
                      {k.title} · left {readable(k.end_date ?? '')}
                    </span>
                  </span>
                  <Pill tone="bg-slate-100 text-slate-600">Former</Pill>
                </Row>
              ))}
            </ul>
            <p className="mt-3 border-t border-slate-100 pt-3 text-[13px] text-slate-600">
              Our coverage ·{' '}
              {data.coverage
                .map((m) => `${m.name} (${m.coverage_role.replace(/_/g, ' ')}${m.is_primary ? ', primary' : ''})`)
                .join(' · ')}
            </p>
          </Panel>

          <Panel title="Open actions & service issues">
            {openActions.length + data.issues.length === 0 && <Empty>Nothing open.</Empty>}
            <ul>
              {openActions.map((a) => (
                <Row key={a.action_id} onClick={() => a.citation && onCite(a.citation)}>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[14px]">{a.description}</span>
                    <span className="block text-[12px] text-slate-500">
                      Due {readable(a.due_date)} · owner {a.owner}
                    </span>
                  </span>
                  {a.overdue && <Pill tone="bg-rose-50 text-rose-800">{a.days_overdue} days overdue</Pill>}
                </Row>
              ))}
              {data.issues.map((i) => (
                <Row key={i.issue_id} onClick={() => i.citation && onCite(i.citation)}>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[14px]">{i.summary}</span>
                    <span className="block text-[12px] text-slate-500">
                      Service issue · opened {readable(i.opened_date)}
                      {i.resolved_date && ` · resolved ${readable(i.resolved_date)}`}
                    </span>
                  </span>
                  <Pill tone={i.status === 'open' ? 'bg-rose-50 text-rose-800' : 'bg-slate-100 text-slate-600'}>
                    {i.status === 'open' ? `${i.severity} · open` : 'Resolved'}
                  </Pill>
                </Row>
              ))}
            </ul>
          </Panel>

          {data.financials.length > 0 && (
            <Panel title="Company performance" note="Reported by the client">
              <ul>
                {data.financials.map((f) => (
                  <Row key={f.fiscal_period} onClick={() => f.citation && onCite(f.citation)}>
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold">{f.fiscal_period}</span>
                      <span className="block text-[12px] text-slate-500">{f.source}</span>
                    </span>
                    <span className="text-right text-[13px] tabular-nums">
                      <span className="block font-semibold">${f.company_revenue_usd_m.toLocaleString('en-US')}M revenue</span>
                      <span className="block text-slate-600">
                        {f.ebitda_margin_pct}% EBITDA · {f.net_leverage_x}x leverage
                      </span>
                    </span>
                  </Row>
                ))}
              </ul>
            </Panel>
          )}

          <Panel title="Documents" note={`${data.documents.length} you can see`}>
            <ul>
              {(allDocs ? data.documents : data.documents.slice(0, DOCS_SHOWN)).map((d) => (
                <Row key={d.doc_id} onClick={() => d.citation && onCite(d.citation)}>
                  {d.citation && <SourceKindIcon citation={d.citation} className="h-4 w-4" />}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-medium">{d.title}</span>
                    <span className="block text-[12px] text-slate-500">
                      {d.doc_type.replace(/_/g, ' ')} · {readable(d.date)}
                      {d.link_method === 'inferred' ? ' · linked by name' : ''}
                    </span>
                  </span>
                  {d.classification !== 'internal' && (
                    <Pill tone={d.classification === 'restricted' ? 'bg-rose-50 text-rose-800' : 'bg-amber-50 text-amber-800'}>
                      {d.classification}
                    </Pill>
                  )}
                </Row>
              ))}
            </ul>
            {data.documents.length > DOCS_SHOWN && (
              <button
                onClick={() => setAllDocs(!allDocs)}
                className="mt-1 border-t border-slate-100 pt-3 text-[13px] font-medium text-slate-600 hover:text-slate-900"
              >
                {allDocs ? 'Show fewer' : `Show all ${data.documents.length}`}
              </button>
            )}
          </Panel>
        </div>
      </div>
    </div>
  )
}

/** How fresh each source is: when the data was loaded, and the newest record from each source. */
function DataAsOf({ data }: { data: ClientOverview }) {
  const newest = (types: string[]) =>
    data.documents
      .filter((d) => types.includes(d.doc_type))
      .map((d) => d.date)
      .sort()
      .at(-1)
  const sources: [string, string | undefined][] = [
    ['Revenue', data.revenue.as_of_quarter && readable(data.revenue.as_of_quarter)],
    ['CRM activity', data.interactions[0]?.date && readable(data.interactions[0].date)],
    ['Email', newest(['email']) && readable(newest(['email'])!)],
    ['Notes', newest(['call_note', 'meeting_note']) && readable(newest(['call_note', 'meeting_note'])!)],
    ['News', newest(['news']) && readable(newest(['news'])!)],
    ['Financials', data.financials.at(-1)?.fiscal_period],
  ]
  return (
    <p className="flex flex-wrap items-center gap-x-5 gap-y-1">
      <span className="inline-flex items-center gap-1.5 font-medium text-slate-700">
        <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <circle cx="10" cy="10" r="7.5" />
          <path d="M10 6v4l2.5 2" strokeLinecap="round" />
        </svg>
        Data as of
        {data.loaded_at && ` ${readable(data.loaded_at.slice(0, 10))}, ${data.loaded_at.slice(11, 16)}`}
      </span>
      {sources
        .filter(([, v]) => v)
        .map(([label, v]) => (
          <span key={label} title={`Newest ${label.toLowerCase()} record`}>
            <span className="text-slate-500">{label}</span> <span className="font-medium text-slate-800">{v}</span>
          </span>
        ))}
    </p>
  )
}

function Panel({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className={cn(CARD, 'px-5 pb-4 pt-4')}>
      <header className="mb-2 flex items-baseline justify-between gap-2">
        <h2 className="flex items-center gap-1.5 text-[16px] font-semibold">
          {title}
          {INFO[title] && <InfoTip text={INFO[title]} />}
        </h2>
        {note && <span className="text-[12.5px] text-slate-500">{note}</span>}
      </header>
      {children}
    </section>
  )
}

function Row({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <li>
      <button
        onClick={onClick}
        className="-mx-2 flex w-[calc(100%+1rem)] items-center gap-3 rounded-lg border-t border-slate-100 px-2 py-3 text-left transition first:border-0 hover:bg-slate-50"
      >
        {children}
      </button>
    </li>
  )
}

function Pill({ tone, children }: { tone: string; children: ReactNode }) {
  return <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[12px] font-semibold capitalize', tone)}>{children}</span>
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="py-2 text-[14px] text-slate-500">{children}</p>
}

function Stat({
  label,
  value,
  note,
  tone,
  onClick,
}: {
  label: string
  value: string
  note: string
  tone?: 'good' | 'bad' | 'warn'
  onClick?: () => void
}) {
  return (
    <div className="relative">
      <button onClick={onClick} disabled={!onClick} className={cn(CARD, 'w-full rounded-xl p-4 pr-10 text-left transition enabled:hover:border-slate-300')}>
        <span className="block text-[13px] text-slate-600">{label}</span>
        <span className="mt-1.5 block text-[26px] font-bold leading-none tracking-tight tabular-nums">{value}</span>
        <span
          className={cn(
            'mt-2 block text-[13px] font-medium',
            tone === 'bad' ? 'text-rose-700' : tone === 'good' ? 'text-emerald-700' : tone === 'warn' ? 'text-amber-700' : 'text-slate-600',
          )}
        >
          {note}
        </span>
      </button>
      {INFO[label] && (
        <span className="absolute right-3 top-3.5">
          <InfoTip text={INFO[label]} align="right" />
        </span>
      )}
      </div>
  )
}

/** Quarterly relationship revenue as bars; the last four quarters (current TTM) in the accent. */
function QuarterChart({ quarters }: { quarters: { period: string; total: number | null }[] }) {
  const max = Math.max(...quarters.map((q) => q.total ?? 0), 1)
  return (
    <div className="flex h-44 gap-2">
      {quarters.map((q, i) => (
        <div key={q.period} className="flex h-full flex-1 flex-col items-center justify-end gap-1.5">
          <span className="text-[11px] tabular-nums text-slate-500">{q.total == null ? 'n/a' : money(q.total)}</span>
          <div className="flex w-full flex-1 items-end">
            <div
              className={cn(
                'w-full rounded-t-md',
                q.total == null ? 'h-1 bg-amber-200' : i >= quarters.length - 4 ? 'bg-indigo-500' : 'bg-slate-300',
              )}
              style={q.total == null ? undefined : { height: `${Math.max(4, (q.total / max) * 100)}%` }}
            />
          </div>
          <span className="text-[11px] text-slate-600">{q.period.replace(/(\d{4})Q(\d)/, 'Q$2 ’$1').replace(/’20/, "'")}</span>
        </div>
      ))}
    </div>
  )
}

function LockIcon() {
  return (
    <svg viewBox="0 0 20 20" className="h-3.5 w-3.5 shrink-0" fill="currentColor" aria-hidden="true">
      <path
        fillRule="evenodd"
        d="M10 1a4.5 4.5 0 0 0-4.5 4.5V9H5a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2h-.5V5.5A4.5 4.5 0 0 0 10 1Zm3 8V5.5a3 3 0 1 0-6 0V9h6Z"
      />
    </svg>
  )
}
