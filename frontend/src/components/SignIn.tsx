// Lock-screen style sign-in. In production the firm's SSO signs the user in; this is a demo stand-in.
import { useEffect, useState } from 'react'
import type { User } from '../api'
import { Avatar, Logo, Spinner, Wordmark, cn } from './ui'

interface Props {
  users: User[]
  onSignIn: (userId: string) => void
}

export function SignIn({ users, onSignIn }: Props) {
  const [selectedId, setSelectedId] = useState('alex')
  const [signingIn, setSigningIn] = useState(false)
  const now = useClock()
  const selected = users.find((u) => u.user_id === selectedId) ?? users[0]

  function signIn() {
    if (!selected) return
    setSigningIn(true)
    setTimeout(() => onSignIn(selected.user_id), 650) // a beat, as SSO would take
  }

  return (
    <div className="relative h-full overflow-hidden bg-slate-950 text-white">
      {/* backdrop: deep gradient with soft glows */}
      <div className="absolute inset-0 bg-gradient-to-br from-indigo-950 via-slate-950 to-black" />
      <div className="absolute -left-40 -top-40 h-[560px] w-[560px] rounded-full bg-indigo-600/25 blur-[120px]" />
      <div className="absolute -bottom-48 right-0 h-[520px] w-[520px] rounded-full bg-violet-700/20 blur-[120px]" />

      <div className="relative flex h-full flex-col items-center">
        <div className="mt-[10vh] text-center">
          <div className="flex items-baseline justify-center gap-2 font-extralight tracking-tight">
            <span className="text-7xl tabular-nums">
              {now.getHours() % 12 || 12}:{String(now.getMinutes()).padStart(2, '0')}
            </span>
            <span className="text-2xl text-slate-300">{now.getHours() < 12 ? 'AM' : 'PM'}</span>
          </div>
          <div className="mt-2 text-lg font-light text-slate-300">
            {now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}
          </div>
        </div>

        <div className="mt-auto mb-[14vh] flex flex-col items-center">
          {selected ? (
            <>
              <div className="rounded-full p-1 ring-1 ring-white/15">
                <Avatar name={selected.name} size="lg" />
              </div>
              <div className="mt-4 text-2xl font-medium">{selected.name}</div>
              <div className="mt-1 text-sm text-slate-400">{selected.title}</div>
              <button
                onClick={signIn}
                disabled={signingIn}
                autoFocus
                className="mt-7 inline-flex min-w-56 items-center justify-center gap-2 rounded-full bg-white/10 px-6 py-2.5 text-sm font-medium ring-1 ring-white/20 backdrop-blur-md transition hover:bg-white/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 disabled:opacity-70"
              >
                {signingIn ? (
                  <>
                    <Spinner /> Signing in
                  </>
                ) : (
                  <>
                    Sign in with Meridian SSO
                    <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M4 10h11m-4-4 4 4-4 4" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </>
                )}
              </button>
            </>
          ) : (
            <Spinner className="h-6 w-6 text-slate-400" />
          )}
        </div>

        {/* other accounts, Windows-style */}
        <div className="absolute bottom-6 left-6 space-y-1">
          {users
            .filter((u) => u.user_id !== selected?.user_id)
            .map((u) => (
              <button
                key={u.user_id}
                onClick={() => setSelectedId(u.user_id)}
                className={cn(
                  'flex items-center gap-3 rounded-lg px-3 py-2 text-left transition hover:bg-white/10',
                  signingIn && 'pointer-events-none opacity-50',
                )}
              >
                <Avatar name={u.name} size="sm" />
                <span>
                  <span className="block text-sm font-medium">{u.name}</span>
                  <span className="block text-xs text-slate-400">{u.title.split(' - ')[0]}</span>
                </span>
              </button>
            ))}
        </div>

        <div className="absolute bottom-7 right-7 flex items-center gap-2.5 opacity-80">
          <Logo size={26} />
          <Wordmark dark />
        </div>
      </div>
    </div>
  )
}

function useClock(): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 15_000)
    return () => clearInterval(t)
  }, [])
  return now
}
