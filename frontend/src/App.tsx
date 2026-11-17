// Briefing Desk: prepare -> review -> act -> close the loop (specs/05-api-ui.md).
import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError, api, type HistoryItem, type Meeting, type User } from './api'
import { AttentionPanel, type ActionState } from './components/AttentionPanel'
import { ChatWidget } from './components/ChatWidget'
import { HistoryMenu } from './components/HistoryMenu'
import { ContactsExhibit, PipelineExhibit, RevenueExhibit } from './components/Exhibits'
import { HomeDashboard } from './components/HomeDashboard'
import { KeyFigures } from './components/KeyFigures'
import { NotesCapture } from './components/NotesCapture'
import { SectionCard, type RejectReason, type Review } from './components/SectionCard'
import { SignIn } from './components/SignIn'
import { SourceDrawer } from './components/SourceDrawer'
import { TopBar } from './components/TopBar'
import { GLYPH, Logo, SECTION_ORDER, Spinner, cn, formatMeetingTime, readable } from './components/ui'
import {
  NO_EXHIBITS,
  type Briefing,
  type Citation,
  type Claim,
  type Exhibits,
  type KeyFigure,
  type Section,
  type SectionKey,
  type SuggestedAction,
} from './types'

type Run = {
  briefingId: string | null
  status: 'idle' | 'running' | 'done' | 'error'
  sections: Partial<Record<SectionKey, Section>>
  figures: KeyFigure[]
  exhibits: Exhibits
  briefing: Briefing | null
  error: string | null
  startedAt: number
  seconds: number | null
  savedAt: string | null // set when the briefing was loaded from history
  stale: boolean
}

type View = 'briefing' | 'notes'

// The URL hash names the open meeting (#/meeting/M-901), so browser Back, Forward and reload work.
const MEETING_HASH = /^#\/meeting\/(.+)$/

const SESSION_KEY = 'briefing-desk.user'

const IDLE: Run = {
  briefingId: null,
  status: 'idle',
  sections: {},
  figures: [],
  exhibits: NO_EXHIBITS,
  briefing: null,
  error: null,
  startedAt: 0,
  seconds: null,
  savedAt: null,
  stale: false,
}

export default function App() {
  const [users, setUsers] = useState<User[]>([])
  const [userId, setUserId] = useState<string | null>(() => {
    try {
      return sessionStorage.getItem(SESSION_KEY) // stay signed in across reloads during the demo
    } catch {
      return null
    }
  })
  const [meetings, setMeetings] = useState<Meeting[]>([])
  const [meeting, setMeeting] = useState<Meeting | null>(null)
  const [run, setRun] = useState<Run>(IDLE)
  const [view, setView] = useState<View>('briefing')
  const [reviews, setReviews] = useState<Record<string, Review>>({})
  const [actionStates, setActionStates] = useState<Record<string, ActionState>>({})
  const [drawer, setDrawer] = useState<Citation | null>(null)
  const [history, setHistory] = useState<HistoryItem[]>([])
  const [copied, setCopied] = useState(false)
  const closeStream = useRef<(() => void) | null>(null)

  useEffect(() => {
    api.users().then(setUsers)
  }, [])

  // Switching user resets everything: a briefing is specific to the viewer's entitlements.
  const firstUserEffect = useRef(true)
  useEffect(() => {
    if (!firstUserEffect.current) window.history.replaceState(null, '', '#/')
    firstUserEffect.current = false
    closeStream.current?.()
    setRun(IDLE)
    setMeeting(null)
    setReviews({})
    setActionStates({})
    setView('briefing')
    setMeetings([])
    try {
      if (userId) sessionStorage.setItem(SESSION_KEY, userId)
      else sessionStorage.removeItem(SESSION_KEY)
    } catch {
      // storage unavailable (private mode): sign-in simply is not remembered
    }
    if (userId) api.meetings(userId).then(setMeetings)
  }, [userId])

  const openSaved = useCallback(
    (m: Meeting, briefingId?: string) => {
      if (!userId) return
      api.history(userId, m.client_id).then(setHistory)
      // API-11/12: reopen a briefing this user prepared, with their reviews and actions
      api.latestBriefing(userId, m.client_id, briefingId).then((saved) => {
        if (!saved) return
        setRun({
          ...IDLE,
          status: 'done',
          briefingId: saved.briefing.briefing_id,
          briefing: saved.briefing,
          sections: Object.fromEntries(saved.briefing.sections.map((s) => [s.key, s])),
          figures: saved.briefing.key_figures ?? [],
          exhibits: saved.briefing.exhibits ?? NO_EXHIBITS,
          savedAt: saved.created_at,
          stale: saved.stale,
        })
        setReviews(
          Object.fromEntries(
            Object.entries(saved.reviews).map(([id, decision]) => [
              id,
              { decision, reason: (saved.review_notes?.[id] || undefined) as RejectReason | undefined },
            ]),
          ),
        )
        setActionStates(Object.fromEntries(saved.created_suggestions.map((id) => [id, 'created' as const])))
      })
    },
    [userId],
  )

  const selectMeeting = useCallback(
    (m: Meeting) => {
      closeStream.current?.()
      setMeeting(m)
      setRun(IDLE)
      setReviews({})
      setActionStates({})
      setHistory([])
      setView('briefing')
      openSaved(m)
    },
    [openSaved],
  )

  /** Opening a meeting adds a browser history entry, so Back returns to where you came from. */
  function openMeeting(m: Meeting) {
    if (m.meeting_id !== meeting?.meeting_id) {
      window.history.pushState({ meetingId: m.meeting_id }, '', `#/meeting/${m.meeting_id}`)
    }
    selectMeeting(m)
  }

  /** The Home link and the logo always go home; the browser's Back button steps through history. */
  function goHome() {
    window.history.pushState(null, '', '#/')
    closeStream.current?.()
    setMeeting(null)
  }

  /** Search and the dashboard open a client through its next meeting (every covered client has one). */
  function openClient(clientId: string) {
    const m = meetings.find((x) => x.client_id === clientId)
    if (m) openMeeting(m)
  }

  // Browser Back / Forward: show whatever the URL now names.
  useEffect(() => {
    const onPop = () => {
      const m = meetings.find((x) => x.meeting_id === MEETING_HASH.exec(window.location.hash)?.[1])
      if (m) selectMeeting(m)
      else {
        closeStream.current?.()
        setMeeting(null)
      }
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [meetings, selectMeeting])

  // Reload or shared link: once meetings load, reopen the meeting the URL names, if this user covers it.
  useEffect(() => {
    const m = meetings.find((x) => x.meeting_id === MEETING_HASH.exec(window.location.hash)?.[1])
    if (m) selectMeeting(m)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meetings])

  async function prepare() {
    if (!meeting || !userId) return
    closeStream.current?.()
    setReviews({})
    setActionStates({})
    setView('briefing')
    const startedAt = Date.now()
    setRun({ ...IDLE, status: 'running', startedAt })
    try {
      const { briefing_id } = await api.startBriefing(userId, meeting.meeting_id)
      setRun((r) => ({ ...r, briefingId: briefing_id }))
      closeStream.current = api.streamBriefing(briefing_id, {
        onFigures: (figures) => setRun((r) => ({ ...r, figures })),
        onExhibits: (exhibits) => setRun((r) => ({ ...r, exhibits })),
        onSection: (s) => setRun((r) => ({ ...r, sections: { ...r.sections, [s.key]: s } })),
        onBriefing: (b) => {
          setRun((r) => ({ ...r, status: 'done', briefing: b, seconds: (Date.now() - r.startedAt) / 1000 }))
          api.history(userId, meeting.client_id).then(setHistory) // the new version is now saved
        },
        onError: (message) => setRun((r) => ({ ...r, status: 'error', error: message })),
      })
    } catch (e) {
      setRun({ ...IDLE, status: 'error', error: (e as ApiError).message })
    }
  }

  /** UI-6: null undoes the review. A reject always carries a reason (feeds EVAL-11). */
  function review(claim: Claim, next: Review | null) {
    setReviews(({ [claim.id]: _, ...rest }) => (next ? { ...rest, [claim.id]: next } : rest))
    if (run.briefingId && userId) {
      api.review(run.briefingId, claim.id, userId, next?.decision ?? 'clear', next?.reason ?? '')
    }
  }

  async function act(action: SuggestedAction, state: ActionState) {
    if (state === 'created' && meeting && userId) {
      await api.createAction({
        user_id: userId,
        client_id: meeting.client_id,
        kind: action.kind,
        description: action.description,
        owner: action.owner,
        due: action.due,
        citations: action.citations.map((c) => c.source_id),
        briefing_id: run.briefingId,
        suggestion_id: action.id,
      })
    }
    setActionStates((s) => ({ ...s, [action.id]: state }))
  }

  async function copyMarkdown() {
    if (!run.briefing) return
    await navigator.clipboard.writeText(toMarkdown(run.briefing, reviews, me?.name ?? ''))
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const me = users.find((u) => u.user_id === userId)
  if (!userId) return <SignIn users={users} onSignIn={setUserId} />
  const allClaims = run.briefing?.sections.flatMap((s) => s.claims) ?? []
  const rails = !!meeting && view === 'briefing' && run.status !== 'idle'

  return (
    <div className="flex h-full flex-col">
      <TopBar
        users={users}
        me={me}
        onHome={goHome}
        onSwitch={setUserId}
        onSignOut={() => setUserId(null)}
      />
      {/* One canvas and one scroll: side panels are sticky cards beside the briefing, not separate strips */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {!meeting && (
          <HomeDashboard
            userId={userId}
            name={me?.name.split(' ')[0] ?? ''}
            onOpenMeeting={(id) => {
              const m = meetings.find((x) => x.meeting_id === id)
              if (m) openMeeting(m)
            }}
            onOpenClient={openClient}
          />
        )}

        {meeting && (
          <div
            className={cn(
              'mx-auto px-6 py-8',
              rails ? 'grid max-w-[1560px] items-start gap-6 xl:grid-cols-[300px_minmax(0,1fr)_340px]' : 'max-w-3xl',
            )}
          >
            {rails && (
              <aside className="xl:sticky xl:top-8 xl:max-h-[calc(100vh-8rem)] xl:overflow-y-auto">
                <AttentionPanel
                  briefing={run.briefing}
                  running={run.status === 'running'}
                  actionStates={actionStates}
                  onAction={act}
                  onCite={setDrawer}
                  side="left"
                />
              </aside>
            )}
            <main className="min-w-0">
              <MeetingHeader
                meeting={meeting}
                run={run}
                view={view}
                onPrepare={prepare}
                onView={setView}
                onCopy={copyMarkdown}
                copied={copied}
                reviewed={allClaims.filter((c) => reviews[c.id]).length}
                total={allClaims.length}
                history={history}
                onOpenVersion={(id) => openSaved(meeting, id)}
                onBack={goHome}
              />

              {view === 'notes' ? (
                <NotesCapture clientId={meeting.client_id} userId={userId} />
              ) : (
                <>
                  {run.status === 'error' && (
                    <p className="mb-4 rounded-xl bg-rose-50 p-4 text-sm text-rose-700">{run.error}</p>
                  )}
                  {run.status === 'idle' && <IdleState onPrepare={prepare} />}
                  {run.status !== 'idle' && (
                    <div className="space-y-5">
                      <KeyFigures figures={run.figures} loading={run.status === 'running'} onCite={setDrawer} />
                      {SECTION_ORDER.map((s) => (
                        <SectionCard
                          key={s.key}
                          title={s.title}
                          icon={GLYPH[s.key]}
                          exhibit={
                            s.key === 'client_overview' ? (
                              <ContactsExhibit exhibits={run.exhibits} onCite={setDrawer} />
                            ) : s.key === 'key_metrics' ? (
                              <RevenueExhibit exhibits={run.exhibits} onCite={setDrawer} />
                            ) : s.key === 'opportunities' ? (
                              <PipelineExhibit exhibits={run.exhibits} onCite={setDrawer} />
                            ) : null
                          }
                          section={run.sections[s.key]}
                          reviews={reviews}
                          onReview={review}
                          onCite={setDrawer}
                        />
                      ))}
                    </div>
                  )}
                </>
              )}
            </main>
            {rails && (
              <aside className="xl:sticky xl:top-8 xl:max-h-[calc(100vh-8rem)] xl:overflow-y-auto xl:pb-24">
                <AttentionPanel
                  briefing={run.briefing}
                  running={run.status === 'running'}
                  actionStates={actionStates}
                  onAction={act}
                  onCite={setDrawer}
                  side="right"
                />
              </aside>
            )}
          </div>
        )}
      </div>

      <ChatWidget
        userId={userId}
        clients={[...new Map(meetings.map((m) => [m.client_id, { client_id: m.client_id, name: m.legal_name }])).values()]}
        currentClientId={meeting?.client_id ?? null}
        onCite={setDrawer}
      />

      {drawer && <SourceDrawer citation={drawer} userId={userId} onClose={() => setDrawer(null)} />}
    </div>
  )
}

function MeetingHeader({
  meeting,
  run,
  view,
  onPrepare,
  onView,
  onCopy,
  copied,
  reviewed,
  total,
  history,
  onOpenVersion,
  onBack,
}: {
  meeting: Meeting
  run: Run
  view: View
  onPrepare: () => void
  onView: (v: View) => void
  onCopy: () => void
  copied: boolean
  reviewed: number
  total: number
  history: HistoryItem[]
  onOpenVersion: (briefingId: string) => void
  onBack: () => void
}) {
  const done = Object.keys(run.sections).length
  const allReviewed = total > 0 && reviewed === total
  return (
    <header className="mb-8">
      <button
        onClick={onBack}
        className="-ml-2 mb-4 inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-[13px] font-medium text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
      >
        <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M12.5 4.5 7 10l5.5 5.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Home
      </button>
      <div className="text-[13px] font-medium text-indigo-600">{formatMeetingTime(meeting.start_time)}</div>
      <h1 className="mt-1 text-3xl font-semibold tracking-tight text-slate-900">{meeting.legal_name}</h1>
      <p className="mt-1.5 text-[15px] text-slate-500">{meeting.purpose}</p>
      <Attendees names={meeting.client_attendees} contacts={run.exhibits.contacts} />

      <div className="mt-6 flex items-center justify-between">
        <div className="inline-flex rounded-full bg-slate-100 p-1 text-sm">
          {(['briefing', 'notes'] as const).map((v) => (
            <button
              key={v}
              onClick={() => onView(v)}
              className={cn(
                'inline-flex items-center gap-2 whitespace-nowrap rounded-full px-4 py-1.5 font-medium transition',
                view === v ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800',
              )}
            >
              {v === 'briefing' ? 'Briefing' : 'After the meeting'}
              {v === 'briefing' && run.status === 'done' && <ReviewProgress reviewed={reviewed} total={total} />}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2 whitespace-nowrap">
          {run.status === 'done' && view === 'briefing' && (
            <>
              <HistoryMenu
                label={run.savedAt ? `Prepared ${timeAgo(run.savedAt)}` : `Prepared in ${run.seconds?.toFixed(1)}s`}
                items={history}
                currentId={run.briefingId}
                onOpen={onOpenVersion}
              />
              <button
                onClick={onCopy}
                title={
                  copied
                    ? 'Copied'
                    : allReviewed
                      ? 'Copy the reviewed briefing as markdown'
                      : 'Copy as markdown (rejected claims left out)'
                }
                aria-label="Copy briefing"
                className={cn(
                  'grid h-8 w-8 place-items-center rounded-full transition',
                  copied || allReviewed
                    ? 'text-emerald-600 hover:bg-emerald-50'
                    : 'text-slate-500 hover:bg-slate-100 hover:text-slate-800',
                )}
              >
                <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.7">
                  {copied ? (
                    <path d="M5 10.5 8.5 14 15 6" strokeLinecap="round" strokeLinejoin="round" />
                  ) : (
                    <path d="M7 7V4.5A1.5 1.5 0 0 1 8.5 3h7A1.5 1.5 0 0 1 17 4.5v7a1.5 1.5 0 0 1-1.5 1.5H13M4.5 7h7A1.5 1.5 0 0 1 13 8.5v7a1.5 1.5 0 0 1-1.5 1.5h-7A1.5 1.5 0 0 1 3 15.5v-7A1.5 1.5 0 0 1 4.5 7Z" />
                  )}
                </svg>
              </button>
            </>
          )}
          {run.status !== 'idle' && !(run.status === 'done' && run.stale && view === 'briefing') && (
            <button
              onClick={onPrepare}
              disabled={run.status === 'running'}
              className="inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-sm font-medium text-slate-700 ring-1 ring-slate-200 transition hover:bg-slate-50 hover:ring-slate-300 disabled:opacity-60"
            >
              {run.status === 'running' && <Spinner className="h-3.5 w-3.5" />}
              {run.status === 'running' ? `${done} of 7` : 'Regenerate'}
            </button>
          )}
        </div>
      </div>

      {run.status === 'done' && run.stale && view === 'briefing' && (
        <div
          role="status"
          className="mt-4 flex items-center gap-3 rounded-xl bg-amber-50/80 px-4 py-2.5 text-[13px] text-amber-900 ring-1 ring-amber-200"
        >
          <svg viewBox="0 0 20 20" className="h-4 w-4 shrink-0 text-amber-500" fill="currentColor" aria-hidden="true">
            <path
              fillRule="evenodd"
              d="M8.49 2.86c.67-1.15 2.35-1.15 3.02 0l6.28 10.88c.67 1.15-.17 2.6-1.51 2.6H3.72c-1.34 0-2.18-1.45-1.51-2.6L8.49 2.86ZM10 6a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0v-3.5A.75.75 0 0 1 10 6Zm0 8a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z"
            />
          </svg>
          <span className="flex-1">
            <span className="font-semibold">Source data changed since this was prepared.</span> Regenerate to use the
            latest records.
          </span>
          <button
            onClick={onPrepare}
            className="rounded-full bg-amber-600 px-3 py-1 text-xs font-semibold text-white transition hover:bg-amber-500"
          >
            Regenerate
          </button>
        </div>
      )}
    </header>
  )
}

function IdleState({ onPrepare }: { onPrepare: () => void }) {
  return (
    <div className="grid place-items-center rounded-2xl bg-white py-20 shadow-[0_12px_32px_-16px_rgba(15,23,42,0.12)] ring-1 ring-slate-900/[0.04]">
      <Logo size={44} />
      <button
        onClick={onPrepare}
        className="mt-6 rounded-full bg-indigo-600 px-6 py-2.5 text-sm font-medium text-white shadow-lg shadow-indigo-600/20 transition hover:bg-indigo-500"
      >
        Prepare briefing
      </button>
    </div>
  )
}

function timeAgo(iso: string): string {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} h ago`
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

/** UI-7: accepted and unreviewed claims with their sources; rejected claims are left out. */
function toMarkdown(b: Briefing, reviews: Record<string, Review>, reviewer: string): string {
  const claims = b.sections.flatMap((s) => s.claims)
  const reviewed = claims.filter((c) => reviews[c.id]).length
  const rejected = claims.filter((c) => reviews[c.id]?.decision === 'reject').length
  const lines = [
    `# ${b.client.name}`,
    b.meeting ? `${b.meeting.purpose}, ${readable(b.meeting.date)}` : '',
    reviewed === claims.length
      ? `Reviewed by ${reviewer}: all ${claims.length} claims checked, ${rejected} removed.`
      : `Draft: ${reviewed} of ${claims.length} claims reviewed by ${reviewer}.`,
    '',
  ]
  for (const s of b.sections) {
    lines.push(`## ${s.title}`)
    for (const c of s.claims) {
      if (reviews[c.id]?.decision === 'reject') continue
      const flag = c.status === 'verified' ? '' : ' (unverified)'
      lines.push(`- ${readable(c.annotated ?? c.text)}${flag}`)
      c.citations.forEach((x, i) => lines.push(`  - [${i + 1}] ${x.title} (${x.source_id})`))
    }
    lines.push('')
  }
  if (b.conflicts.length) {
    lines.push('## Conflicts')
    b.conflicts.forEach((c) => lines.push(`- ${readable(c.topic)}: ${readable(c.resolution)}`))
  }
  return lines.join('\n')
}

/** UI-6: how much of the briefing a person has checked. A ring that fills, emerald when complete. */
function ReviewProgress({ reviewed, total }: { reviewed: number; total: number }) {
  if (total === 0) return null
  const complete = reviewed === total
  const r = 7
  const length = 2 * Math.PI * r
  return (
    <span
      title={`${reviewed} of ${total} claims reviewed (accepted or rejected)`}
      className={cn(
        'inline-flex items-center gap-1.5 text-xs font-medium tabular-nums',
        complete ? 'text-emerald-700' : 'text-slate-500',
      )}
    >
      <svg viewBox="0 0 18 18" className="h-4 w-4 -rotate-90">
        <circle cx="9" cy="9" r={r} fill="none" stroke="currentColor" strokeWidth="2" className="text-slate-200" />
        <circle
          cx="9"
          cy="9"
          r={r}
          fill="none"
          strokeWidth="2"
          strokeLinecap="round"
          className={complete ? 'stroke-emerald-500' : 'stroke-indigo-500'}
          strokeDasharray={length}
          strokeDashoffset={length * (1 - reviewed / total)}
        />
      </svg>
      {complete ? 'Reviewed' : `${reviewed}/${total}`}
    </span>
  )
}

/** Who is in the room, with titles and a "New" tag from the contacts table once the briefing starts. */
function Attendees({ names, contacts }: { names: string[]; contacts: Exhibits['contacts'] }) {
  if (names.length === 0) return null
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <span className="text-[13px] text-slate-400">Attending</span>
      {names.map((name) => {
        const c = contacts.find((k) => k.name.toLowerCase() === name.toLowerCase())
        return (
          <span
            key={name}
            className="inline-flex h-7 items-center gap-1.5 rounded-full bg-white px-2.5 text-[13px] font-medium text-slate-700 ring-1 ring-slate-200"
          >
            {name}
            {c && <span className="font-normal text-slate-400">{shortTitle(c.title)}</span>}
            {c?.status === 'new' && (
              <span className="rounded bg-amber-50 px-1.5 text-[10.5px] font-semibold text-amber-700 ring-1 ring-inset ring-amber-200">
                New
              </span>
            )}
          </span>
        )
      })}
    </div>
  )
}

/** "Chief Financial Officer" -> "CFO"; other titles unchanged. */
function shortTitle(title: string): string {
  const known: Record<string, string> = {
    'chief executive officer': 'CEO',
    'chief financial officer': 'CFO',
    'chief operating officer': 'COO',
  }
  return known[title.toLowerCase()] ?? title
}
