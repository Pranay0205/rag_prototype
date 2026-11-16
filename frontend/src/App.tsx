// Briefing Desk: prepare -> review -> act -> close the loop (specs/05-api-ui.md).
import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError, api, type HistoryItem, type Meeting, type User } from './api'
import { AttentionPanel, type ActionState } from './components/AttentionPanel'
import { HistoryMenu } from './components/HistoryMenu'
import { NotesCapture } from './components/NotesCapture'
import { SectionCard, type Review } from './components/SectionCard'
import { Sidebar } from './components/Sidebar'
import { SignIn } from './components/SignIn'
import { SourceDrawer } from './components/SourceDrawer'
import { Logo, SECTION_ORDER, Spinner, cn, formatMeetingTime } from './components/ui'
import type { Briefing, Citation, Claim, Section, SectionKey, SuggestedAction } from './types'

type Run = {
  briefingId: string | null
  status: 'idle' | 'running' | 'done' | 'error'
  sections: Partial<Record<SectionKey, Section>>
  briefing: Briefing | null
  error: string | null
  startedAt: number
  seconds: number | null
  savedAt: string | null // set when the briefing was loaded from history
  stale: boolean
}

const SESSION_KEY = 'briefing-desk.user'

const IDLE: Run = {
  briefingId: null,
  status: 'idle',
  sections: {},
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
  const [view, setView] = useState<'briefing' | 'notes'>('briefing')
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
  useEffect(() => {
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
          savedAt: saved.created_at,
          stale: saved.stale,
        })
        setReviews(saved.reviews)
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

  function review(claim: Claim, decision: Review) {
    setReviews((r) => ({ ...r, [claim.id]: decision }))
    if (run.briefingId && userId) api.review(run.briefingId, claim.id, userId, decision)
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
    await navigator.clipboard.writeText(toMarkdown(run.briefing, reviews))
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  if (!userId) return <SignIn users={users} onSignIn={setUserId} />
  const me = users.find((u) => u.user_id === userId)

  return (
    <div className="flex h-full">
      <Sidebar
        users={users}
        me={me}
        meetings={meetings}
        selectedId={meeting?.meeting_id ?? null}
        onSelect={selectMeeting}
        onSwitch={setUserId}
        onSignOut={() => setUserId(null)}
      />

      <main className="min-w-0 flex-1 overflow-y-auto">
        {!meeting && <Home name={me?.name.split(' ')[0] ?? ''} meetings={meetings.length} />}

        {meeting && (
          <div className="mx-auto max-w-3xl px-8 py-10">
            <MeetingHeader
              meeting={meeting}
              run={run}
              view={view}
              onPrepare={prepare}
              onView={setView}
              onCopy={copyMarkdown}
              copied={copied}
              history={history}
              onOpenVersion={(id) => openSaved(meeting, id)}
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
                    {SECTION_ORDER.map((s) => (
                      <SectionCard
                        key={s.key}
                        title={s.title}
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
          </div>
        )}
      </main>

      {meeting && view === 'briefing' && run.status !== 'idle' && (
        <AttentionPanel
          briefing={run.briefing}
          running={run.status === 'running'}
          actionStates={actionStates}
          onAction={act}
          onCite={setDrawer}
        />
      )}

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
  history,
  onOpenVersion,
}: {
  meeting: Meeting
  run: Run
  view: 'briefing' | 'notes'
  onPrepare: () => void
  onView: (v: 'briefing' | 'notes') => void
  onCopy: () => void
  copied: boolean
  history: HistoryItem[]
  onOpenVersion: (briefingId: string) => void
}) {
  const done = Object.keys(run.sections).length
  return (
    <header className="mb-8">
      <div className="text-[13px] font-medium text-indigo-600">{formatMeetingTime(meeting.start_time)}</div>
      <h1 className="mt-1 text-3xl font-semibold tracking-tight text-slate-900">{meeting.legal_name}</h1>
      <p className="mt-1.5 text-[15px] text-slate-500">
        {meeting.purpose} · {meeting.client_attendees.join(', ')}
      </p>

      <div className="mt-6 flex items-center justify-between">
        <div className="inline-flex rounded-full bg-slate-100 p-1 text-sm">
          {(['briefing', 'notes'] as const).map((v) => (
            <button
              key={v}
              onClick={() => onView(v)}
              className={cn(
                'rounded-full px-4 py-1.5 font-medium transition',
                view === v ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800',
              )}
            >
              {v === 'briefing' ? 'Briefing' : 'After the meeting'}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-3">
          {run.status === 'done' && view === 'briefing' && (
            <>
              {run.stale && (
                <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700">
                  Data updated since
                </span>
              )}
              <HistoryMenu
                label={run.savedAt ? `Prepared ${timeAgo(run.savedAt)}` : `Prepared in ${run.seconds?.toFixed(1)}s`}
                items={history}
                currentId={run.briefingId}
                onOpen={onOpenVersion}
              />
              <button
                onClick={onCopy}
                className="rounded-full px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100"
              >
                {copied ? 'Copied' : 'Copy'}
              </button>
            </>
          )}
          {run.status !== 'idle' && (
            <button
              onClick={onPrepare}
              disabled={run.status === 'running'}
              className="inline-flex items-center gap-2 rounded-full bg-slate-900 px-4 py-1.5 text-sm font-medium text-white transition hover:bg-slate-800 disabled:opacity-60"
            >
              {run.status === 'running' && <Spinner className="h-3.5 w-3.5" />}
              {run.status === 'running' ? `${done} of 7` : 'Regenerate'}
            </button>
          )}
        </div>
      </div>
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

function greeting(): string {
  const h = new Date().getHours()
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'
}

function Home({ name, meetings }: { name: string; meetings: number }) {
  return (
    <div className="grid h-full place-items-center p-10">
      <div className="text-center">
        <h2 className="text-3xl font-semibold tracking-tight text-slate-900">
          {greeting()}, {name}
        </h2>
        <p className="mt-2 text-[15px] text-slate-500">
          {meetings} client {meetings === 1 ? 'meeting' : 'meetings'} this week
        </p>
      </div>
    </div>
  )
}

/** UI-7: accepted and unreviewed claims with their sources; rejected claims are left out. */
function toMarkdown(b: Briefing, reviews: Record<string, Review>): string {
  const lines = [`# ${b.client.name}`, b.meeting ? `${b.meeting.purpose}, ${b.meeting.date}` : '', '']
  for (const s of b.sections) {
    lines.push(`## ${s.title}`)
    for (const c of s.claims) {
      if (reviews[c.id] === 'reject') continue
      const flag = c.status === 'verified' ? '' : ' (unverified)'
      lines.push(`- ${c.annotated ?? c.text}${flag}`)
      c.citations.forEach((x, i) => lines.push(`  - [${i + 1}] ${x.title} (${x.source_id})`))
    }
    lines.push('')
  }
  if (b.conflicts.length) {
    lines.push('## Conflicts')
    b.conflicts.forEach((c) => lines.push(`- ${c.topic}: ${c.resolution}`))
  }
  return lines.join('\n')
}
