// API-12: past briefings for this meeting's client, newest first. Only the viewer's own versions.
import { useEffect, useRef, useState } from 'react'
import type { HistoryItem } from '../api'
import { cn, formatTime } from './ui'

interface Props {
  label: string
  items: HistoryItem[]
  currentId: string | null
  onOpen: (briefingId: string) => void
}

export function HistoryMenu({ label, items, currentId, onOpen }: Props) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', esc)
    }
  }, [open])

  if (items.length === 0) return <span className="text-xs tabular-nums text-slate-400">{label}</span>

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-1 text-xs tabular-nums text-slate-500 hover:bg-slate-100 hover:text-slate-800"
      >
        {label}
        <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="m6 8 4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-30 mt-2 w-72 overflow-hidden rounded-xl bg-white py-1 shadow-2xl ring-1 ring-slate-900/10"
        >
          <div className="px-4 pb-1 pt-2 text-[11px] font-medium uppercase tracking-[0.12em] text-slate-400">
            Your briefings
          </div>
          {items.map((h, i) => {
            const when = new Date(h.created_at)
            const current = h.briefing_id === currentId
            return (
              <button
                key={h.briefing_id}
                role="menuitem"
                onClick={() => {
                  setOpen(false)
                  onOpen(h.briefing_id)
                }}
                className={cn('flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-slate-50', current && 'bg-indigo-50/60')}
              >
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2 text-sm font-medium text-slate-800">
                    {when.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })} ·{' '}
                    {formatTime(when)}
                    {i === 0 && (
                      <span className="rounded-full bg-slate-100 px-1.5 text-[10px] font-medium text-slate-500">
                        Latest
                      </span>
                    )}
                  </span>
                  <span className="mt-0.5 block text-xs tabular-nums text-slate-400">
                    {h.verified}/{h.claims} verified · {h.conflicts} conflicts
                    {h.stale && <span className="text-amber-600"> · data updated since</span>}
                  </span>
                </span>
                {current && (
                  <svg viewBox="0 0 20 20" className="h-4 w-4 text-indigo-600" fill="none" stroke="currentColor" strokeWidth="2.2">
                    <path d="M5 10.5 8.5 14 15 6" />
                  </svg>
                )}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
