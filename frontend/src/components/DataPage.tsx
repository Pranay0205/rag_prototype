// UI-15 data page: what sits underneath the banker's screens. The data model (tables, keys, links),
// what unification did to the raw records, and the quality checks run at every load (API-19).
import { useEffect, useState, type ReactNode } from 'react'
import { ApiError, api, type DataOverview } from '../api'
import { CARD, Spinner, cn, readable } from './ui'

const GROUPS: { name: string; note: string }[] = [
  { name: 'Clients', note: 'Who the client is and who covers them' },
  { name: 'Money', note: 'Revenue, products and the client’s own results' },
  { name: 'Activity', note: 'Pipeline, promises, issues and contact history' },
  { name: 'Documents', note: 'Unstructured text, linked and indexed for search' },
]

export function DataPage({ userId }: { userId: string }) {
  const [data, setData] = useState<DataOverview | null>(null)
  const [error, setError] = useState<string | null>(null)

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
  const gaps = data.quality_checks.filter((c) => c.severity === 'warning' && !c.passed)
  const docs = data.documents
  const firmWide = docs.unlinked.length - data.quality_checks.find((c) => c.id === 'Q11')!.failures

  return (
    <div className="mx-auto flex max-w-[1240px] flex-col gap-6 px-6 pb-28 pt-8">
      <header>
        <h1 className="text-[30px] font-bold leading-tight tracking-tight">Data</h1>
        <p className="mt-1.5 max-w-2xl text-[15px] text-slate-600">
          How client data is loaded, unified and checked before anything reaches a briefing. No model is involved in any
          of this.
        </p>
        <p className="mt-2 text-[13px] text-slate-500">
          Loaded {readable(data.built_at.slice(0, 10))}, {data.built_at.slice(11, 16)} · today in the data is{' '}
          {readable(data.today)}
        </p>
      </header>

      <section aria-label="At a glance" className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat label="Structured tables" value={String(structured.length)} note="Joined on client_id" />
        <Stat label="Clients" value={String(data.tables.find((t) => t.name === 'clients')?.rows ?? 0)} note={`${data.merges.length} duplicate${data.merges.length === 1 ? '' : 's'} merged`} />
        <Stat
          label="Quality checks"
          value={`${errors.filter((c) => c.passed).length} of ${errors.length}`}
          note={gaps.length ? `passed · ${gaps.length} gap reported` : 'passed'}
          tone={errors.every((c) => c.passed) ? 'good' : 'bad'}
        />
      </section>

      {/* data model */}
      <Panel
        title="Data model"
        note="Every table joins to clients on client_id. After a merge, source_client_id keeps each row's original record."
      >
        <div className="mb-4 flex flex-wrap gap-x-5 gap-y-1.5 text-[12.5px] text-slate-600">
          <Legend tone="key">Primary key</Legend>
          <Legend tone="link">Links to another table</Legend>
          <Legend tone="lineage">Original record (lineage)</Legend>
        </div>
        <div className="space-y-6">
          {GROUPS.map((g) => (
            <div key={g.name}>
              <h3 className="text-[14px] font-semibold">
                {g.name} <span className="font-normal text-slate-500">· {g.note}</span>
              </h3>
              <div className="mt-2.5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {data.tables
                  .filter((t) => t.group === g.name)
                  .map((t) => (
                    <article key={t.name} className="rounded-xl border border-slate-200 bg-slate-50/50 p-3.5">
                      <header className="flex items-baseline justify-between gap-2">
                        <span className="font-mono text-[13.5px] font-semibold text-slate-900">{t.name}</span>
                        <span className="text-[12px] tabular-nums text-slate-500">
                          {t.rows === null ? 'access per row' : `${t.rows} ${t.rows === 1 ? 'row' : 'rows'}`}
                        </span>
                      </header>
                      <p className="mt-0.5 text-[12.5px] leading-snug text-slate-600">{t.description}</p>
                      <div className="mt-2.5 flex flex-wrap gap-1">
                        {t.columns.map((c) => (
                          <Column key={c.name} role={c.role} references={c.references}>
                            {c.name}
                          </Column>
                        ))}
                      </div>
                    </article>
                  ))}
              </div>
            </div>
          ))}
        </div>
      </Panel>

      {/* unification */}
      <Panel title="What unification did" note="Run at every load, in this order">
        <ol className="divide-y divide-slate-100">
          {data.merges.map((m) => (
            <Step key={m.merged_id} n={1} title="Duplicate client merged" tone="indigo">
              <Mono>{m.merged_id}</Mono> "{m.evidence.merged_legal_name}" merged into <Mono>{m.survivor_id}</Mono>: same LEI{' '}
              <Mono>{m.evidence.lei}</Mono>; the older record (since {readable(m.evidence.survivor_created)}) is kept. All
              of its rows moved across with their original ID kept.
              {data.contacts_deduplicated.length > 0 && (
                <>
                  {' '}
                  A contact recorded under both was kept once (<Mono>{data.contacts_deduplicated.join(', ')}</Mono> removed).
                </>
              )}
            </Step>
          ))}
          <Step n={2} title="Names matched to clients" tone="indigo">
            {data.aliases} aliases map other names to a client ("NWL" is Northwind). Fuzzy matching rejects a look-alike
            with a different distinguishing word ("Cascade Health Systems" is not "Cascade Health Partners").
          </Step>
          <Step n={3} title="Documents linked" tone="indigo">
            {docs.by_link_method.source_id ?? 0} by client ID ·{' '}
            {docs.inferred_links.map((l) => (
              <span key={l.doc_id}>
                <Mono>{l.doc_id}</Mono> by name ({Math.round(l.confidence * 100)}% confidence, labelled in the app) ·{' '}
              </span>
            ))}
            {firmWide} firm-wide research and product updates linked to no client on purpose
          </Step>
          <Step n={4} title="Duplicates removed" tone="amber">
            {docs.duplicates.map((d) => (
              <span key={d.doc_id}>
                <Mono>{d.doc_id}</Mono> is a forwarded copy of <Mono>{d.duplicate_of}</Mono>, so it is not indexed.{' '}
              </span>
            ))}
          </Step>
          <Step n={5} title="Older and secondary sources marked" tone="amber">
            {docs.derived.length} prior briefings marked as secondary (system records win when they disagree);{' '}
            {docs.stale.length} document older than 180 days marked stale.
          </Step>
          <Step n={6} title="Held back" tone="rose">
            Unapproved news stored but never indexed: <Mono>{docs.quarantined_news.join(', ')}</Mono>. Suspected prompt
            injection fenced as data, and claims citing it are never verified:{' '}
            <Mono>{docs.suspected_injection.join(', ')}</Mono>.
          </Step>
          <Step n={7} title="Indexed for search" tone="indigo">
            {data.index?.chunks_indexed ?? 0} passages indexed twice: by keyword (BM25) and by meaning (
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

function Stat({ label, value, note, tone }: { label: string; value: string; note: string; tone?: 'good' | 'bad' }) {
  return (
    <div className={cn(CARD, 'rounded-xl p-4')}>
      <span className="block text-[13px] text-slate-600">{label}</span>
      <span className="mt-1.5 block text-[26px] font-bold leading-none tracking-tight tabular-nums">{value}</span>
      <span className={cn('mt-2 block text-[13px] font-medium', tone === 'good' ? 'text-emerald-700' : tone === 'bad' ? 'text-rose-700' : 'text-slate-600')}>
        {note}
      </span>
    </div>
  )
}
