// UI-13: floating chat on every page (API-14, ORC-15). Each answer goes through the briefing
// pipeline, so it carries inline citations and Verified / Check sources tags, or says what the data
// lacks. Conversations are kept per client while the app is open.
import { useEffect, useRef, useState } from 'react'
import { ApiError, api, type AskAnswer, type ClientSearch } from '../api'
import type { Citation } from '../types'
import { ClaimText, VerificationTag } from './SectionCard'
import { cn, readable } from './ui'

export const ALL = '*' // scope: every client the viewer covers (agentic search, API-20)

const ALL_SUGGESTIONS = [
  'Which client has a term loan?',
  'Where are we overdue across my clients?',
  'Which facilities mature in the next 12 months?',
]

const SUGGESTIONS = [
  'What has the client asked for recently?',
  'What are we overdue on?',
  'Who are the key decision makers?',
  'What changed since the last meeting?',
]

type Turn = { id: number; question: string; answer?: AskAnswer; error?: string; seconds?: number }

interface Props {
  userId: string
  clients: { client_id: string; name: string }[]
  currentClientId: string | null // the briefing on screen, or the client asked about
  open: boolean // opened by the "Ask about ..." buttons
  onOpenChange: (open: boolean) => void
  onCite: (c: Citation) => void
  prompt?: { question: string; scope: string; id: number } | null // asked for the user (Home "try" card)
}

export function ChatWidget({ userId, clients, currentClientId, open, onOpenChange, onCite, prompt }: Props) {
  const setOpen = onOpenChange
  const [clientId, setClientId] = useState<string>(currentClientId ?? ALL)
  const [threads, setThreads] = useState<Record<string, Turn[]>>({})
  const [text, setText] = useState('')
  const [detected, setDetected] = useState<ClientSearch['results'][number] | null>(null) // named in the text
  const scroller = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null)

  // follow the page: opening a briefing points the chat at that client
  useEffect(() => {
    if (currentClientId) setClientId(currentClientId)
  }, [currentClientId])
  // a new profile starts with no conversations
  useEffect(() => {
    setThreads({})
    setClientId(currentClientId ?? ALL)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId])

  const client = clients.find((c) => c.client_id === clientId)
  const isAll = clientId === ALL
  const turns = threads[clientId] ?? []
  const busy = turns.some((t) => !t.answer && !t.error)

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' })
  }, [turns.length, busy])

  useEffect(() => {
    if (!open) return
    input.current?.focus()
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [open])

  /** The one covered client a question names ("What is overdue for NWL?"), via API-13, or null. */
  async function clientNamedIn(question: string): Promise<ClientSearch['results'][number] | null> {
    if (question.trim().length < 3) return null
    const { results } = await api.searchClients(userId, question)
    return results.length === 1 ? results[0] : null
  }

  // Search while typing: show which client the question is about before it is sent.
  useEffect(() => {
    let live = true
    const t = setTimeout(() => clientNamedIn(text).then((c) => live && setDetected(c)), 250)
    return () => {
      live = false
      clearTimeout(t)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, userId])

  async function ask(question: string, scope?: string) {
    const q = question.trim()
    if (!q || busy) return
    // a client named in the question wins; otherwise the scope chosen (one client, or all of them)
    const named = detected ?? (await clientNamedIn(q))
    const cid = named?.client_id ?? scope ?? clientId
    setClientId(cid)
    const id = Date.now()
    const started = performance.now()
    const update = (patch: Partial<Turn>) =>
      setThreads((th) => ({ ...th, [cid]: (th[cid] ?? []).map((t) => (t.id === id ? { ...t, ...patch } : t)) }))
    setText('')
    setThreads((th) => ({ ...th, [cid]: [...(th[cid] ?? []), { id, question: q }] }))
    try {
      const answer = cid === ALL ? await api.askAll(userId, q) : await api.ask(cid, userId, q)
      update({ answer, seconds: (performance.now() - started) / 1000 })
    } catch (e) {
      update({ error: (e as ApiError).message })
    }
  }

  // a question asked on the user's behalf: open the panel and ask it in the given scope
  useEffect(() => {
    if (!prompt) return
    setOpen(true)
    ask(prompt.question, prompt.scope)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prompt?.id])

  if (!open) {
    // a hovering ask bar at the bottom of every page; the panel opens in the same place
    return (
      <button
        onClick={() => setOpen(true)}
        className={cn(SURFACE, 'flex items-center gap-3 rounded-full bg-white/95 py-2 pl-2 pr-5 text-left backdrop-blur transition hover:-translate-y-0.5 hover:border-slate-300')}
      >
        <InkDot />
        <span className="flex-1 truncate text-[14px] text-slate-500">
          {client ? `Ask anything about ${shortName(client.name)}` : 'Ask across all the clients you cover'}
        </span>
        <span className="text-[12px] font-medium text-slate-400">Cited answers</span>
      </button>
    )
  }

  return (
    <section
      role="dialog"
      aria-label="Ask about a client"
      className={cn(SURFACE, 'rise flex h-[620px] bg-white max-h-[calc(100vh-7rem)] flex-col overflow-hidden rounded-[28px]')}
    >
      <header className="flex items-center gap-3 border-b border-slate-100 py-2 pl-2 pr-3">
        <InkDot />
        <span className="flex min-w-0 flex-1 items-center gap-1.5">
          <span className="shrink-0 text-[14px] text-slate-500">Ask about</span>
          <ClientPicker userId={userId} clients={clients} value={clientId} onChange={setClientId} />
        </span>
        <button
          onClick={() => setOpen(false)}
          aria-label="Minimize chat"
          title="Minimize"
          className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
        >
          <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
            <path d="M5 10h10" strokeLinecap="round" />
          </svg>
        </button>
      </header>

      <div ref={scroller} className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
        {turns.length === 0 && (
          <div className="pt-6 text-center">
            <p className="text-sm font-medium text-slate-700">
              {client ? `Ask anything about ${shortName(client.name)}` : 'Ask across all the clients you cover'}
            </p>
            <p className="mx-auto mt-1 max-w-[280px] text-[12px] leading-snug text-slate-400">
              Answers use only sources you are cleared for, are cited inline and checked like the briefing.
            </p>
            <div className="mt-5 flex flex-col items-center gap-1.5">
                {(isAll ? ALL_SUGGESTIONS : SUGGESTIONS).map((s) => (
                  <button
                    key={s}
                    onClick={() => ask(s)}
                    className="rounded-full bg-white px-3 py-1.5 text-[12.5px] text-slate-600 ring-1 ring-slate-200 transition hover:bg-indigo-50 hover:text-indigo-700 hover:ring-indigo-200"
                  >
                    {s}
                  </button>
                ))}
            </div>
          </div>
        )}

        {turns.map((t) => (
          <div key={t.id} className="space-y-2">
            <div className="flex justify-end">
              <p className={USER_BUBBLE}>{t.question}
              </p>
            </div>
            <Answer turn={t} onCite={onCite} />
          </div>
        ))}
      </div>

      {detected && detected.client_id !== clientId && (
        <div className="flex items-center gap-1.5 border-t border-slate-100 bg-indigo-50/60 px-4 py-1.5 text-[12px] text-indigo-700">
          <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M9 15A6 6 0 1 0 9 3a6 6 0 0 0 0 12Zm8 2-3.8-3.8" strokeLinecap="round" />
          </svg>
          About <span className="font-semibold">{detected.name}</span>
          {detected.matched_alias && <span className="text-indigo-400">(from "{detected.matched_alias}")</span>}
        </div>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault()
          ask(text)
        }}
        className="m-2.5 flex items-center gap-2 rounded-full border border-slate-200 bg-white py-1.5 pl-5 pr-1.5 transition focus-within:border-slate-400"
      >
        <input
          ref={input}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={client ? 'Ask a question' : 'Ask across your clients, e.g. which has a term loan?'}
          aria-label="Your question"
          className="h-9 min-w-0 flex-1 bg-transparent text-[14px] text-slate-800 outline-none placeholder:text-slate-400"
        />
        <button
          type="submit"
          disabled={!text.trim() || busy}
          aria-label="Send"
          className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-slate-900 text-white transition hover:bg-slate-800 disabled:opacity-40"
        >
          <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M4 10h11m-4.5-4.5L15 10l-4.5 4.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </form>
    </section>
  )
}

function Answer({ turn: t, onCite }: { turn: Turn; onCite: (c: Citation) => void }) {
  if (t.error) {
    return <p className="max-w-[92%] rounded-[20px] rounded-bl-md bg-rose-50 px-4 py-2.5 text-[13px] text-rose-700">{t.error}</p>
  }
  if (!t.answer) {
    return (
      <div className="inline-flex items-center gap-2 rounded-[20px] rounded-bl-md bg-slate-50 px-4 py-2.5 text-[12.5px] text-slate-500 ring-1 ring-slate-200/70">
        <span className="flex gap-1">
          {[0, 1, 2].map((i) => (
            <span key={i} className="h-1.5 w-1.5 animate-bounce rounded-full bg-indigo-400" style={{ animationDelay: `${i * 120}ms` }} />
          ))}
        </span>
        Checking sources
      </div>
    )
  }
  const { claims } = t.answer.section
  const verified = claims.filter((c) => c.status === 'verified').length
  return (
    <div className="max-w-[92%] space-y-2.5 rounded-[20px] rounded-bl-md bg-slate-50 px-4 py-3 ring-1 ring-slate-200/70">
      {t.answer.steps && t.answer.steps.length > 0 && (
        <p className="text-[11.5px] text-slate-400">Looked at: {t.answer.steps.join(' · ')}</p>
      )}
      {t.answer.explanation && (
        <div>
          <p className="text-[13.5px] leading-relaxed text-slate-700">{t.answer.explanation}</p>
          <p className="mt-1 text-[11.5px] text-slate-400">
            {t.answer.explanation_source === 'glossary' ? 'From the Briefing Desk guide' : 'General explanation, not from client records'}
          </p>
        </div>
      )}
      {claims.map((c) => (
        <div key={c.id} className="group/claim">
          <p className="text-[13.5px] leading-relaxed text-slate-700">
            <ClaimText claim={c} onCite={onCite} after={<VerificationTag status={c.status} />} />
          </p>
        </div>
      ))}
      {t.answer.unknowns.map((u) => (
        <p key={u.question} className="text-[12.5px] leading-snug text-slate-500">
          <span className="font-medium text-slate-600">Not in the data:</span> {readable(u.question)}
        </p>
      ))}
      {claims.length === 0 && t.answer.unknowns.length === 0 && !t.answer.explanation && (
        <p className="text-[13px] text-slate-500">Nothing in the sources answers this.</p>
      )}
      <p className={cn('border-t border-slate-100 pt-2 text-[11px] text-slate-400', claims.length === 0 && t.answer.explanation && 'hidden')}>
        {claims.length > 0 && `${verified}/${claims.length} verified · `}
        {t.seconds !== undefined && `${t.seconds.toFixed(1)}s`}
        {t.answer.access_limited && ' · some sources restricted for your profile'}
      </p>
    </div>
  )
}

/** "Switch client" pill with a searchable menu that scales to hundreds of clients: type a name or an
 * alias (API-13, so "NWL" finds Northwind), the list scrolls, Enter picks the first match. */
function ClientPicker({
  userId,
  clients,
  value,
  onChange,
}: {
  userId: string
  clients: Props['clients']
  value: string
  onChange: (clientId: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [aliasHits, setAliasHits] = useState<string[]>([])
  const ref = useRef<HTMLSpanElement>(null)
  const current = clients.find((c) => c.client_id === value)
  const q = query.trim().toLowerCase()
  const shown = q ? clients.filter((c) => c.name.toLowerCase().includes(q) || aliasHits.includes(c.client_id)) : clients

  function pick(clientId: string) {
    onChange(clientId)
    setOpen(false)
    setQuery('')
  }

  // aliases and short names come from the same search the rest of the app uses
  useEffect(() => {
    if (!q) return setAliasHits([])
    let live = true
    const t = setTimeout(() => api.searchClients(userId, q).then((r) => live && setAliasHits(r.results.map((x) => x.client_id))), 200)
    return () => {
      live = false
      clearTimeout(t)
    }
  }, [q, userId])

  useEffect(() => {
    if (!open) return setQuery('')
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation() // close the menu, not the chat
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', close)
    window.addEventListener('keydown', esc, true)
    return () => {
      document.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', esc, true)
    }
  }, [open])

  return (
    <span ref={ref} className="relative block min-w-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Client"
        title="Switch client"
        className="inline-flex max-w-full items-center gap-1.5 rounded-full py-1 pl-2.5 pr-2 text-left transition hover:bg-slate-100"
      >
        <span className="truncate text-[14px] font-semibold leading-tight text-slate-900">{current ? current.name : 'All my clients'}</span>
        <svg viewBox="0 0 20 20" className="h-3.5 w-3.5 shrink-0 text-slate-400" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M6.5 7.5 10 4l3.5 3.5M6.5 12.5 10 16l3.5-3.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <span
          role="listbox"
          aria-label="Clients"
          className="absolute left-0 top-full z-10 mt-2 block w-80 overflow-hidden rounded-xl bg-white text-slate-800 shadow-2xl ring-1 ring-slate-900/10"
        >
          <span className="block border-b border-slate-100 p-2">
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && shown[0] && pick(shown[0].client_id)}
              placeholder={`Search ${clients.length} clients or an alias`}
              aria-label="Search clients"
              className="h-9 w-full rounded-full bg-slate-100 px-3.5 text-[13.5px] outline-none placeholder:text-slate-400 focus:bg-white focus:ring-1 focus:ring-slate-300"
            />
          </span>
          <span className="block max-h-72 overflow-y-auto py-1.5">
            {!q && (
            <button
              type="button"
              role="option"
              aria-selected={value === ALL}
              onClick={() => pick(ALL)}
              className={cn('flex w-full items-center gap-3 border-b border-slate-100 px-3 py-2 text-left text-[13.5px] transition hover:bg-indigo-50', value === ALL && 'bg-indigo-50/60')}
            >
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-slate-900 text-white">
                <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="currentColor" aria-hidden="true">
                  <rect x="3" y="3" width="6" height="6" rx="1.5" /><rect x="11" y="3" width="6" height="6" rx="1.5" />
                  <rect x="3" y="11" width="6" height="6" rx="1.5" /><rect x="11" y="11" width="6" height="6" rx="1.5" />
                </svg>
              </span>
              <span className="flex-1">
                <span className="block font-medium">All my clients</span>
                <span className="block text-[12px] text-slate-500">Searches across your book</span>
              </span>
            </button>
          )}
          {shown.length === 0 && <span className="block px-3 py-2 text-[13px] text-slate-500">No client you cover matches</span>}
            {shown.map((c) => {
              const selected = c.client_id === value
              return (
                <button
                  key={c.client_id}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  onClick={() => pick(c.client_id)}
                  className={cn(
                    'flex w-full items-center gap-3 px-3 py-2 text-left text-[13.5px] transition hover:bg-indigo-50',
                    selected && 'bg-indigo-50/60',
                  )}
                >
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-indigo-50 text-[10.5px] font-semibold text-indigo-700">
                    {initials(c.name)}
                  </span>
                  <span className="flex-1 truncate font-medium">{c.name}</span>
                  {selected && (
                    <svg viewBox="0 0 20 20" className="h-4 w-4 text-indigo-600" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
                      <path d="M5 10.5 8.5 14 15 6" />
                    </svg>
                  )}
                </button>
              )
            })}
            </span>
        </span>
      )}
    </span>
  )
}

function initials(name: string): string {
  return shortName(name)
    .split(' ')
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
}

function shortName(name: string): string {
  return name.replace(/ (Inc\.|plc|LLC)$/, '')
}

/** The bar and the open panel share one surface: white, hairline border, soft warm shadow. */
const SURFACE =
  'fixed bottom-5 left-1/2 z-30 w-[min(560px,calc(100vw-48px))] -translate-x-1/2 border border-slate-200 shadow-[0_12px_32px_-12px_rgba(26,24,20,0.35)]'

const USER_BUBBLE = 'max-w-[85%] rounded-[20px] rounded-br-md bg-slate-900 px-4 py-2 text-[13.5px] leading-snug text-white'

function InkDot() {
  return (
    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-slate-900 text-white">
      <ChatIcon className="h-4.5 w-4.5" />
    </span>
  )
}

function ChatIcon({ className }: { className: string }) {
  return (
    <svg viewBox="0 0 20 20" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M4 15.5V5.5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H7.5L4 15.5Z" strokeLinejoin="round" />
      <path d="M7.5 7.5h5M7.5 10h3" strokeLinecap="round" />
    </svg>
  )
}
