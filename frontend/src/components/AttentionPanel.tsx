// UI-5: what the banker must not miss. Kept short: conflicts, gaps, actions.
import { useState, type ReactNode } from 'react'
import type { Briefing, Citation, SuggestedAction } from '../types'
import { Spinner, cn } from './ui'

export type ActionState = 'created' | 'dismissed'

interface Props {
  briefing: Briefing | null
  running: boolean
  actionStates: Record<string, ActionState>
  onAction: (action: SuggestedAction, state: ActionState) => void
  onCite: (citation: Citation) => void
}

export function AttentionPanel({ briefing, running, actionStates, onAction, onCite }: Props) {
  const [allUnknowns, setAllUnknowns] = useState(false)
  const actions = briefing?.suggested_actions.filter((a) => actionStates[a.id] !== 'dismissed') ?? []
  const unknowns = briefing ? (allUnknowns ? briefing.unknowns : briefing.unknowns.slice(0, 3)) : []

  return (
    <aside className="w-[340px] shrink-0 overflow-y-auto border-l border-slate-200/70 bg-white/60 px-5 py-7 backdrop-blur">
      <h2 className="text-[15px] font-semibold tracking-tight text-slate-900">Attention</h2>

      {!briefing && running && (
        <div className="mt-4 flex items-center gap-2 text-sm text-slate-400">
          <Spinner /> Checking sources
        </div>
      )}

      {briefing && (
        <div className="mt-5 space-y-7">
          {briefing.access_limited && (
            <p className="flex items-center gap-2 text-xs text-slate-500">
              <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="currentColor" aria-hidden="true">
                <path
                  fillRule="evenodd"
                  d="M10 1a4.5 4.5 0 0 0-4.5 4.5V9H5a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2h-.5V5.5A4.5 4.5 0 0 0 10 1Zm3 8V5.5a3 3 0 1 0-6 0V9h6Z"
                />
              </svg>
              Some sources are restricted for your profile
            </p>
          )}

          <Group title="Conflicts" count={briefing.conflicts.length}>
            {briefing.conflicts.map((c) => (
              <div key={c.topic} className="rounded-xl bg-rose-50/70 p-3.5 ring-1 ring-rose-100">
                <div className="text-sm font-medium text-slate-900">{c.topic}</div>
                <div className="mt-2 space-y-1.5">
                  {c.values.map((v, i) => (
                    <button
                      key={`${v.citation.source_id}-${i}`}
                      onClick={() => onCite(v.citation)}
                      className="flex w-full gap-2 text-left text-[13px] leading-snug text-slate-600 hover:text-slate-900"
                    >
                      <span
                        className={cn(
                          'mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full',
                          v.citation.kind === 'sql' ? 'bg-emerald-500' : 'bg-rose-400',
                        )}
                      />
                      <span>{v.value}</span>
                    </button>
                  ))}
                </div>
                <p className="mt-2.5 text-xs leading-snug text-slate-500">{c.resolution}</p>
              </div>
            ))}
          </Group>

          <Group title="Gaps" count={briefing.unknowns.length}>
            {unknowns.map((u) => (
              <p key={u.question} className="text-[13px] leading-snug text-slate-600" title={u.reason}>
                {u.question}
              </p>
            ))}
            {briefing.unknowns.length > 3 && (
              <button
                onClick={() => setAllUnknowns((v) => !v)}
                className="text-xs font-medium text-indigo-600 hover:text-indigo-700"
              >
                {allUnknowns ? 'Show less' : `Show ${briefing.unknowns.length - 3} more`}
              </button>
            )}
          </Group>

          <Group title="Actions" count={actions.length}>
            {actions.map((a) => {
              const created = actionStates[a.id] === 'created'
              return (
                <div key={a.id} className="group flex items-start gap-2.5">
                  <button
                    onClick={() => !created && onAction(a, 'created')}
                    title={created ? 'Created' : 'Create follow-up'}
                    className={cn(
                      'mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full ring-1 transition',
                      created
                        ? 'bg-emerald-500 text-white ring-emerald-500'
                        : 'text-transparent ring-slate-300 hover:text-indigo-500 hover:ring-indigo-400',
                    )}
                  >
                    <svg viewBox="0 0 20 20" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <path d="M5 10.5 8.5 14 15 6" />
                    </svg>
                  </button>
                  <p className={cn('flex-1 text-[13px] leading-snug', created ? 'text-slate-400' : 'text-slate-700')}>
                    {a.description}
                  </p>
                  {!created && (
                    <button
                      onClick={() => onAction(a, 'dismissed')}
                      title="Dismiss"
                      className="text-slate-300 opacity-0 transition hover:text-slate-500 group-hover:opacity-100"
                    >
                      <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M6 6l8 8M14 6l-8 8" />
                      </svg>
                    </button>
                  )}
                </div>
              )
            })}
          </Group>
        </div>
      )}
    </aside>
  )
}

function Group({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  if (count === 0) return null
  return (
    <section>
      <h3 className="mb-3 flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.12em] text-slate-400">
        {title}
        <span className="tabular-nums text-slate-300">{count}</span>
      </h3>
      <div className="space-y-3">{children}</div>
    </section>
  )
}
