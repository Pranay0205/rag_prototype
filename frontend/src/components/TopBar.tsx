// UI-12 top bar: brand (home) and the profile menu.
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { User } from '../api'
import { Avatar, Logo, Wordmark, cn } from './ui'

interface Props {
  users: User[]
  me: User | undefined
  onHome: () => void
  crumb?: string | null // the open client, shown as Home > Client
  onData: () => void // UI-15 data page
  dataActive: boolean
  onSwitch: (userId: string) => void
  onSignOut: () => void
}

export function TopBar({ users, me, onHome, crumb, onData, dataActive, onSwitch, onSignOut }: Props) {
  // z-30 keeps the profile menu above the page content
  return (
    <header className="relative z-30 shrink-0 border-b border-slate-200 bg-white">
      <div className="mx-auto flex h-16 max-w-[1320px] items-center min-[1600px]:max-w-[1640px] justify-between gap-4 px-6">
        <div className="flex min-w-0 items-center gap-4">
          <button onClick={onHome} className="flex items-center gap-2.5" title="Home">
            <Logo size={32} />
            <Wordmark />
          </button>
          {crumb && (
            <nav aria-label="Breadcrumb" className="truncate text-[14px] text-slate-600">
              <span aria-hidden="true" className="mr-3 text-slate-300">
                /
              </span>
              <button onClick={onHome} className="hover:text-slate-900">
                Home
              </button>
              <span aria-hidden="true" className="mx-2">
                ›
              </span>
              <span aria-current="page" className="font-medium text-slate-900">
                {crumb}
              </span>
            </nav>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onData}
            aria-current={dataActive ? 'page' : undefined}
            title="How the data is loaded, unified and checked"
            className={cn(
              'inline-flex h-9 items-center gap-2 rounded-full px-3.5 text-[14px] font-medium transition',
              dataActive ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
            )}
          >
            <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
              <ellipse cx="10" cy="5" rx="6" ry="2.5" />
              <path d="M4 5v10c0 1.4 2.7 2.5 6 2.5s6-1.1 6-2.5V5M4 10c0 1.4 2.7 2.5 6 2.5s6-1.1 6-2.5" />
            </svg>
            Data
          </button>
          {me && <ProfileMenu users={users} me={me} onSwitch={onSwitch} onSignOut={onSignOut} />}
        </div>
      </div>
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
            <MenuItem onClick={onSignOut}>Sign out</MenuItem>
          </div>
        </div>
      )}
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
