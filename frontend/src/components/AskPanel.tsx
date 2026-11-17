// UI-13: ask anything about this client (API-14, ORC-15). Answers go through the briefing pipeline,
// so they carry inline citations and the same verification tags, or say what the data lacks.
import { useState } from 'react'
import { ApiError, api, type AskAnswer } from '../api'
import type { Citation } from '../types'
import { SectionCard } from './SectionCard'
import { readable } from './ui'

const SUGGESTIONS = [
  'What has the client asked for recently?',
  'What are we overdue on?',
  'Who are the key decision makers?',
  'What changed since the last meeting?',
]

type Turn = { id: number; question: string; answer?: AskAnswer; error?: string; seconds?: number }

export function AskPanel({ clientId, userId, onCite }: { clientId: string; userId: string; onCite: (c: Citation) => void }) {
  const [text, setText] = useState('')
  const [turns, setTurns] = useState<Turn[]>([])
  const busy = turns.some((t) => !t.answer && !t.error)

  async function ask(question: string) {
    const q = question.trim()
    if (!q || busy) return
    const id = Date.now()
    const started = performance.now()
    setText('')
    setTurns((ts) => [{ id, question: q }, ...ts])
    try {
      const answer = await api.ask(clientId, userId, q)
      const seconds = (performance.now() - started) / 1000
      setTurns((ts) => ts.map((t) => (t.id === id ? { ...t, answer, seconds } : t)))
    } catch (e) {
      setTurns((ts) => ts.map((t) => (t.id === id ? { ...t, error: (e as ApiError).message } : t)))
    }
  }

  return (
    <div className="space-y-5">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          ask(text)
        }}
        className="rounded-2xl bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.03),0_12px_32px_-16px_rgba(15,23,42,0.12)] ring-1 ring-slate-900/[0.05]"
      >
        <div className="flex items-center gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 text-white">
            <svg viewBox="0 0 20 20" className="h-4.5 w-4.5" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
              <path d="M4 15.5V5.5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H7.5L4 15.5Z" strokeLinejoin="round" />
              <path d="M7.5 7.5h5M7.5 10h3" strokeLinecap="round" />
            </svg>
          </span>
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Ask anything about this client"
            aria-label="Ask a question about this client"
            className="h-10 flex-1 bg-transparent text-[15px] text-slate-800 outline-none placeholder:text-slate-400"
          />
          <button
            type="submit"
            disabled={!text.trim() || busy}
            className="rounded-full bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-500 disabled:opacity-40"
          >
            Ask
          </button>
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5 pl-12">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              type="button"
              disabled={busy}
              onClick={() => ask(s)}
              className="rounded-full px-2.5 py-1 text-[12px] text-slate-500 ring-1 ring-slate-200 transition hover:bg-indigo-50 hover:text-indigo-700 hover:ring-indigo-200 disabled:opacity-40"
            >
              {s}
            </button>
          ))}
        </div>
        <p className="mt-3 pl-12 text-[11.5px] text-slate-400">
          Answers use only sources you are cleared for, are cited inline and checked like the briefing.
        </p>
      </form>

      {turns.map((t) => (
        <div key={t.id} className="space-y-2">
          {t.error ? (
            <p className="rounded-xl bg-rose-50 p-4 text-sm text-rose-700">
              <span className="font-medium">{t.question}</span>
              <br />
              {t.error}
            </p>
          ) : (
            <>
              <SectionCard title={t.question} section={t.answer?.section} reviews={{}} onCite={onCite} />
              {t.answer && (
                <div className="space-y-1.5 px-2">
                  {t.answer.unknowns.map((u) => (
                    <p key={u.question} className="flex gap-2 text-[13px] text-slate-500">
                      <svg viewBox="0 0 20 20" className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
                        <path d="M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0Z" />
                        <path d="M8 8a2 2 0 1 1 2.8 1.8c-.5.2-.8.7-.8 1.2v.5M10 14h.01" strokeLinecap="round" />
                      </svg>
                      <span>
                        <span className="font-medium text-slate-600">Not in the data:</span> {readable(u.question)}
                      </span>
                    </p>
                  ))}
                  {t.answer.access_limited && (
                    <p className="text-[12px] text-slate-400">Some sources are restricted for your profile.</p>
                  )}
                  {t.seconds !== undefined && (
                    <p className="text-[11.5px] text-slate-400">Answered in {t.seconds.toFixed(1)}s</p>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      ))}
    </div>
  )
}
