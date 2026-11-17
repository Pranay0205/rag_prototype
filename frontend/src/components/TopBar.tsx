// Top bar: brand (home), company search (UI-12, API-13) and the profile menu.
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { api, type ClientSearch, type User } from '../api'
import { DataHealthDialog } from './DataHealthDialog'
import { Avatar, Logo, Spinner, Wordmark, cn } from './ui'

interface Props {
  users: User[]
  me: User | undefined
  onHome: () => void
  onOpenClient: (clientId: string) => void
  onSwitch: (userId: string) => void
  onSignOut: () => void
}

export function TopBar({ users, me, onHome, onOpenClient, onSwitch, onSignOut }: Props) {
  return (
    <header className="flex h-16 shrink-0 items-center gap-6 border-b border-slate-200/70 bg-white/80 px-6 backdrop-blur">
      <button onClick={onHome} className="flex items-center gap-2.5" title="Home">
        <Logo size={28} />
        <Wordmark />
      </button>
      <div className="flex flex-1 justify-center">
        {me && <ClientSearchBox userId={me.user_id} onOpen={onOpenClient} />}
      </div>
      {me && <ProfileMenu users={users} me={me} onSwitch={onSwitch} onSignOut={onSignOut} />}
    </header>
  )
}

/** Search as you type by name or alias, within the viewer's coverage. Ctrl/Cmd+K focuses it. */
function ClientSearchBox({ userId, onOpen }: { userId: string; onOpen: (clientId: string) => void }) {
  const [q, setQ] = useState('')
  const [data, setData] = useState<ClientSearch | null>(null)
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        input.current?.focus()
      }
    }
    const click = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false)
    window.addEventListener('keydown', key)
    document.addEventListener('mousedown', click)
    return () => {
      window.removeEventListener('keydown', key)
      document.removeEventListener('mousedown', click)
    }
  }, [])

  useEffect(() => {
    const query = q.trim()
    if (!query) {
      setData(null)
      return
    }
    setLoading(true)
    const t = setTimeout(() => {
      api
        .searchClients(userId, query)
        .then((d) => {
          setData(d)
          setActive(0)
        })
        .finally(() => setLoading(false))
    }, 150)
    return () => clearTimeout(t)
  }, [q, userId])

  function pick(clientId: string) {
    onOpen(clientId)
    setQ('')
    setOpen(false)
    input.current?.blur()
  }

  const results = data?.results ?? []
  return (
    <div ref={box} className="relative w-full max-w-md">
      <div className="flex items-center gap-2 rounded-xl bg-slate-100/80 px-3.5 ring-1 ring-transparent transition focus-within:bg-white focus-within:ring-indigo-300">
        <svg viewBox="0 0 20 20" className="h-4 w-4 shrink-0 text-slate-400" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M9 15A6 6 0 1 0 9 3a6 6 0 0 0 0 12Zm8 2-3.8-3.8" strokeLinecap="round" />
        </svg>
        <input
          ref={input}
          value={q}
          onChange={(e) => {
            setQ(e.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') setActive((i) => Math.min(i + 1, results.length - 1))
            else if (e.key === 'ArrowUp') setActive((i) => Math.max(i - 1, 0))
            else if (e.key === 'Enter' && results[active]) pick(results[active].client_id)
            else if (e.key === 'Escape') {
              setOpen(false)
              input.current?.blur()
            }
          }}
          placeholder="Search clients by name or alias"
          aria-label="Search clients"
          className="h-10 w-full bg-transparent text-sm text-slate-800 outline-none placeholder:text-slate-400"
        />
        {loading ? (
          <Spinner className="h-3.5 w-3.5 text-slate-400" />
        ) : (
          <kbd className="hidden whitespace-nowrap rounded-md bg-white px-1.5 py-0.5 text-[10px] font-medium text-slate-400 ring-1 ring-slate-200 sm:block">
            Ctrl K
          </kbd>
        )}
      </div>

      {open && data && (
        <div className="absolute left-0 right-0 top-full z-40 mt-2 overflow-hidden rounded-xl bg-white py-1.5 shadow-2xl ring-1 ring-slate-900/10">
          {results.map((r, i) => (
            <button
              key={r.client_id}
              onMouseEnter={() => setActive(i)}
              onClick={() => pick(r.client_id)}
              className={cn('flex w-full items-center gap-3 px-3.5 py-2.5 text-left', i === active && 'bg-indigo-50/70')}
            >
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-indigo-50 text-[11px] font-semibold text-indigo-700">
                {r.name
                  .split(' ')
                  .map((w) => w[0])
                  .join('')
                  .slice(0, 2)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-slate-800">{r.name}</span>
                {r.matched_alias && (
                  <span className="block text-xs text-slate-400">
                    Matched alias <span className="font-medium text-slate-600">"{r.matched_alias}"</span>
                  </span>
                )}
              </span>
              <span className="text-xs text-slate-300">↵</span>
            </button>
          ))}
          {results.length === 0 && (
            <p className="flex items-center gap-2 px-3.5 py-3 text-sm text-slate-500">
              {data.notice ? (
                <>
                  <svg viewBox="0 0 20 20" className="h-4 w-4 shrink-0 text-amber-500" fill="currentColor" aria-hidden="true">
                    <path
                      fillRule="evenodd"
                      d="M10 1a4.5 4.5 0 0 0-4.5 4.5V9H5a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2h-.5V5.5A4.5 4.5 0 0 0 10 1Zm3 8V5.5a3 3 0 1 0-6 0V9h6Z"
                    />
                  </svg>
                  {data.notice}
                </>
              ) : (
                'No client in your coverage matches'
              )}
            </p>
          )}
        </div>
      )}
    </div>
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
