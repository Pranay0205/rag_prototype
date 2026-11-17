// UI-3: a sticky index of the briefing for wide screens. Each entry shows its section's confidence and
// verified count, highlights while that section is on screen, and scrolls to it on click.
import { useEffect, useState } from 'react'
import type { Section, SectionKey } from '../types'
import { SECTION_ORDER, cn } from './ui'

const DOT = { high: 'bg-emerald-500', medium: 'bg-amber-500', low: 'bg-rose-500' }

export const FIGURES_ANCHOR = 'key-figures'

export function BriefingIndex({ sections }: { sections: Partial<Record<SectionKey, Section>> }) {
  const entries = [{ id: FIGURES_ANCHOR, title: 'Key figures' }, ...SECTION_ORDER.map((s) => ({ id: s.key, title: s.title }))]
  const [active, setActive] = useState<string>(FIGURES_ANCHOR)

  // scroll spy: the active entry is the first section crossing the upper part of the screen
  useEffect(() => {
    const visible = new Set<string>()
    const observer = new IntersectionObserver(
      (records) => {
        for (const r of records) {
          if (r.isIntersecting) visible.add(r.target.id)
          else visible.delete(r.target.id)
        }
        const first = entries.find((e) => visible.has(e.id))
        if (first) setActive(first.id)
      },
      { rootMargin: '-15% 0px -55% 0px' },
    )
    for (const e of entries) {
      const el = document.getElementById(e.id)
      if (el) observer.observe(el)
    }
    return () => observer.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Object.keys(sections).length])

  return (
    <nav aria-label="Briefing sections" className="text-[13.5px]">
      <p className="mb-2 px-3 text-[12px] font-semibold uppercase tracking-wider text-slate-500">In this briefing</p>
      <ul className="space-y-0.5 border-l border-slate-200">
        {entries.map((e) => {
          const s = e.id === FIGURES_ANCHOR ? undefined : sections[e.id as SectionKey]
          const verified = s?.claims.filter((c) => c.status === 'verified').length ?? 0
          const on = active === e.id
          return (
            <li key={e.id}>
              <button
                onClick={() => {
                  setActive(e.id)
                  document.getElementById(e.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                }}
                aria-current={on ? 'location' : undefined}
                className={cn(
                  '-ml-px flex w-full items-start gap-2 border-l-2 py-1.5 pl-3 pr-2 text-left leading-snug transition',
                  on ? 'border-slate-900 font-semibold text-slate-900' : 'border-transparent text-slate-600 hover:text-slate-900',
                )}
              >
                <span className="flex-1">{e.title}</span>
                {s && (
                  <span
                    className="mt-[3px] inline-flex shrink-0 items-center gap-1 text-[11.5px] font-medium tabular-nums text-slate-500"
                    title={`${s.confidence} confidence, ${verified} of ${s.claims.length} verified`}
                  >
                    <span className={cn('h-1.5 w-1.5 rounded-full', DOT[s.confidence])} />
                    {verified}/{s.claims.length}
                  </span>
                )}
              </button>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
