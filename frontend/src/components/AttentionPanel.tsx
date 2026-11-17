// UI-5: one prep panel beside the briefing, two tabs, one scrollbar. "To do" is what to do before the
// meeting; "Conflicts" is where sources disagree or the last briefing is out of date, plus gaps.
import { useRef, useState, type ReactNode } from 'react'
import type { ActionOrigin, ClientAction } from '../api'
import type { Briefing, Citation, Conflict, ConflictValue, SuggestedAction } from '../types'
import { SourceKindIcon } from './SectionCard'
import { CARD, Spinner, cn, readable } from './ui'

export type ActionState = 'created' | 'dismissed'

interface Props {
  briefing: Briefing | null
  running: boolean
  actionStates: Record<string, ActionState>
  onAction: (action: SuggestedAction, state: ActionState | 'undo') => void
  onCite: (citation: Citation) => void
  mine?: ClientAction[] // the viewer's own actions not among this briefing's suggestions
  onRemoveMine?: (actionId: string) => void
  onAdd?: (description: string) => Promise<void>
}

export function AttentionPanel({ briefing, running, actionStates, onAction, onCite, mine = [], onRemoveMine, onAdd }: Props) {
  const [tab, setTab] = useState<'todo' | 'conflicts'>('todo')
  const [allUnknowns, setAllUnknowns] = useState(false)
  const actions = (briefing?.suggested_actions.filter((a) => actionStates[a.id] !== 'dismissed') ?? []).sort(
    (a, b) => urgency(a) - urgency(b),
  )
  const unknowns = briefing ? (allUnknowns ? briefing.unknowns : briefing.unknowns.slice(0, 3)) : []
  const total = actions.length + mine.length
  const done = actions.filter((a) => actionStates[a.id] === 'created').length + mine.length

  return (
    <aside aria-label="Meeting prep" className={cn(CARD, 'overflow-hidden')}>
      <div role="tablist" aria-label="Prep panels" className="m-3 grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1.5">
        <Tab active={tab === 'todo'} onClick={() => setTab('todo')}>
          To do <span className="font-medium text-slate-500">{total - done}</span>
        </Tab>
        <Tab active={tab === 'conflicts'} onClick={() => setTab('conflicts')}>
          Conflicts <span className="font-semibold text-amber-700">{briefing?.conflicts.length ?? 0}</span>
        </Tab>
      </div>

      {!briefing && running && (
        <div className="flex items-center gap-2 px-5 pb-5 text-sm text-slate-500">
          <Spinner /> Checking sources
        </div>
      )}

      {briefing && tab === 'todo' && (
        <div className="px-3 pb-3">
          <p className="mx-2 mb-3 mt-1 text-[13px] text-slate-500">
            Before the meeting · {done} of {total} done
          </p>
          {briefing.access_limited && (
            <p className="mx-2 mb-3 flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
              <svg viewBox="0 0 20 20" className="h-3.5 w-3.5 shrink-0" fill="currentColor" aria-hidden="true">
                <path
                  fillRule="evenodd"
                  d="M10 1a4.5 4.5 0 0 0-4.5 4.5V9H5a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2h-.5V5.5A4.5 4.5 0 0 0 10 1Zm3 8V5.5a3 3 0 1 0-6 0V9h6Z"
                />
              </svg>
              Some sources are restricted for your profile
            </p>
          )}
          <ul>
            {actions.map((a) => (
              <ActionRow key={a.id} action={a} created={actionStates[a.id] === 'created'} onAction={onAction} />
            ))}
            {mine.map((m) => (
              <MineRow key={m.action_id} action={m} onRemove={() => onRemoveMine?.(m.action_id)} />
            ))}
          </ul>
          {total === 0 && <p className="px-2 pb-2 text-sm text-slate-500">Nothing outstanding.</p>}
          {onAdd && <AddItem onAdd={onAdd} />}
        </div>
      )}

      {briefing && tab === 'conflicts' && (
        <div className="px-5 pb-5">
          <p className="mb-2 mt-1 text-[13px] leading-normal text-slate-500">
            Where sources disagree or the last briefing is out of date.
          </p>
          {/* sources that disagree need action, so they come before plain updates */}
          {[...briefing.conflicts]
            .sort((a, b) => Number(isUpdate(a)) - Number(isUpdate(b)))
            .map((c) => (
              <ConflictRow key={c.topic} conflict={c} onCite={onCite} />
            ))}
          {briefing.conflicts.length === 0 && <p className="py-3 text-sm text-slate-500">No conflicts found.</p>}

          {briefing.unknowns.length > 0 && (
            <div className="mt-2 border-t border-slate-200 pt-4">
              <h3 className="text-[15px] font-semibold">
                Gaps <span className="font-medium text-slate-500">{briefing.unknowns.length}</span>
              </h3>
              <p className="mb-1 mt-0.5 text-[13px] text-slate-500">What the data cannot answer.</p>
              <ul>
                {unknowns.map((u) => (
                  <li
                    key={u.question}
                    className="border-t border-slate-100 py-2.5 text-[13.5px] leading-snug text-slate-700 first:border-0"
                    title={u.reason}
                  >
                    {readable(u.question)}
                  </li>
                ))}
              </ul>
              {briefing.unknowns.length > 3 && (
                <button
                  onClick={() => setAllUnknowns((v) => !v)}
                  className="mt-1 h-10 w-full rounded-[10px] border border-slate-200 bg-white text-[13.5px] font-medium text-slate-900 transition hover:bg-slate-100"
                >
                  {allUnknowns ? 'Show less' : `Show ${briefing.unknowns.length - 3} more`}
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </aside>
  )
}

function Tab({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        'h-10 rounded-lg text-[14px] transition',
        active ? 'bg-white font-semibold text-slate-900 shadow-[0_1px_2px_rgba(26,24,20,0.08)]' : 'font-medium text-slate-700',
      )}
    >
      {children}
    </button>
  )
}

/** A square checkbox: ticked = saved as your action, unticked removes it again. */
function Checkbox({ checked, onClick, label }: { checked: boolean; onClick: () => void; label: string }) {
  return (
    <button
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      title={label}
      onClick={onClick}
      className="-m-2.5 grid h-11 w-11 shrink-0 place-items-center"
    >
      {checked ? (
        <span className="grid h-[22px] w-[22px] place-items-center rounded-md bg-emerald-700 text-white">
          <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="3">
            <path d="M5 10.5 8.5 14 15 6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      ) : (
        <span className="h-[22px] w-[22px] rounded-md border-2 border-slate-400 bg-white transition hover:border-indigo-600" />
      )}
    </button>
  )
}

function ActionRow({
  action: a,
  created,
  onAction,
}: {
  action: SuggestedAction
  created: boolean
  onAction: (action: SuggestedAction, state: ActionState | 'undo') => void
}) {
  const overdue = /^Overdue by (\d+) days?: (.*)$/s.exec(a.description)
  const text = overdue ? overdue[2] : a.description
  return (
    <li className="group flex gap-2 border-t border-slate-100 px-2 py-3">
      <Checkbox
        checked={created}
        onClick={() => onAction(a, created ? 'undo' : 'created')}
        label={created ? 'Untick: remove from your actions' : 'Add to your actions'}
      />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        {overdue && !created && (
          <span className="self-start rounded-full bg-rose-50 px-2 py-0.5 text-[12px] font-semibold text-rose-800">
            {overdue[1]} days overdue
          </span>
        )}
        <span className={cn('text-[14px] leading-snug', created ? 'text-slate-500 line-through' : 'text-slate-900')}>
          {readable(text)}
        </span>
        {!created && <OriginTag origin={originOf(a)} />}
      </div>
      {!created && (
        <button
          onClick={() => onAction(a, 'dismissed')}
          title="Dismiss"
          aria-label="Dismiss"
          className="self-start text-slate-300 opacity-0 transition hover:text-slate-600 group-hover:opacity-100"
        >
          <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M6 6l8 8M14 6l-8 8" />
          </svg>
        </button>
      )}
    </li>
  )
}

/** One of the viewer's own actions: added by hand, confirmed from notes, or ticked in an earlier briefing. */
function MineRow({ action: m, onRemove }: { action: ClientAction; onRemove: () => void }) {
  return (
    <li className="flex gap-2 border-t border-slate-100 px-2 py-3">
      <Checkbox checked onClick={onRemove} label="Untick: remove from your actions" />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <span className="text-[14px] leading-snug text-slate-900">{readable(m.description)}</span>
        <span className="flex items-center gap-1.5">
          <OriginTag origin={m.origin ?? 'user'} />
          <span className="text-[12px] text-slate-500">· {readable(m.at.slice(0, 10))}</span>
        </span>
      </div>
    </li>
  )
}

const ORIGIN: Record<ActionOrigin, { label: string; className: string; icon: ReactNode }> = {
  records: { label: 'From records', className: 'text-slate-600', icon: <path d="M4 5c0-1.4 2.7-2.5 6-2.5s6 1.1 6 2.5v10c0 1.4-2.7 2.5-6 2.5S4 16.4 4 15V5Zm0 0c0 1.4 2.7 2.5 6 2.5S16 6.4 16 5M4 10c0 1.4 2.7 2.5 6 2.5s6-1.1 6-2.5" /> },
  conflict: { label: 'From a conflict', className: 'text-amber-800', icon: <path d="M7 4 3.5 7.5 7 11M3.5 7.5h10M13 9l3.5 3.5L13 16m3.5-3.5h-10" /> },
  ai: { label: 'Suggested by AI', className: 'text-slate-600', icon: <path d="M10 2.5 11.6 8.4 17.5 10l-5.9 1.6L10 17.5l-1.6-5.9L2.5 10l5.9-1.6L10 2.5Z" /> },
  notes: { label: 'From your notes', className: 'text-indigo-700', icon: <path d="M5.5 2.5h6.5l3.5 3.5v11.5h-10zM8 10h5M8 13h5" /> },
  user: { label: 'Added by you', className: 'text-indigo-700', icon: <path d="M10 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm-5.5 7a5.5 5.5 0 0 1 11 0" /> },
}

/** A suggestion's origin. Briefings saved before the field existed are classified the same way code
 * creates them: overdue items come from records, verify / flag items from conflicts (ORC-8). */
export function originOf(a: SuggestedAction): ActionOrigin {
  if (a.origin) return a.origin
  if (a.id.startsWith('overdue-')) return 'records'
  if (a.kind === 'verify_with_owner' || a.kind === 'flag_stale') return 'conflict'
  return 'ai'
}

/** Where an item came from, so a database fact never looks like an AI suggestion. */
function OriginTag({ origin }: { origin: ActionOrigin }) {
  const o = ORIGIN[origin] ?? ORIGIN.ai
  return (
    <span className={cn('inline-flex items-center gap-1 text-[12px]', o.className)}>
      <Icon className="h-3 w-3">{o.icon}</Icon>
      {o.label}
    </span>
  )
}

/** Type an item of your own; it is saved with your name and appears in this client's later briefings. */
function AddItem({ onAdd }: { onAdd: (description: string) => Promise<void> }) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [saving, setSaving] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  if (!open) {
    return (
      <button
        onClick={() => {
          setOpen(true)
          setTimeout(() => input.current?.focus())
        }}
        className="mt-1 flex h-10 w-full items-center justify-center gap-2 rounded-[10px] border border-slate-200 bg-white text-[13.5px] font-medium text-slate-900 transition hover:bg-slate-100"
      >
        <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M10 4.5v11M4.5 10h11" strokeLinecap="round" />
        </svg>
        Add item
      </button>
    )
  }
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault()
        if (!text.trim()) return
        setSaving(true)
        await onAdd(text.trim())
        setSaving(false)
        setText('')
        setOpen(false)
      }}
      className="mt-1 flex items-center gap-2"
    >
      <input
        ref={input}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}
        placeholder="e.g. Bring the revised fee schedule"
        aria-label="New item"
        className="h-10 flex-1 rounded-[10px] border border-slate-300 bg-white px-3 text-[13.5px] text-slate-900 outline-none placeholder:text-slate-400 focus:border-indigo-600"
      />
      <button
        type="submit"
        disabled={!text.trim() || saving}
        className="h-10 rounded-[10px] bg-slate-900 px-4 text-[13.5px] font-semibold text-white transition hover:bg-slate-800 disabled:opacity-40"
      >
        Add
      </button>
    </form>
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

/** "Changed" (what the last briefing said, then the system record) or "Sources disagree" (both sides
 * in boxes). The outdated side stays visible on purpose: the team may still be acting on it. */
function ConflictRow({ conflict: c, onCite }: { conflict: Conflict; onCite: (c: Citation) => void }) {
  const update = isUpdate(c)
  return (
    <article className="flex flex-col gap-2.5 border-t border-slate-100 py-4">
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-[15px] font-semibold leading-snug">{readable(c.topic)}</h3>
        <span
          className={cn(
            'shrink-0 rounded-full px-2 py-0.5 text-[12px] font-semibold',
            update ? 'bg-slate-100 text-slate-700' : 'bg-amber-50 text-amber-800',
          )}
        >
          {update ? 'Changed' : 'Sources disagree'}
        </span>
      </div>
      {update ? (
        <dl className="grid gap-2 text-[14px] leading-snug">
          {c.values
            .slice()
            .sort((a, b) => Number(b.status === 'outdated') - Number(a.status === 'outdated'))
            .map((v, i) => (
              <ValueLine key={i} value={v} onCite={onCite} />
            ))}
        </dl>
      ) : (
        <div className="grid gap-2 text-[14px] leading-snug">
          {c.values.map((v, i) => (
            <button
              key={i}
              onClick={() => onCite(v.citation)}
              title={`Open source: ${v.citation.title}`}
              className="rounded-[10px] bg-slate-50 px-3 py-2.5 text-left transition hover:bg-slate-100"
            >
              <span className="mb-0.5 flex items-center gap-1.5 text-[12px] font-semibold text-slate-600">
                <SourceKindIcon citation={v.citation} className="h-3 w-3" />
                {labelFor(v, v.citation.title)}
              </span>
              {readable(v.value)}
            </button>
          ))}
        </div>
      )}
      <p className={cn('flex gap-1.5 text-[13px] leading-snug', update ? 'text-emerald-800' : 'font-medium text-amber-800')}>
        <Icon className="mt-[2px] h-3.5 w-3.5 shrink-0">
          {update ? <path d="M5 10.5 8.5 14 15 6" /> : <path d="M3.5 10h11m-4-4.5L15 10l-4.5 4.5" />}
        </Icon>
        {readable(c.resolution)}
      </p>
    </article>
  )
}

function ValueLine({ value: v, onCite }: { value: ConflictValue; onCite: (c: Citation) => void }) {
  const old = v.status === 'outdated'
  return (
    <button onClick={() => onCite(v.citation)} title={`Open source: ${v.citation.title}`} className="text-left">
      <dt className="text-[12px] font-semibold text-slate-600">{old ? 'Last briefing said' : labelFor(v, 'Now')}</dt>
      <dd className={cn(old ? 'text-slate-500 line-through decoration-slate-300' : 'font-medium text-slate-900')}>
        {readable(v.value)}
      </dd>
    </button>
  )
}

function labelFor(v: ConflictValue, fallback: string): string {
  return v.status === 'current' ? 'System record' : fallback
}

function Icon({ className, children }: { className: string; children: ReactNode }) {
  return (
    <svg viewBox="0 0 20 20" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  )
}
