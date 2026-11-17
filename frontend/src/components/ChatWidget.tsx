// UI-13: floating chat on every page (API-14, ORC-15). Each answer goes through the briefing
// pipeline, so it carries inline citations and Verified / Check sources tags, or says what the data
// lacks. Conversations are kept per client while the app is open.
import { useEffect, useRef, useState } from 'react'
import { ApiError, api, type AskAnswer, type ClientSearch } from '../api'
import type { Citation } from '../types'
import { ClaimText, VerificationTag } from './SectionCard'
import { cn, readable } from './ui'

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
  currentClientId: string | null // the briefing on screen, if any
  onCite: (c: Citation) => void
}

export function ChatWidget({ userId, clients, currentClientId, onCite }: Props) {
  const [open, setOpen] = useState(false)
  const [clientId, setClientId] = useState<string | null>(currentClientId)
  const [threads, setThreads] = useState<Record<string, Turn[]>>({})
  const [text, setText] = useState('')
  const [pending, setPending] = useState<string | null>(null) // asked before a client was chosen
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
    setClientId(currentClientId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId])

  const client = clients.find((c) => c.client_id === clientId)
  const turns = clientId ? (threads[clientId] ?? []) : []
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

  async function ask(question: string, forClient?: string) {
    const q = question.trim()
    if (!q || busy) return
    // a client named in the question wins; then the one in view; then ask which
    const named = forClient ? null : (detected ?? (await clientNamedIn(q)))
    const cid = forClient ?? named?.client_id ?? clientId
    if (!cid) {
      setPending(q) // keep the question and ask which client it is about
      setText('')
      return
    }
    setPending(null)
    setClientId(cid)
    const id = Date.now()
    const started = performance.now()
    const update = (patch: Partial<Turn>) =>
      setThreads((th) => ({ ...th, [cid]: (th[cid] ?? []).map((t) => (t.id === id ? { ...t, ...patch } : t)) }))
    setText('')
    setThreads((th) => ({ ...th, [cid]: [...(th[cid] ?? []), { id, question: q }] }))
    try {
      const answer = await api.ask(cid, userId, q)
      update({ answer, seconds: (performance.now() - started) / 1000 })
    } catch (e) {
      update({ error: (e as ApiError).message })
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-6 right-6 z-30 inline-flex items-center gap-2.5 rounded-full bg-gradient-to-br from-indigo-600 to-violet-600 py-3 pl-4 pr-5 text-sm font-semibold text-white shadow-[0_12px_32px_-8px_rgba(79,70,229,0.6)] transition hover:-translate-y-0.5 hover:shadow-[0_16px_40px_-8px_rgba(79,70,229,0.7)]"
      >
        <ChatIcon className="h-5 w-5" />
        {client ? `Ask about ${shortName(client.name)}` : 'Ask'}
      </button>
    )
  }

  return (
    <section
      role="dialog"
      aria-label="Ask about a client"
      className="rise fixed bottom-6 right-6 z-30 flex h-[620px] max-h-[calc(100vh-7rem)] w-[420px] flex-col overflow-hidden rounded-2xl bg-white shadow-[0_24px_64px_-12px_rgba(15,23,42,0.35)] ring-1 ring-slate-900/10"
    >
      <header className="flex items-center gap-3 bg-gradient-to-br from-indigo-600 to-violet-600 px-4 py-3 text-white">
        <span className="grid h-8 w-8 place-items-center rounded-xl bg-white/15">
          <ChatIcon className="h-4.5 w-4.5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[11px] font-medium uppercase tracking-wider text-indigo-100">Ask about</span>
          <select
            value={clientId ?? ''}
            onChange={(e) => setClientId(e.target.value || null)}
            aria-label="Client"
            className="-ml-1 max-w-full cursor-pointer truncate rounded-md bg-transparent px-1 text-[15px] font-semibold text-white outline-none hover:bg-white/10"
          >
            {!clientId && <option value="">Choose a client</option>}
            {clients.map((c) => (
              <option key={c.client_id} value={c.client_id} className="text-slate-900">
                {c.name}
              </option>
            ))}
          </select>
        </span>
        <button
          onClick={() => setOpen(false)}
          aria-label="Close chat"
          className="grid h-8 w-8 place-items-center rounded-full text-indigo-100 transition hover:bg-white/15 hover:text-white"
        >
          <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
            <path d="M5 8l5 5 5-5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </header>

      <div ref={scroller} className="flex-1 space-y-4 overflow-y-auto bg-slate-50/60 px-4 py-4">
        {pending && (
          <div className="flex justify-end">
            <p className="max-w-[85%] rounded-2xl rounded-br-md bg-indigo-600 px-3.5 py-2 text-[13.5px] leading-snug text-white">
              {pending}
            </p>
          </div>
        )}
        {turns.length === 0 && (
          <div className={cn('text-center', pending ? 'pt-1' : 'pt-6')}>
            <p className="text-sm font-medium text-slate-700">
              {pending
                ? 'Which client is this about?'
                : client
                  ? `Ask anything about ${shortName(client.name)}`
                  : 'Ask about any client you cover'}
            </p>
            <p className="mx-auto mt-1 max-w-[280px] text-[12px] leading-snug text-slate-400">
              Answers use only sources you are cleared for, are cited inline and checked like the briefing.
            </p>
            {!client && (
              <div className="mt-5 flex flex-col items-center gap-1.5">
                {clients.map((c) => (
                  <button
                    key={c.client_id}
                    onClick={() => (pending ? ask(pending, c.client_id) : setClientId(c.client_id))}
                    className="rounded-full bg-white px-3.5 py-1.5 text-[13px] font-medium text-slate-700 ring-1 ring-slate-200 transition hover:bg-indigo-50 hover:text-indigo-700 hover:ring-indigo-200"
                  >
                    {c.name}
                  </button>
                ))}
              </div>
            )}
            {client && (
              <div className="mt-5 flex flex-col items-center gap-1.5">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => ask(s)}
                    className="rounded-full bg-white px-3 py-1.5 text-[12.5px] text-slate-600 ring-1 ring-slate-200 transition hover:bg-indigo-50 hover:text-indigo-700 hover:ring-indigo-200"
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {turns.map((t) => (
          <div key={t.id} className="space-y-2">
            <div className="flex justify-end">
              <p className="max-w-[85%] rounded-2xl rounded-br-md bg-indigo-600 px-3.5 py-2 text-[13.5px] leading-snug text-white">
                {t.question}
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
        className="flex items-center gap-2 border-t border-slate-100 bg-white px-3 py-3"
      >
        <input
          ref={input}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={client ? 'Ask a question' : 'Ask a question, e.g. what is overdue for Northwind?'}
          aria-label="Your question"
          className="h-10 flex-1 rounded-xl bg-slate-100/80 px-3.5 text-[14px] text-slate-800 outline-none ring-1 ring-transparent transition placeholder:text-slate-400 focus:bg-white focus:ring-indigo-300 disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={!text.trim() || busy}
          aria-label="Send"
          className="grid h-10 w-10 place-items-center rounded-xl bg-indigo-600 text-white transition hover:bg-indigo-500 disabled:opacity-40"
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
    return <p className="max-w-[92%] rounded-2xl rounded-bl-md bg-rose-50 px-3.5 py-2.5 text-[13px] text-rose-700">{t.error}</p>
  }
  if (!t.answer) {
    return (
      <div className="inline-flex items-center gap-2 rounded-2xl rounded-bl-md bg-white px-3.5 py-2.5 text-[12.5px] text-slate-500 ring-1 ring-slate-200/70">
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
    <div className="max-w-[92%] space-y-2.5 rounded-2xl rounded-bl-md bg-white px-3.5 py-3 ring-1 ring-slate-200/70">
      {claims.map((c) => (
        <div key={c.id}>
          <p className="text-[13.5px] leading-relaxed text-slate-700">
            <ClaimText claim={c} onCite={onCite} />
          </p>
          <div className="mt-0.5">
            <VerificationTag status={c.status} />
          </div>
        </div>
      ))}
      {t.answer.unknowns.map((u) => (
        <p key={u.question} className="text-[12.5px] leading-snug text-slate-500">
          <span className="font-medium text-slate-600">Not in the data:</span> {readable(u.question)}
        </p>
      ))}
      {claims.length === 0 && t.answer.unknowns.length === 0 && (
        <p className="text-[13px] text-slate-500">Nothing in the sources answers this.</p>
      )}
      <p className={cn('border-t border-slate-100 pt-2 text-[11px] text-slate-400')}>
        {claims.length > 0 && `${verified}/${claims.length} verified · `}
        {t.seconds !== undefined && `${t.seconds.toFixed(1)}s`}
        {t.answer.access_limited && ' · some sources restricted for your profile'}
      </p>
    </div>
  )
}

function shortName(name: string): string {
  return name.replace(/ (Inc\.|plc|LLC)$/, '')
}

function ChatIcon({ className }: { className: string }) {
  return (
    <svg viewBox="0 0 20 20" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M4 15.5V5.5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H7.5L4 15.5Z" strokeLinejoin="round" />
      <path d="M7.5 7.5h5M7.5 10h3" strokeLinecap="round" />
    </svg>
  )
}
