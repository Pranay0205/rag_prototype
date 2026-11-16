// UI-8: close the loop. Post-meeting notes -> extracted commitments -> confirmed actions.
import { useState } from 'react'
import { ApiError, api, type Commitment } from '../api'
import { Badge, PanelTitle, Spinner } from './ui'

interface Props {
  clientId: string
  userId: string
}

export function NotesCapture({ clientId, userId }: Props) {
  const [text, setText] = useState('')
  const [items, setItems] = useState<Commitment[] | null>(null)
  const [created, setCreated] = useState<Set<number>>(new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function extract() {
    setBusy(true)
    setError(null)
    setCreated(new Set())
    try {
      setItems(await api.extractCommitments(clientId, userId, text))
    } catch (e) {
      setError((e as ApiError).message)
    } finally {
      setBusy(false)
    }
  }

  async function confirm(i: number, c: Commitment) {
    await api.createAction({
      user_id: userId,
      client_id: clientId,
      kind: 'follow_up',
      description: c.description,
      owner: c.party === 'meridian' ? userId : null,
      due: c.due,
    })
    setCreated((s) => new Set(s).add(i))
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={9}
        placeholder="Paste your meeting notes"
        className="w-full rounded-2xl bg-white p-5 text-[14.5px] leading-relaxed shadow-[0_12px_32px_-16px_rgba(15,23,42,0.12)] outline-none ring-1 ring-slate-900/[0.06] placeholder:text-slate-400 focus:ring-2 focus:ring-indigo-200"
      />
      <button
        onClick={extract}
        disabled={busy || !text.trim()}
        className="inline-flex items-center gap-2 rounded-full bg-indigo-600 px-5 py-2 text-sm font-medium text-white shadow-lg shadow-indigo-600/20 hover:bg-indigo-500 disabled:opacity-40 disabled:shadow-none"
      >
        {busy && <Spinner />}
        Extract commitments
      </button>
      {error && <p className="rounded-md bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}

      {items && (
        <div>
          <PanelTitle count={items.length}>Proposed commitments</PanelTitle>
          {items.length === 0 && <p className="text-sm text-slate-400">No commitments found in these notes.</p>}
          <ul className="space-y-2">
            {items.map((c, i) => (
              <li key={`${i}-${c.description}`} className="rounded-2xl bg-white p-5 shadow-[0_12px_32px_-16px_rgba(15,23,42,0.12)] ring-1 ring-slate-900/[0.04]">
                <div className="flex items-start justify-between gap-3">
                  <p className="font-medium text-slate-800">{c.description}</p>
                  <div className="flex shrink-0 gap-1.5">
                    <Badge tone={c.party === 'meridian' ? 'accent' : 'neutral'}>
                      {c.party === 'meridian' ? 'We owe' : 'Client owes'}
                    </Badge>
                    {c.grounded ? (
                      <Badge tone="good">Found in notes</Badge>
                    ) : (
                      <Badge tone="bad">Not found in notes</Badge>
                    )}
                  </div>
                </div>
                <blockquote className="mt-2 border-l-2 border-slate-200 pl-3 text-sm italic text-slate-500">
                  {c.quote}
                </blockquote>
                <div className="mt-3 flex items-center justify-between">
                  <span className="text-xs text-slate-400">{c.due ? `Due ${c.due}` : 'No due date stated'}</span>
                  {created.has(i) ? (
                    <Badge tone="good">Action created</Badge>
                  ) : (
                    <button
                      onClick={() => confirm(i, c)}
                      disabled={!c.grounded}
                      title={c.grounded ? 'Create a follow-up action' : 'The quote is not in your notes. Check before creating.'}
                      className="rounded-md bg-indigo-600 px-3 py-1 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-40"
                    >
                      Confirm as action
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
