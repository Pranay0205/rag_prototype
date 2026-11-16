// UI-9: what ingestion cleaned up before any briefing was written.
import { useEffect, useState } from 'react'
import { api, type DataHealth } from '../api'
import { Spinner } from './ui'

export function DataHealthDialog({ onClose }: { onClose: () => void }) {
  const [health, setHealth] = useState<DataHealth | null>(null)

  useEffect(() => {
    api.dataHealth().then(setHealth)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const rows: [string, string | number][] = health
    ? [
        ['Documents ingested', health.documents.total],
        ['Chunks indexed', health.index.chunks_indexed],
        ...health.merges.map((m): [string, string] => ['Duplicate client merged', `${m.merged_id} → ${m.survivor_id}`]),
        ...health.documents.duplicates.map((d): [string, string] => ['Duplicate document skipped', d.doc_id]),
        ...health.documents.inferred_links.map((l): [string, string] => [
          'Linked by name (no client ID)',
          `${l.doc_id} · ${Math.round(l.confidence * 100)}%`,
        ]),
        ...health.documents.quarantined_news.map((d): [string, string] => ['Unapproved news quarantined', d]),
        ...health.documents.suspected_injection.map((d): [string, string] => ['Prompt injection flagged', d]),
      ]
    : []

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/40 backdrop-blur-sm" onClick={onClose}>
      <div
        role="dialog"
        aria-label="Data health"
        className="w-[440px] rounded-2xl bg-white p-6 text-slate-700 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold tracking-tight text-slate-900">Data health</h2>
        {!health && <Spinner className="mt-4 h-5 w-5 text-slate-400" />}
        <dl className="mt-4 divide-y divide-slate-100">
          {rows.map(([label, value]) => (
            <div key={`${label}-${value}`} className="flex items-center justify-between py-2.5 text-sm">
              <dt className="text-slate-500">{label}</dt>
              <dd className="font-medium text-slate-900 tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  )
}
