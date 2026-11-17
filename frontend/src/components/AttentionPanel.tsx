// UI-5: what the banker must not miss, as cards beside the briefing: actions on the left (what to
// do before the meeting), conflicts and gaps on the right (what not to rely on).
import { useState, type ReactNode } from 'react'
import type { Briefing, Citation, Conflict, ConflictValue, SuggestedAction } from '../types'
import { SourceKindIcon } from './SectionCard'
import { CARD, CardHeader, GLYPH, Spinner, cn, readable } from './ui'

export type ActionState = 'created' | 'dismissed'

interface Props {
  briefing: Briefing | null
  running: boolean
  actionStates: Record<string, ActionState>
  onAction: (action: SuggestedAction, state: ActionState) => void
  onCite: (citation: Citation) => void
  side: 'left' | 'right'
}

export function AttentionPanel({ briefing, running, actionStates, onAction, onCite, side }: Props) {
  const [allUnknowns, setAllUnknowns] = useState(false)
  const actions = (briefing?.suggested_actions.filter((a) => actionStates[a.id] !== 'dismissed') ?? []).sort(
    (a, b) => urgency(a) - urgency(b),
  )
  const unknowns = briefing ? (allUnknowns ? briefing.unknowns : briefing.unknowns.slice(0, 3)) : []

  if (!briefing) {
    if (!running) return null
    return (
      <div className={cn(CARD, 'flex items-center gap-2 px-5 py-4 text-sm text-slate-400')}>
        <Spinner /> Checking sources
      </div>
    )
  }

  if (side === 'left') {
    // What to do before the meeting: overdue commitments, then checks, then follow-ups
    return (
      <section className={CARD}>
        <div className="px-5 pb-3 pt-5">
          <CardHeader icon={GLYPH.actions} title="Before the meeting" count={actions.length} />
        </div>
        {briefing.access_limited && (
          <p className="mx-5 mb-2 flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
            <svg viewBox="0 0 20 20" className="h-3.5 w-3.5 shrink-0" fill="currentColor" aria-hidden="true">
              <path
                fillRule="evenodd"
                d="M10 1a4.5 4.5 0 0 0-4.5 4.5V9H5a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2h-.5V5.5A4.5 4.5 0 0 0 10 1Zm3 8V5.5a3 3 0 1 0-6 0V9h6Z"
              />
            </svg>
            Some sources are restricted for your profile
          </p>
        )}
        {actions.length === 0 && <p className="px-5 pb-5 text-sm text-slate-400">Nothing outstanding.</p>}
        <ul className="divide-y divide-slate-100">
          {actions.map((a) => (
            <ActionRow key={a.id} action={a} created={actionStates[a.id] === 'created'} onAction={onAction} />
          ))}
        </ul>
      </section>
    )
  }

  return (
    <div className="space-y-5">
      {briefing.conflicts.length > 0 && (
        <section className={CARD}>
          <div className="px-5 pb-1 pt-5">
            <CardHeader icon={GLYPH.conflicts} tone="amber" title="Conflicts" count={briefing.conflicts.length} />
          </div>
          {/* sources that disagree need action, so they come before plain updates */}
          <ul className="divide-y divide-slate-100">
            {[...briefing.conflicts]
              .sort((a, b) => Number(isUpdate(a)) - Number(isUpdate(b)))
              .map((c) => (
                <li key={c.topic}>
                  <ConflictRow conflict={c} onCite={onCite} />
                </li>
              ))}
          </ul>
        </section>
      )}

      {briefing.unknowns.length > 0 && (
        <section className={CARD}>
          <div className="px-5 pb-2 pt-5">
            <CardHeader icon={GLYPH.gaps} tone="slate" title="Gaps" count={briefing.unknowns.length} />
          </div>
          <ul className="divide-y divide-slate-100">
            {unknowns.map((u) => (
              <li key={u.question} className="px-5 py-3 text-[13px] leading-snug text-slate-600" title={u.reason}>
                {readable(u.question)}
              </li>
            ))}
          </ul>
          {briefing.unknowns.length > 3 && (
            <button
              onClick={() => setAllUnknowns((v) => !v)}
              className="w-full border-t border-slate-100 px-5 py-3 text-left text-xs font-medium text-indigo-600 hover:bg-slate-50"
            >
              {allUnknowns ? 'Show less' : `Show ${briefing.unknowns.length - 3} more`}
            </button>
          )}
        </section>
      )}
    </div>
  )
}

function ActionRow({
  action: a,
  created,
  onAction,
}: {
  action: SuggestedAction
  created: boolean
  onAction: (action: SuggestedAction, state: ActionState) => void
}) {
  const overdue = /^Overdue by (\d+) days?: (.*)$/s.exec(a.description)
  const text = overdue ? overdue[2] : a.description
  return (
    <li className="group flex items-start gap-3 px-5 py-3.5">
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
      <div className={cn('flex-1 text-[13px] leading-snug', created ? 'text-slate-400 line-through' : 'text-slate-700')}>
        {overdue && !created && (
          <span className="mb-1 inline-flex items-center gap-1 rounded-md bg-rose-50 px-1.5 py-0.5 text-[11px] font-semibold text-rose-700 ring-1 ring-inset ring-rose-200">
            <Icon className="h-3 w-3">
              <path d="M10 5.5V10l3 2M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0Z" />
            </Icon>
            {overdue[1]} days overdue
          </span>
        )}
        <p>
          {!overdue && (
            <span className={cn('mr-1.5 inline-flex align-[-2px]', created ? 'text-slate-300' : ACTION_KINDS[a.kind]?.tone)}>
              <Icon className="h-3.5 w-3.5">{ACTION_KINDS[a.kind]?.icon ?? ACTION_KINDS.follow_up.icon}</Icon>
            </span>
          )}
          {readable(text)}
        </p>
      </div>
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
    </li>
  )
}

/** Overdue commitments first (most days overdue on top), then checks with record owners, then the rest. */
function urgency(a: SuggestedAction): number {
  const days = /^Overdue by (\d+) day/.exec(a.description)
  if (days) return -Number(days[1])
  return { verify_with_owner: 1, flag_stale: 2 }[a.kind] ?? 3
}

/** A conflict where one side is a prior briefing: the team's old belief, then what is true now. */
function isUpdate(c: Conflict): boolean {
  return c.values.some((v) => v.status === 'outdated')
}

/** UI-5: "Changed since last briefing" (was -> now) or "Sources disagree" (side by side). The
 * outdated side stays visible on purpose: the team may still be acting on it. */
function ConflictRow({ conflict: c, onCite }: { conflict: Conflict; onCite: (c: Citation) => void }) {
  const update = isUpdate(c)
  const was = c.values.filter((v) => v.status === 'outdated')
  const now = c.values.filter((v) => v.status !== 'outdated')
  return (
    <div className="px-5 py-4">
      <div className="flex items-start justify-between gap-2">
        <span className="text-[13.5px] font-semibold leading-snug text-slate-800">{readable(c.topic)}</span>
        <span
          className={cn(
            'shrink-0 rounded-md px-1.5 py-0.5 text-[10.5px] font-semibold ring-1 ring-inset',
            update ? 'bg-indigo-50 text-indigo-700 ring-indigo-200' : 'bg-amber-50 text-amber-700 ring-amber-200',
          )}
        >
          {update ? 'Changed' : 'Sources disagree'}
        </span>
      </div>

      {update ? (
        <div className="pt-2">
          {was.map((v, i) => (
            <ValueRow key={`was-${i}`} value={v} label="Last briefing said" muted onCite={onCite} />
          ))}
          <div className="my-1 flex items-center gap-2 pl-[3px] text-slate-300" aria-hidden="true">
            <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M10 4v12m-4-4 4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          {now.map((v, i) => (
            <ValueRow key={`now-${i}`} value={v} label={labelFor(v, 'Now')} onCite={onCite} />
          ))}
        </div>
      ) : (
        <div className="space-y-2 pt-2">
          {c.values.map((v, i) => (
            <div key={i}>
              {i > 0 && (
                <div className="mb-2 flex items-center gap-2 text-[10.5px] font-semibold uppercase tracking-wider text-slate-300">
                  <span className="h-px flex-1 bg-slate-100" /> vs <span className="h-px flex-1 bg-slate-100" />
                </div>
              )}
              <ValueRow value={v} label={labelFor(v, v.citation.title)} onCite={onCite} />
            </div>
          ))}
        </div>
      )}

      <p className={cn('mt-2.5 flex gap-1.5 text-xs leading-snug', update ? 'text-slate-500' : 'text-amber-800')}>
        <Icon className={cn('mt-[1px] h-3.5 w-3.5 shrink-0', update ? 'text-slate-400' : 'text-amber-500')}>
          {update ? <path d="M5 10.5 8.5 14 15 6" /> : <path d="M3.5 10h11m-4-4.5L15 10l-4.5 4.5" />}
        </Icon>
        {readable(c.resolution)}
      </p>
    </div>
  )
}

function labelFor(v: ConflictValue, fallback: string): string {
  return v.status === 'current' ? 'System record' : fallback
}

function ValueRow({
  value: v,
  label,
  muted = false,
  onCite,
}: {
  value: ConflictValue
  label: string
  muted?: boolean
  onCite: (c: Citation) => void
}) {
  return (
    <button
      onClick={() => onCite(v.citation)}
      title={`Open source: ${v.citation.title}`}
      className="group flex w-full gap-2 text-left"
    >
      <SourceKindIcon citation={v.citation} className="mt-[2px] h-3.5 w-3.5" />
      <span className="min-w-0">
        <span className="block truncate text-[11px] font-medium text-slate-400 group-hover:text-indigo-600">{label}</span>
        <span
          className={cn(
            'block leading-snug',
            muted ? 'text-[12.5px] text-slate-400' : 'text-[13.5px] font-medium text-slate-900',
          )}
        >
          {readable(v.value)}
        </span>
      </span>
    </button>
  )
}

// Icon and colour per suggested action kind (ORC-8): what the banker is being asked to do.
const ACTION_KINDS: Record<string, { tone: string; icon: ReactNode }> = {
  follow_up: { tone: 'text-indigo-500', icon: <path d="M3.5 10h11m-4-4.5L15 10l-4.5 4.5" /> },
  verify_with_owner: {
    tone: 'text-amber-500',
    icon: <path d="M10 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm-5.5 7a5.5 5.5 0 0 1 11 0" />,
  },
  flag_stale: { tone: 'text-amber-500', icon: <path d="M5 17V3.5m0 0h9l-2 3.5 2 3.5H5" /> },
}

function Icon({ className, children }: { className: string; children: ReactNode }) {
  return (
    <svg viewBox="0 0 20 20" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  )
}

