// UI-15 data page: what sits underneath the banker's screens. The data model (tables, keys, links),
// what unification did to the raw records, and the quality checks run at every load (API-19).
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { ApiError, api, type DataOverview } from '../api'
import { CARD, Spinner, cn, readable } from './ui'

export function DataPage({ userId }: { userId: string }) {
  const [data, setData] = useState<DataOverview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [showAll, setShowAll] = useState(false)

  useEffect(() => {
    api.dataOverview(userId).then(setData, (e: ApiError) => setError(e.message))
  }, [userId])

  if (error) return <p className="mx-auto mt-10 max-w-3xl rounded-xl bg-rose-50 p-4 text-sm text-rose-700">{error}</p>
  if (!data) {
    return (
      <div className="grid h-64 place-items-center">
        <Spinner className="h-5 w-5 text-slate-400" />
      </div>
    )
  }

  const structured = data.tables.filter((t) => t.group !== 'Documents' && t.name !== 'client_merge')
  const errors = data.quality_checks.filter((c) => c.severity === 'error')
  const gaps = data.quality_checks.filter((c) => c.severity !== 'info' && !c.passed)
  const docs = data.documents
  const firmWide = docs.unlinked.length - data.quality_checks.find((c) => c.id === 'Q11')!.failures
  const table = data.tables.find((t) => t.name === selected)

  return (
    <div className="mx-auto flex max-w-[1240px] flex-col gap-6 px-6 pb-28 pt-8">
      <header>
        <h1 className="text-[30px] font-bold leading-tight tracking-tight">Data</h1>
        <p className="mt-1.5 text-[15px] text-slate-600">
          {structured.length} tables · {data.tables.find((t) => t.name === 'clients')?.rows ?? 0} clients,{' '}
          {data.merges.length} duplicate merged ·{' '}
          <span className={errors.every((c) => c.passed) ? 'font-medium text-emerald-700' : 'font-medium text-rose-700'}>
            {errors.filter((c) => c.passed).length} of {errors.length} checks passed
          </span>{' '}
          · loaded {readable(data.built_at.slice(0, 10))}, {data.built_at.slice(11, 16)}. No AI involved.
        </p>
      </header>

      <Panel title="Data model" note="Every table joins to clients. Click a table to see its columns.">
        <ModelDiagram tables={data.tables} selected={selected} onSelect={setSelected} />
        {table && (
          <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50/60 p-4">
            <p className="flex flex-wrap items-baseline gap-x-2">
              <span className="font-mono text-[14px] font-semibold">{table.name}</span>
              <span className="text-[13px] text-slate-600">{table.description}</span>
              <span className="text-[12px] text-slate-500">
                · {table.rows === null ? 'access per row' : `${table.rows} ${table.rows === 1 ? 'row' : 'rows'}`}
              </span>
            </p>
            <div className="mt-2.5 flex flex-wrap gap-1">
              {table.columns.map((c) => (
                <Column key={c.name} role={c.role} references={c.references}>
                  {c.name}
                </Column>
              ))}
            </div>
            <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[12px] text-slate-600">
              <Legend tone="key">Primary key</Legend>
              <Legend tone="link">Links to another table</Legend>
              <Legend tone="lineage">Original record, kept after a merge</Legend>
            </div>
          </div>
        )}
      </Panel>

      <Panel title="Needs attention" note="All other checks are correct.">
        <ul className="divide-y divide-slate-100">
          {data.merges.map((m) => (
            <Step key={m.merged_id} n={1} title="Duplicate client merged" tone="indigo">
              <Mono>{m.merged_id}</Mono> "{m.evidence.merged_legal_name}" and <Mono>{m.survivor_id}</Mono> have the same
              LEI. The system merged them into <Mono>{m.survivor_id}</Mono>. Each row keeps its original ID.
            </Step>
          ))}
          {gaps.map((c, i) => (
            <Step key={c.id} n={data.merges.length + i + 1} title={c.id === 'Q10' ? 'Missing data' : c.check} tone={c.severity === 'error' ? 'rose' : 'amber'}>
              {c.id === 'Q10'
                ? `${c.examples.map((e) => String(e.client_id)).join(', ')} has no revenue data for one quarter. The app shows this gap. It does not estimate a 12-month total.`
                : `${c.failures} rows are not correct.`}
            </Step>
          ))}
        </ul>
      </Panel>

      <button
        onClick={() => setShowAll(!showAll)}
        aria-expanded={showAll}
        className="self-center rounded-full border border-slate-300 bg-white px-4 py-2 text-[13.5px] font-medium text-slate-700 transition hover:bg-slate-100"
      >
        {showAll ? 'Hide details' : 'Show every unification step and check'}
      </button>

      {showAll && (
        <>
      {/* unification */}
      <Panel title="What unification did" note="The system does these steps in this sequence each time it loads the data.">
        <ol className="divide-y divide-slate-100">
          {data.merges.map((m) => (
            <Step key={m.merged_id} n={1} title="Duplicate client merged" tone="indigo">
              <Mono>{m.merged_id}</Mono> "{m.evidence.merged_legal_name}" and <Mono>{m.survivor_id}</Mono> have the same
              LEI (<Mono>{m.evidence.lei}</Mono>). The system merged them and kept the older record, from{' '}
              {readable(m.evidence.survivor_created)}. All rows moved to <Mono>{m.survivor_id}</Mono>. Each row keeps its
              original ID.
              {data.contacts_deduplicated.length > 0 && (
                <>
                  {' '}
                  One contact was in both records. The system kept one copy and removed{' '}
                  <Mono>{data.contacts_deduplicated.join(', ')}</Mono>.
                </>
              )}
            </Step>
          ))}
          <Step n={2} title="Names matched to clients" tone="indigo">
            {data.aliases} aliases connect other names to a client. For example, "NWL" is Northwind. Fuzzy matching does
            not accept a name with a different key word. For example, "Cascade Health Systems" is not "Cascade Health
            Partners".
          </Step>
          <Step n={3} title="Documents linked" tone="indigo">
            The system linked {docs.by_link_method.source_id ?? 0} documents by client ID.{' '}
            {docs.inferred_links.map((l) => (
              <span key={l.doc_id}>
                It linked <Mono>{l.doc_id}</Mono> by name, with {Math.round(l.confidence * 100)}% confidence. The app shows
                this as a label.{' '}
              </span>
            ))}
            {firmWide} research and product documents apply to all clients. The system does not link them to one client.
          </Step>
          <Step n={4} title="Duplicates removed" tone="amber">
            {docs.duplicates.map((d) => (
              <span key={d.doc_id}>
                <Mono>{d.doc_id}</Mono> is a forwarded copy of <Mono>{d.duplicate_of}</Mono>. The system does not index the
                copy.{' '}
              </span>
            ))}
          </Step>
          <Step n={5} title="Old and secondary sources identified" tone="amber">
            {docs.derived.length} prior briefings are secondary sources. If they do not agree with the system records,
            the system records are correct. {docs.stale.length} document is older than 180 days. The system marks it as
            stale.
          </Step>
          <Step n={6} title="Sources not used" tone="rose">
            The news item <Mono>{docs.quarantined_news.join(', ')}</Mono> is not approved. The system keeps it but does
            not index it. The email <Mono>{docs.suspected_injection.join(', ')}</Mono> possibly contains a prompt
            injection. The system uses its text only as data. A claim that uses this email is never verified.
          </Step>
          <Step n={7} title="Indexed for search" tone="indigo">
            The system indexed {data.index?.chunks_indexed ?? 0} passages in two ways: by keyword (BM25) and by meaning (
            {data.index?.embedding_model ?? 'embeddings'}).
          </Step>
        </ol>
      </Panel>

      {/* quality checks */}
      <Panel title="Quality checks" note="Each check is a query that returns the rows breaking it">
        <ul className="divide-y divide-slate-100">
          {data.quality_checks.map((c) => (
            <Check key={c.id} check={c} />
          ))}
        </ul>
      </Panel>
        </>
      )}
    </div>
  )
}

function Check({ check: c }: { check: DataOverview['quality_checks'][number] }) {
  const [open, setOpen] = useState(false)
  const state = c.passed ? 'pass' : c.severity
  const STATE = {
    pass: { icon: '✓', tone: 'bg-emerald-50 text-emerald-700', label: 'Passed' },
    error: { icon: '!', tone: 'bg-rose-50 text-rose-700', label: `${c.failures} failing` },
    warning: { icon: '!', tone: 'bg-amber-50 text-amber-800', label: `${c.failures} gap${c.failures === 1 ? '' : 's'} reported` },
    info: { icon: 'i', tone: 'bg-slate-100 text-slate-700', label: `${c.failures} held out` },
  }[state]
  const cols = Object.keys(c.examples[0] ?? {})
  return (
    <li className="py-1">
      <button onClick={() => setOpen(!open)} aria-expanded={open} className="flex w-full items-center gap-3 rounded-lg px-1 py-2.5 text-left transition hover:bg-slate-50">
        <span className={cn('grid h-6 w-6 shrink-0 place-items-center rounded-full text-[12px] font-bold', STATE.tone)}>{STATE.icon}</span>
        <span className="min-w-0 flex-1 text-[14px] text-slate-900">{c.check}</span>
        <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[12px] font-semibold', STATE.tone)}>{STATE.label}</span>
        <span className="w-12 shrink-0 text-right text-[12.5px] font-medium text-slate-500">{open ? 'Hide' : 'SQL'}</span>
      </button>
      {open && (
        <div className="mb-3 ml-10 space-y-2.5">
          <pre className="whitespace-pre-wrap break-words rounded-xl bg-slate-950 px-4 py-3 font-mono text-[12.5px] leading-relaxed text-slate-200">
            {c.sql}
          </pre>
          {c.examples.length > 0 && (
            <div className="overflow-auto rounded-xl ring-1 ring-slate-200">
              <table className="w-full text-[13px]">
                <thead className="bg-slate-50 text-left text-[12px] text-slate-500">
                  <tr>
                    {cols.map((k) => (
                      <th key={k} className="px-3 py-1.5 font-medium">
                        {k}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {c.examples.map((r, i) => (
                    <tr key={i} className="border-t border-slate-100">
                      {cols.map((k) => (
                        <td key={k} className="px-3 py-1.5 font-mono text-[12.5px] text-slate-800">
                          {String(r[k])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {c.id === 'Q10' && !c.passed && (
            <p className="text-[12.5px] text-slate-600">The app reports this quarter as missing and gives no 12-month total, rather than estimating one.</p>
          )}
          {c.id === 'Q11' && (
            <p className="text-[12.5px] text-slate-600">News about a look-alike company, correctly kept out of every client's briefing.</p>
          )}
        </div>
      )}
    </li>
  )
}

const COLUMN_TONE = {
  key: 'bg-slate-900 text-white',
  link: 'bg-indigo-50 text-indigo-800 ring-1 ring-inset ring-indigo-200',
  lineage: 'bg-violet-50 text-violet-800 ring-1 ring-inset ring-violet-200',
  none: 'bg-white text-slate-600 ring-1 ring-inset ring-slate-200',
}

function Column({ role, references, children }: { role: DataOverview['tables'][number]['columns'][number]['role']; references: string | null; children: ReactNode }) {
  return (
    <span
      className={cn('rounded px-1.5 py-0.5 font-mono text-[11.5px]', COLUMN_TONE[role ?? 'none'])}
      title={role === 'link' ? `Links to ${references}` : role === 'lineage' ? 'The client record this row came from, before merging' : undefined}
    >
      {children}
      {role === 'link' && <span className="opacity-60"> → {references}</span>}
    </span>
  )
}

function Legend({ tone, children }: { tone: keyof typeof COLUMN_TONE; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn('h-3 w-5 rounded', COLUMN_TONE[tone])} />
      {children}
    </span>
  )
}

function Step({ n, title, tone, children }: { n: number; title: string; tone: 'indigo' | 'amber' | 'rose'; children: ReactNode }) {
  const dot = { indigo: 'bg-indigo-50 text-indigo-700', amber: 'bg-amber-50 text-amber-800', rose: 'bg-rose-50 text-rose-700' }[tone]
  return (
    <li className="flex gap-3.5 py-3">
      <span className={cn('grid h-6 w-6 shrink-0 place-items-center rounded-full text-[12px] font-bold', dot)}>{n}</span>
      <span className="min-w-0 text-[14px] leading-relaxed text-slate-700">
        <span className="font-semibold text-slate-900">{title}.</span> {children}
      </span>
    </li>
  )
}

function Mono({ children }: { children: ReactNode }) {
  return <span className="rounded bg-slate-100 px-1 font-mono text-[12.5px] text-slate-800">{children}</span>
}

function Panel({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className={cn(CARD, 'px-6 pb-5 pt-5')}>
      <header className="mb-4">
        <h2 className="text-[17px] font-semibold">{title}</h2>
        {note && <p className="mt-0.5 text-[13px] text-slate-600">{note}</p>}
      </header>
      {children}
    </section>
  )
}

// Tables around the clients hub, ordered so related tables sit side by side.
const RING = [
  'client_aliases', 'client_merge', 'contacts', 'coverage', 'users', 'revenue', 'holdings', 'financials',
  'opportunities', 'open_actions', 'service_issues', 'interactions', 'meetings', 'documents', 'chunks',
]
// What each table hangs off when it is not clients itself (by its link columns)
const PARENT: Record<string, string> = { users: 'coverage', chunks: 'documents' }
const GROUP_DOT: Record<string, string> = {
  Clients: 'bg-slate-500',
  Money: 'bg-emerald-500',
  Activity: 'bg-amber-500',
  Documents: 'bg-sky-500',
}

/** UI-15: the data model as a hub. Clients in the middle, every table linked to it (or to its parent). */
function ModelDiagram({
  tables,
  selected,
  onSelect,
}: {
  tables: DataOverview['tables']
  selected: string | null
  onSelect: (name: string | null) => void
}) {
  const ring = RING.map((name) => tables.find((t) => t.name === name)).filter((t): t is DataOverview['tables'][number] => !!t)
  const at = (i: number) => {
    const a = (i / ring.length) * 2 * Math.PI - Math.PI / 2
    return { x: 50 + 41 * Math.cos(a), y: 50 + 40 * Math.sin(a) }
  }
  const index = new Map(ring.map((t, i) => [t.name, i]))
  const node = (name: string, group: string, style: CSSProperties, hub = false) => (
    <button
      key={name}
      onClick={() => onSelect(selected === name ? null : name)}
      aria-pressed={selected === name}
      style={style}
      className={cn(
        'absolute flex -translate-x-1/2 -translate-y-1/2 items-center gap-1.5 whitespace-nowrap rounded-lg border px-2.5 py-1.5 font-mono text-[12px] transition',
        hub
          ? 'border-slate-900 bg-slate-900 px-4 py-2.5 text-[14px] font-semibold text-white'
          : 'border-slate-200 bg-white text-slate-800 hover:border-slate-400',
        selected === name && !hub && 'border-slate-900 ring-2 ring-slate-900/10',
      )}
    >
      {!hub && <span className={cn('h-2 w-2 rounded-full', GROUP_DOT[group])} />}
      {name}
    </button>
  )
  return (
    <div>
      <div className="relative mx-auto hidden aspect-[2/1] w-full max-w-[980px] sm:block">
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full" aria-hidden="true">
          {ring.map((t, i) => {
            const p = at(i)
            const parent = PARENT[t.name]
            const q = parent !== undefined && index.has(parent) ? at(index.get(parent)!) : { x: 50, y: 50 }
            return (
              <line
                key={t.name}
                x1={p.x}
                y1={p.y}
                x2={q.x}
                y2={q.y}
                stroke="currentColor"
                strokeWidth="1"
                vectorEffect="non-scaling-stroke"
                className={selected === t.name ? 'text-slate-900' : 'text-slate-300'}
              />
            )
          })}
        </svg>
        {node('clients', 'Clients', { left: '50%', top: '50%' }, true)}
        {ring.map((t, i) => node(t.name, t.group, { left: `${at(i).x}%`, top: `${at(i).y}%` }))}
      </div>
      {/* narrow screens: the same tables as a list */}
      <div className="flex flex-wrap gap-1.5 sm:hidden">
        {[tables.find((t) => t.name === 'clients')!, ...ring].map((t) => (
          <button
            key={t.name}
            onClick={() => onSelect(selected === t.name ? null : t.name)}
            className="rounded-lg border border-slate-200 bg-white px-2 py-1 font-mono text-[12px]"
          >
            {t.name}
          </button>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap justify-center gap-x-5 gap-y-1 text-[12px] text-slate-600">
        {Object.entries(GROUP_DOT).map(([g, dot]) => (
          <span key={g} className="inline-flex items-center gap-1.5">
            <span className={cn('h-2 w-2 rounded-full', dot)} />
            {g}
          </span>
        ))}
      </div>
    </div>
  )
}
