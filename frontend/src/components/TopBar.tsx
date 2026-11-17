// UI-12 top bar: brand (home) and the profile menu.
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { User } from '../api'
import { DataHealthDialog } from './DataHealthDialog'
import { Avatar, Logo, Wordmark } from './ui'

interface Props {
  users: User[]
  me: User | undefined
  onHome: () => void
  onSwitch: (userId: string) => void
  onSignOut: () => void
}

export function TopBar({ users, me, onHome, onSwitch, onSignOut }: Props) {
  // z-30: the blur makes the header its own layer; without it, its menus open behind the page
  return (
    <header className="relative z-30 flex h-16 shrink-0 items-center gap-6 border-b border-slate-200/70 bg-white/80 px-6 backdrop-blur">
      <button onClick={onHome} className="flex items-center gap-2.5" title="Home">
        <Logo size={28} />
        <Wordmark />
      </button>
      <div className="flex-1" />
      {me && <ProfileMenu users={users} me={me} onSwitch={onSwitch} onSignOut={onSignOut} />}
    </header>
  )
}

function ProfileMenu({
  users,
  me,
  onSwitch,
  onSignOut,
}: {
  users: User[]
  me: User
  onSwitch: (userId: string) => void
  onSignOut: () => void
}) {
  const [open, setOpen] = useState(false)
  const [healthOpen, setHealthOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-2.5 rounded-full py-1 pl-1 pr-3 transition hover:bg-slate-100"
      >
        <Avatar name={me.name} size="sm" />
        <span className="text-left leading-tight">
          <span className="block text-sm font-medium text-slate-800">{me.name}</span>
          <span className="block text-[11px] text-slate-400">{me.title.split(' - ')[0]}</span>
        </span>
      </button>
      {open && (
        <div className="absolute right-0 top-full z-40 mt-2 w-64 overflow-hidden rounded-xl bg-white text-slate-700 shadow-2xl ring-1 ring-black/5">
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
                    setOpen(false)
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
                setOpen(false)
                setHealthOpen(true)
              }}
            >
              Data health
            </MenuItem>
            <MenuItem onClick={onSignOut}>Sign out</MenuItem>
          </div>
        </div>
      )}
      {healthOpen && <DataHealthDialog onClose={() => setHealthOpen(false)} />}
    </div>
  )
}

function MenuItem({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button onClick={onClick} className="flex w-full items-center gap-3 px-4 py-2 text-left text-sm hover:bg-slate-50">
      {children}
    </button>
  )
}
