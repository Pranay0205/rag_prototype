// Sign-in, split screen: product promise on the left (no client data before sign-in), SSO card on
// the right. In production the firm's SSO identifies the user; here a demo profile stands in for it.
import { useState, type ReactNode } from 'react'
import type { User } from '../api'
import { Avatar, Logo, Spinner, Wordmark, cn } from './ui'

interface Props {
  users: User[]
  onSignIn: (userId: string) => void
}

const PROMISES: { icon: ReactNode; text: string }[] = [
  { icon: <path d="M5 12l5 5L20 7" />, text: 'Every claim cited and verified against system records' },
  {
    icon: <path d="M12 3l9.5 17h-19zM12 10v4M12 17.5v.01" />,
    text: 'Conflicts with prior briefings flagged before you go in',
  },
  {
    icon: <path d="M5 5h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2ZM3 10h18M8 3v4M16 3v4" />,
    text: 'Prepared for each meeting on your calendar',
  },
]

export function SignIn({ users, onSignIn }: Props) {
  const [selectedId, setSelectedId] = useState('alex')
  const [signingIn, setSigningIn] = useState(false)
  const selected = users.find((u) => u.user_id === selectedId) ?? users[0]

  function signIn() {
    if (!selected) return
    setSigningIn(true)
    setTimeout(() => onSignIn(selected.user_id), 650) // a beat, as the SSO redirect would take
  }

  return (
    <div className="flex h-full flex-wrap bg-slate-50 text-slate-900">
      {/* brand panel */}
      <section
        aria-label="About Briefing Desk"
        className="relative flex min-h-[320px] flex-[1_1_440px] flex-col gap-12 overflow-hidden bg-[#0B1530] p-[clamp(32px,5vw,64px)] text-white"
      >
        <div className="pointer-events-none absolute -left-32 -top-32 h-[460px] w-[460px] rounded-full bg-indigo-600/30 blur-[120px]" />
        <div className="pointer-events-none absolute -bottom-40 right-[-80px] h-[420px] w-[420px] rounded-full bg-violet-600/20 blur-[120px]" />
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage:
              'linear-gradient(rgba(255,255,255,.6) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.6) 1px, transparent 1px)',
            backgroundSize: '44px 44px',
            maskImage: 'radial-gradient(ellipse at 30% 40%, black 20%, transparent 70%)',
          }}
        />

        <div className="relative flex items-center gap-2.5">
          <Logo size={32} />
          <Wordmark dark />
        </div>

        <div className="relative flex max-w-[460px] flex-1 flex-col justify-center gap-8">
          <h2 className="rise text-[clamp(28px,3vw,40px)] font-semibold leading-[1.15] tracking-tight">
            Walk into every client meeting with a briefing you can trust.
          </h2>
          <ul className="space-y-[18px] text-[15px] leading-normal text-[#C9D2E3]">
            {PROMISES.map((p, i) => (
              <li key={p.text} className="rise flex gap-3" style={{ animationDelay: `${120 + i * 90}ms` }}>
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-white/[0.06] ring-1 ring-white/10">
                  <svg viewBox="0 0 24 24" className="h-4 w-4 text-[#8FA8E8]" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    {p.icon}
                  </svg>
                </span>
                <span className="pt-0.5">{p.text}</span>
              </li>
            ))}
          </ul>
        </div>

        <p className="relative text-[13px] text-[#9AA7BF]">Internal use only · Meridian employees and authorized contractors</p>
      </section>

      {/* sign-in */}
      <main className="flex flex-[1_1_440px] flex-col items-center justify-center gap-8 px-6 py-[clamp(32px,5vw,64px)]">
        <div className="rise w-full max-w-[400px] space-y-6 rounded-2xl border border-slate-200 bg-white px-8 pb-8 pt-10 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_8px_24px_rgba(15,23,42,0.06)]">
          <div className="space-y-2">
            <h1 className="text-2xl font-bold leading-tight tracking-tight">Sign in to Briefing Desk</h1>
            <p className="text-[15px] leading-normal text-slate-500">
              Use your Meridian work account. You'll be redirected to Meridian SSO to verify your identity.
            </p>
          </div>

          {/* demo stand-in for the SSO identity */}
          <fieldset className="space-y-1.5">
            <legend className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">
              Demo profile
            </legend>
            {users.length === 0 && <Spinner className="h-5 w-5 text-slate-300" />}
            {users.map((u) => {
              const active = u.user_id === selected?.user_id
              return (
                <button
                  key={u.user_id}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => setSelectedId(u.user_id)}
                  disabled={signingIn}
                  className={cn(
                    'flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left ring-1 transition',
                    active ? 'bg-indigo-50/70 ring-indigo-300' : 'ring-slate-200 hover:bg-slate-50',
                  )}
                >
                  <Avatar name={u.name} size="sm" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-slate-900">{u.name}</span>
                    <span className="block truncate text-xs text-slate-500">
                      {u.title.split(' - ')[0]} · {u.clearance}
                      {u.groups.length > 0 && ` · ${u.groups.join(', ')}`}
                    </span>
                  </span>
                  <span
                    className={cn(
                      'grid h-4 w-4 shrink-0 place-items-center rounded-full ring-1',
                      active ? 'bg-indigo-600 ring-indigo-600' : 'ring-slate-300',
                    )}
                  >
                    {active && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
                  </span>
                </button>
              )
            })}
          </fieldset>

          <button
            onClick={signIn}
            disabled={signingIn || !selected}
            autoFocus
            className="flex h-12 w-full items-center justify-center gap-2.5 rounded-[10px] bg-slate-900 text-[15px] font-semibold text-white transition hover:bg-slate-800 active:translate-y-px disabled:opacity-80"
          >
            {signingIn ? (
              <>
                <Spinner /> Redirecting to Meridian SSO
              </>
            ) : (
              <>
                <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6z" />
                  <path d="M9 12l2 2 4-4" />
                </svg>
                Sign in with Meridian SSO
              </>
            )}
          </button>

          <div className="flex gap-2.5 rounded-[10px] bg-slate-50 px-3.5 py-3 text-[13px] leading-normal text-slate-600">
            <svg viewBox="0 0 24 24" className="mt-0.5 h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="5" y="11" width="14" height="10" rx="2" />
              <path d="M8 11V7a4 4 0 0 1 8 0v4" />
            </svg>
            <span>Multi-factor authentication is required. Have your authenticator or security key ready.</span>
          </div>
        </div>

        <p className="max-w-[400px] text-center text-xs leading-normal text-slate-500">
          This system is for authorized users only. Activity is monitored and logged in line with Meridian security
          policy.
        </p>
      </main>
    </div>
  )
}
