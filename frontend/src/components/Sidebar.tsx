// Dark rail: brand, this week's meetings, and the profile menu (switch profile, data health, sign out).
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { Meeting, User } from '../api'
import { DataHealthDialog } from './DataHealthDialog'
import { Avatar, Logo, Wordmark, cn } from './ui'

interface Props {
  users: User[]
  me: User | undefined
  meetings: Meeting[]
  selectedId: string | null
  onSelect: (meeting: Meeting) => void
  onSwitch: (userId: string) => void
  onSignOut: () => void
}

export function Sidebar({ users, me, meetings, selectedId, onSelect, onSwitch, onSignOut }: Props) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [healthOpen, setHealthOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menuOpen) return
    const close = (e: MouseEvent) => !menuRef.current?.contains(e.target as Node) && setMenuOpen(false)
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [menuOpen])

  return (
    <aside className="flex w-64 shrink-0 flex-col bg-slate-950 text-slate-300">
      <div className="flex items-center gap-2.5 px-5 pb-6 pt-5">
        <Logo size={28} />
        <Wordmark dark />
      </div>

      <div className="px-5 pb-2 text-[11px] font-medium uppercase tracking-[0.12em] text-slate-500">This week</div>
      <nav className="flex-1 space-y-1 overflow-y-auto px-3">
        {meetings.map((m) => {
          const active = m.meeting_id === selectedId
          const when = new Date(m.start_time)
          return (
            <button
              key={m.meeting_id}
              onClick={() => onSelect(m)}
              className={cn(
                'flex w-full items-center gap-3 rounded-lg px-2.5 py-2.5 text-left transition',
                active ? 'bg-white/10 text-white' : 'hover:bg-white/5',
              )}
            >
              <span
                className={cn(
                  'flex w-10 shrink-0 flex-col items-center rounded-md py-1 leading-none',
                  active ? 'bg-indigo-500 text-white' : 'bg-white/5 text-slate-400',
                )}
              >
                <span className="text-[10px] uppercase">{when.toLocaleDateString('en-GB', { weekday: 'short' })}</span>
                <span className="mt-0.5 text-base font-semibold">{when.getDate()}</span>
              </span>
              <span className="min-w-0">
                <span className={cn('block truncate text-sm font-medium', active ? 'text-white' : 'text-slate-200')}>
                  {m.legal_name.replace(/ (Inc\.|plc|LLC)$/, '')}
                </span>
                <span className="block text-xs text-slate-500">
                  {when.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                </span>
              </span>
            </button>
          )
        })}
      </nav>

      {me && (
        <div ref={menuRef} className="relative border-t border-white/5 p-3">
          {menuOpen && (
            <div className="absolute bottom-full left-3 right-3 mb-2 overflow-hidden rounded-xl bg-white text-slate-700 shadow-2xl ring-1 ring-black/5">
              <div className="border-b border-slate-100 px-4 py-3">
                <div className="text-sm font-semibold text-slate-900">{me.name}</div>
                <div className="text-xs text-slate-500">
                  {me.title} · {me.clearance}
                </div>
              </div>
              <div className="py-1">
                <div className="px-4 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wider text-slate-400">
                  Switch profile
                </div>
                {users
                  .filter((u) => u.user_id !== me.user_id)
                  .map((u) => (
                    <MenuItem
                      key={u.user_id}
                      onClick={() => {
                        setMenuOpen(false)
                        onSwitch(u.user_id)
                      }}
                    >
                      <Avatar name={u.name} size="sm" />
                      <span>
                        <span className="block text-sm">{u.name}</span>
                        <span className="block text-xs text-slate-400">{u.clearance}</span>
                      </span>
                    </MenuItem>
                  ))}
              </div>
              <div className="border-t border-slate-100 py-1">
                <MenuItem
                  onClick={() => {
                    setMenuOpen(false)
                    setHealthOpen(true)
                  }}
                >
                  Data health
                </MenuItem>
                <MenuItem onClick={onSignOut}>Sign out</MenuItem>
              </div>
            </div>
          )}
          <button
            onClick={() => setMenuOpen((v) => !v)}
            className="flex w-full items-center gap-3 rounded-lg p-2 text-left transition hover:bg-white/5"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
          >
            <Avatar name={me.name} size="sm" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-white">{me.name}</span>
              <span className="block truncate text-xs text-slate-500">{me.title.split(' - ')[0]}</span>
            </span>
            <svg viewBox="0 0 20 20" className="h-4 w-4 text-slate-500" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="m6 8 4-4 4 4M6 12l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
      )}

      {healthOpen && <DataHealthDialog onClose={() => setHealthOpen(false)} />}
    </aside>
  )
}

function MenuItem({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button onClick={onClick} className="flex w-full items-center gap-3 px-4 py-2 text-left text-sm hover:bg-slate-50">
      {children}
    </button>
  )
}
