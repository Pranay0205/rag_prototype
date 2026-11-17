// Briefing Desk: prepare -> review -> act -> close the loop (specs/05-api-ui.md).
import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError, api, type ClientAction, type HistoryItem, type Meeting, type User } from './api'
import { AttentionPanel, originOf, type ActionState } from './components/AttentionPanel'
import { ChatWidget } from './components/ChatWidget'
import { HistoryMenu } from './components/HistoryMenu'
import { ContactsExhibit, PipelineExhibit, RevenueExhibit } from './components/Exhibits'
import { BriefingIndex, FIGURES_ANCHOR } from './components/BriefingIndex'
import { ClientPage } from './components/ClientPage'
import { HomeDashboard } from './components/HomeDashboard'
import { KeyFigures } from './components/KeyFigures'
import { NotesCapture } from './components/NotesCapture'
import { SectionCard, type RejectReason, type Review } from './components/SectionCard'
import { SignIn } from './components/SignIn'
import { SourceDrawer } from './components/SourceDrawer'
import { TopBar } from './components/TopBar'
import { CARD, ClientTile, Logo, SECTION_ORDER, Spinner, cn, formatMeetingTime, readable, shortTitle } from './components/ui'
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
const CLIENT_HASH = /^#\/client\/(.+)$/

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
  const [clients, setClients] = useState<{ client_id: string; name: string }[]>([])
  const [clientPage, setClientPage] = useState<string | null>(null) // UI-14: open client page
  const [run, setRun] = useState<Run>(IDLE)
  const [view, setView] = useState<View>('briefing')
  const [reviews, setReviews] = useState<Record<string, Review>>({})
  const [actionStates, setActionStates] = useState<Record<string, ActionState>>({})
  const [actionIds, setActionIds] = useState<Record<string, string>>({}) // suggestion id -> saved action id
  const [mine, setMine] = useState<ClientAction[]>([]) // the viewer's own actions for this client
  const [drawer, setDrawer] = useState<Citation | null>(null)
  const [chatOpen, setChatOpen] = useState(false)
  const [chatClient, setChatClient] = useState<string | null>(null) // client asked about from Home
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
    if (!userId) return
    api.meetings(userId).then(setMeetings)
    // the chat can ask about any covered client, not only those with a meeting coming up
    api.home(userId).then((h) => setClients(h.companies.map((c) => ({ client_id: c.client_id, name: c.name }))))
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
        setActionIds(saved.created_actions ?? {})
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
      setActionIds({})
      setMine([])
      if (userId) api.listActions(userId, m.client_id).then(setMine)
      setHistory([])
      setView('briefing')
      openSaved(m)
    },
    [openSaved, userId],
  )

  /** Opening a meeting adds a browser history entry, so Back returns to where you came from. */
  function openMeeting(m: Meeting) {
    setClientPage(null)
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
    setClientPage(null)
  }

  /** "Ask about ..." buttons open the chat on that client. */
  function askAbout(clientId: string) {
    setChatClient(clientId)
    setChatOpen(true)
  }

  /** UI-14: a client opens its own page (the whole relationship), not its next meeting. */
  function openClient(clientId: string) {
    window.history.pushState({ clientId }, '', `#/client/${clientId}`)
    closeStream.current?.()
    setMeeting(null)
    setClientPage(clientId)
  }

  // Browser Back / Forward: show whatever the URL now names.
  useEffect(() => {
    const onPop = () => {
      const m = meetings.find((x) => x.meeting_id === MEETING_HASH.exec(window.location.hash)?.[1])
      setClientPage(m ? null : (CLIENT_HASH.exec(window.location.hash)?.[1] ?? null))
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
    else setClientPage(CLIENT_HASH.exec(window.location.hash)?.[1] ?? null)
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

  const normalize = (t: string) => t.toLowerCase().replace(/\s+/g, ' ').trim()
  /** An action the viewer saved in an earlier briefing for the same item (closing the loop). */
  const earlier = (a: SuggestedAction) => mine.find((m) => normalize(m.description) === normalize(a.description))

  function refreshMine() {
    if (meeting && userId) api.listActions(userId, meeting.client_id).then(setMine)
  }

  /** Tick saves the suggestion as your action; untick removes it again; dismiss hides it. */
  async function act(action: SuggestedAction, state: ActionState | 'undo') {
    if (!meeting || !userId) return
    if (state === 'created') {
      const { action_id } = await api.createAction({
        user_id: userId,
        client_id: meeting.client_id,
        kind: action.kind,
        description: action.description,
        owner: action.owner,
        due: action.due,
        citations: action.citations.map((c) => c.source_id),
        briefing_id: run.briefingId,
        suggestion_id: action.id,
        origin: originOf(action),
      })
      setActionIds((ids) => ({ ...ids, [action.id]: action_id }))
      setActionStates((s) => ({ ...s, [action.id]: 'created' }))
    } else if (state === 'undo') {
      const id = actionIds[action.id] ?? earlier(action)?.action_id
      if (id) await api.deleteAction(id, userId)
      setActionIds(({ [action.id]: _, ...rest }) => rest)
      setActionStates(({ [action.id]: _, ...rest }) => rest)
    } else {
      setActionStates((s) => ({ ...s, [action.id]: state }))
    }
    refreshMine()
  }

  async function addItem(description: string) {
    if (!meeting || !userId) return
    await api.createAction({
      user_id: userId,
      client_id: meeting.client_id,
      kind: 'manual',
      description,
      briefing_id: run.briefingId,
      origin: 'user',
    })
    refreshMine()
  }

  async function copyMarkdown() {
    if (!run.briefing) return
    await navigator.clipboard.writeText(toMarkdown(run.briefing, reviews, me?.name ?? ''))
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const me = users.find((u) => u.user_id === userId)
  const clientName = clientPage ? meetings.find((m) => m.client_id === clientPage)?.legal_name : undefined
  if (!userId) return <SignIn users={users} onSignIn={setUserId} />
  const allClaims = run.briefing?.sections.flatMap((s) => s.claims) ?? []
  const rails = !!meeting && view === 'briefing' && run.status !== 'idle'
  const suggestions = run.briefing?.suggested_actions ?? []
  // suggestions already saved in an earlier briefing show as ticked; other saved actions are listed as your own
  const ticked: Record<string, ActionState> = { ...actionStates }
  for (const a of suggestions) if (!ticked[a.id] && earlier(a)) ticked[a.id] = 'created'
  const shown = new Set(suggestions.map((a) => normalize(a.description)))
  const ownItems = mine.filter((m) => !shown.has(normalize(m.description)))

  return (
    <div className="flex h-full flex-col">
      <TopBar
        users={users}
        me={me}
        onHome={goHome}
        crumb={(meeting?.legal_name ?? clientName)?.replace(/ (Inc\.|plc|LLC)$/, '') ?? null}
        onSwitch={setUserId}
        onSignOut={() => setUserId(null)}
      />
      {/* One canvas and one scroll: side panels are sticky cards beside the briefing, not separate strips */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {!meeting && clientPage && (
          <ClientPage
            clientId={clientPage}
            userId={userId}
            onCite={setDrawer}
            onOpenMeeting={(id) => {
              const m = meetings.find((x) => x.meeting_id === id)
              if (m) openMeeting(m)
            }}
            onAsk={askAbout}
          />
        )}

        {!meeting && !clientPage && (
          <HomeDashboard
            userId={userId}
            name={me?.name.split(' ')[0] ?? ''}
            onOpenMeeting={(id) => {
              const m = meetings.find((x) => x.meeting_id === id)
              if (m) openMeeting(m)
            }}
            onOpenClient={openClient}
            onAsk={askAbout}
          />
        )}

        {meeting && (
          <div
            className={cn(
              'mx-auto px-6 pb-28 pt-8', // pb-28: room above the hovering ask bar
              rails ? 'flex max-w-[1320px] flex-wrap items-start gap-8 min-[1600px]:max-w-[1640px]' : 'max-w-3xl',
            )}
          >
            {rails && (
              // wide screens only: an index of the briefing in the otherwise empty left margin
              <div className="hidden w-[210px] shrink-0 min-[1600px]:sticky min-[1600px]:top-6 min-[1600px]:block">
                <BriefingIndex sections={run.sections} />
              </div>
            )}
            <main className="min-w-0 flex-[999_1_600px]">
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
                onAsk={() => askAbout(meeting.client_id)}
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
                    <div className="space-y-6">
                      <div id={FIGURES_ANCHOR} className="scroll-mt-6">
                        <KeyFigures figures={run.figures} loading={run.status === 'running'} onCite={setDrawer} />
                      </div>
                      {SECTION_ORDER.map((s) => (
                        <SectionCard
                          key={s.key}
                          title={s.title}
                          anchor={s.key}
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
              // one prep panel: stays in view while reading, its own quiet scroll, no competing columns
              <div className="rail max-w-full flex-[1_1_360px] min-[1100px]:sticky min-[1100px]:top-6 min-[1100px]:max-h-[calc(100vh-7rem)] min-[1100px]:overflow-y-auto">
                <AttentionPanel
                  briefing={run.briefing}
                  running={run.status === 'running'}
                  actionStates={ticked}
                  onAction={act}
                  onCite={setDrawer}
                  mine={ownItems}
                  onRemoveMine={(id) => api.deleteAction(id, userId).then(refreshMine)}
                  onAdd={addItem}
                />
              </div>
            )}
          </div>
        )}
      </div>

      <ChatWidget
        userId={userId}
        clients={clients}
        currentClientId={chatClient ?? meeting?.client_id ?? clientPage}
        open={chatOpen}
        onOpenChange={setChatOpen}
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
  onAsk,
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
  onAsk: () => void
}) {
  const done = Object.keys(run.sections).length
  const allReviewed = total > 0 && reviewed === total
  const short = meeting.legal_name.replace(/ (Inc\.|plc|LLC)$/, '')
  return (
    <header className="mb-6">
      <div className="flex flex-wrap items-start gap-5">
        <ClientTile clientId={meeting.client_id} name={meeting.legal_name} size="lg" />
        <div className="min-w-0 flex-[1_1_360px]">
          <p className="text-[13px] text-slate-600">
            <strong className="font-semibold text-slate-900">{formatMeetingTime(meeting.start_time)}</strong> ·{' '}
            {meeting.purpose}
          </p>
          <h1 className="mt-1.5 text-[30px] font-bold leading-tight tracking-tight text-slate-900">
            {meeting.legal_name}
          </h1>
          <Attendees names={meeting.client_attendees} contacts={run.exhibits.contacts} />
        </div>
        <div className="flex gap-2">
          {run.status === 'done' && (
            <button
              onClick={onCopy}
              title={copied ? 'Copied' : allReviewed ? 'Copy the reviewed briefing' : 'Copy as markdown (rejected claims left out)'}
              aria-label="Copy briefing"
              className="grid h-11 w-11 place-items-center rounded-[10px] border border-slate-300 bg-white text-slate-700 transition hover:bg-slate-100"
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                {copied ? (
                  <path d="M5 12l5 5L20 7" />
                ) : (
                  <>
                    <rect x="9" y="9" width="12" height="12" rx="2" />
                    <path d="M5 15V5a2 2 0 0 1 2-2h8" />
                  </>
                )}
              </svg>
            </button>
          )}
          <button
            onClick={onAsk}
            className="inline-flex h-11 items-center gap-2 rounded-[10px] border border-slate-300 bg-white px-4 text-[14px] font-medium text-slate-900 transition hover:bg-slate-100"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" />
            </svg>
            Ask about {short}
          </button>
        </div>
      </div>

      <div className="mt-6 flex flex-wrap items-end justify-between gap-3 border-b border-slate-200">
        <div role="tablist" aria-label="Briefing views" className="flex gap-6">
          {(['briefing', 'notes'] as const).map((v) => (
            <button
              key={v}
              role="tab"
              aria-selected={view === v}
              onClick={() => onView(v)}
              className={cn(
                '-mb-px inline-flex h-11 items-center gap-2 border-b-2 text-[14px] transition',
                view === v ? 'border-slate-900 font-semibold text-slate-900' : 'border-transparent font-medium text-slate-600 hover:text-slate-900',
              )}
            >
              {v === 'briefing' ? 'Briefing' : 'After the meeting'}
              {v === 'briefing' && run.status === 'done' && total > 0 && (
                <span className={cn('text-[12px] font-medium tabular-nums', allReviewed ? 'text-emerald-700' : 'text-slate-500')}>
                  {allReviewed ? 'All reviewed' : `${reviewed}/${total} reviewed`}
                </span>
              )}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1 pb-1">
          {run.status === 'done' && view === 'briefing' && (
            <HistoryMenu
              label={run.savedAt ? `Prepared ${timeAgo(run.savedAt)}` : `Prepared in ${run.seconds?.toFixed(1)}s`}
              items={history}
              currentId={run.briefingId}
              onOpen={onOpenVersion}
            />
          )}
          {run.status === 'running' && (
            <span className="inline-flex h-9 items-center gap-2 px-2 text-[13px] text-slate-600">
              <Spinner className="h-3.5 w-3.5" /> Preparing · {done} of 7
            </span>
          )}
          {run.status === 'done' && !run.stale && view === 'briefing' && (
            <button
              onClick={onPrepare}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-medium text-slate-600 transition hover:bg-slate-100 hover:text-slate-900"
            >
              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M20 11a8 8 0 1 0-2.3 5.7" />
                <path d="M20 4v7h-7" />
              </svg>
              Regenerate
            </button>
          )}
        </div>
      </div>

      {run.status === 'done' && run.stale && view === 'briefing' && (
        <div role="status" className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-3 rounded-xl border border-amber-200 bg-amber-50 py-3 pl-4 pr-3">
          <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0 text-amber-700" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 3l9.5 17h-19z" />
            <path d="M12 10v4" />
            <path d="M12 17.5v.01" />
          </svg>
          <p className="flex-[1_1_280px] text-[14px] leading-snug text-amber-900">
            <strong className="font-semibold">Source data changed since this was prepared.</strong> Regenerate to use the
            latest records.
          </p>
          <button
            onClick={onPrepare}
            className="inline-flex h-11 items-center gap-2 rounded-[10px] bg-slate-900 px-4 text-[14px] font-semibold text-white transition hover:bg-slate-800"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M20 11a8 8 0 1 0-2.3 5.7" />
              <path d="M20 4v7h-7" />
            </svg>
            Regenerate
          </button>
        </div>
      )}
    </header>
  )
}

function IdleState({ onPrepare }: { onPrepare: () => void }) {
  return (
    <div className={cn(CARD, 'grid place-items-center px-6 py-16 text-center')}>
      <Logo size={44} />
      <p className="mt-4 max-w-sm text-[14px] text-slate-600">
        Seven sections, every sentence cited and checked against its source. About ten seconds.
      </p>
      <button
        onClick={onPrepare}
        className="mt-5 inline-flex h-11 items-center gap-2 rounded-[10px] bg-slate-900 px-5 text-[14px] font-semibold text-white transition hover:bg-slate-800"
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

