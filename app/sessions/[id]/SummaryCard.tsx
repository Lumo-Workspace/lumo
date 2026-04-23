'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'

interface SummaryCardProps {
  sessionId: string
  initialSummary: string | null
  initialGeneratedAt: string | null // ISO string from the server
  isStale: boolean // summary exists but lastActivityAt > summaryGeneratedAt
}

export function SummaryCard({
  sessionId,
  initialSummary,
  initialGeneratedAt,
  isStale,
}: SummaryCardProps) {
  const router = useRouter()
  const [summary, setSummary] = useState(initialSummary)
  const [generatedAt, setGeneratedAt] = useState(initialGeneratedAt)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [, startTransition] = useTransition()

  async function regenerate() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/sessions/${sessionId}/summarize`, {
        method: 'POST',
      })
      const data = await res.json()
      if (!res.ok) {
        throw new Error(data?.error ?? `Request failed (${res.status})`)
      }
      setSummary(data.summary)
      setGeneratedAt(data.generatedAt)
      // Bump the rest of the page too (e.g. future staleness recalc).
      startTransition(() => router.refresh())
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to generate summary'
      )
    } finally {
      setLoading(false)
    }
  }

  const hasSummary = summary !== null && summary.trim().length > 0
  const buttonLabel = loading
    ? 'Generating…'
    : hasSummary
      ? 'Regenerate'
      : 'Generate summary'

  return (
    <section className='mb-8 rounded-md border bg-muted/20 p-4'>
      <header className='mb-3 flex items-center justify-between gap-4'>
        <h2 className='text-sm font-semibold uppercase tracking-wide text-muted-foreground'>
          Summary
        </h2>
        <div className='flex items-center gap-3 text-xs text-muted-foreground'>
          {generatedAt && (
            <span>
              generated {formatRelativeTime(new Date(generatedAt))}
              {isStale && !loading && ' · stale'}
            </span>
          )}
          <button
            type='button'
            onClick={regenerate}
            disabled={loading}
            className='rounded border border-border bg-background px-3 py-1 text-xs font-medium hover:bg-muted disabled:opacity-50'
          >
            {buttonLabel}
          </button>
        </div>
      </header>

      {error && (
        <p className='mb-3 rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900'>
          {error}
        </p>
      )}

      {hasSummary ? (
        <SummaryBody markdown={summary!} />
      ) : (
        <p className='text-sm text-muted-foreground'>
          No summary yet. Click <strong>Generate summary</strong> to have Claude
          describe what this session accomplished.
        </p>
      )}
    </section>
  )
}

function SummaryBody({ markdown }: { markdown: string }) {
  const sections = parseSummary(markdown)
  // Fallback: if the model didn't produce any ## sections, show the raw text.
  if (sections.length === 0) {
    return (
      <p className='whitespace-pre-wrap text-sm leading-relaxed'>{markdown}</p>
    )
  }
  return (
    <div className='space-y-4'>
      {sections.map((section, i) => (
        <div key={i}>
          <h3 className='mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground'>
            {section.title}
          </h3>
          <SectionBody body={section.body} />
        </div>
      ))}
    </div>
  )
}

function SectionBody({ body }: { body: string }) {
  const lines = body.split('\n').map(l => l.trimEnd())
  const bullets: string[] = []
  const plain: string[] = []
  for (const line of lines) {
    if (!line.trim()) continue
    const bulletMatch = line.match(/^[-*]\s+(.*)$/)
    if (bulletMatch) bullets.push(bulletMatch[1] ?? '')
    else plain.push(line)
  }
  return (
    <div className='text-sm leading-relaxed'>
      {plain.length > 0 && (
        <p className='mb-2 whitespace-pre-wrap'>{plain.join(' ')}</p>
      )}
      {bullets.length > 0 && (
        <ul className='list-disc space-y-1 pl-5'>
          {bullets.map((b, i) => (
            <li key={i}>{renderInline(b)}</li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** Render very-light inline markdown: `code`, **bold**. */
function renderInline(text: string) {
  const parts: Array<string | { kind: 'code' | 'bold'; text: string }> = []
  let cursor = 0
  const re = /`([^`]+)`|\*\*([^*]+)\*\*/g
  let match: RegExpExecArray | null
  while ((match = re.exec(text)) !== null) {
    if (match.index > cursor) parts.push(text.slice(cursor, match.index))
    if (match[1] !== undefined) parts.push({ kind: 'code', text: match[1] })
    else if (match[2] !== undefined)
      parts.push({ kind: 'bold', text: match[2] })
    cursor = re.lastIndex
  }
  if (cursor < text.length) parts.push(text.slice(cursor))

  return parts.map((p, i) => {
    if (typeof p === 'string') return <span key={i}>{p}</span>
    if (p.kind === 'code') {
      return (
        <code key={i} className='rounded bg-muted px-1 font-mono text-xs'>
          {p.text}
        </code>
      )
    }
    return (
      <strong key={i} className='font-semibold'>
        {p.text}
      </strong>
    )
  })
}

function parseSummary(md: string): Array<{ title: string; body: string }> {
  const sections: Array<{ title: string; body: string }> = []
  let current: { title: string; body: string } | null = null
  for (const rawLine of md.split('\n')) {
    const line = rawLine.trimEnd()
    const heading = line.match(/^##+\s+(.*)$/)
    if (heading) {
      if (current) sections.push(current)
      current = { title: heading[1]?.trim() ?? '', body: '' }
      continue
    }
    if (current) {
      current.body += (current.body ? '\n' : '') + line
    }
  }
  if (current) sections.push(current)
  return sections.filter(s => s.title.length > 0)
}

function formatRelativeTime(d: Date): string {
  const diffMs = Date.now() - d.getTime()
  const s = Math.round(diffMs / 1000)
  if (s < 60) return 'just now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  const days = Math.round(h / 24)
  return `${days}d ago`
}
