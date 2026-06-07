'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { sessionsClient, ApiClientError } from '@/lib/api-client'
import { useNow } from '@/hooks/use-now'

// Kept local to the component to avoid importing server-only type files.
// The service-layer type is the source of truth for the API contract.
interface ExplorationShape {
  type: 'exploration'
  whatExplored: string
  keyFindings: string[]
  filesExamined: Array<{ file: string; reason: string }>
  nextSteps: string[]
}

interface ImplementationShape {
  type: 'implementation'
  goal: string
  accomplished: string[]
  keyChanges: Array<{ file: string; delta?: string; description: string }>
  unresolved: string[]
}

type DebugStatus = 'fixed' | 'partial' | 'unresolved'

interface DebugShape {
  type: 'debug'
  problem: string
  rootCause: string | null
  fixApplied: Array<{ file: string; delta?: string; description: string }>
  verification: string[]
  status: DebugStatus
}

interface RefactorShape {
  type: 'refactor'
  refactorGoal: string
  changes: Array<{ file: string; description: string }>
  scope: { filesCount: number; linesAdded: number; linesRemoved: number }
  behaviorPreservation: string | null
  followUps: string[]
}

interface ReviewShape {
  type: 'review'
  reviewScope: string
  findings: string[]
  severity: { critical: string[]; improvements: string[]; notes: string[] }
  recommendations: string[]
}

interface MixedShape {
  type: 'mixed'
  overview: string
  mainActivities: string[]
  unresolved: string[]
}

type SummaryShape =
  | ExplorationShape
  | ImplementationShape
  | DebugShape
  | RefactorShape
  | ReviewShape
  | MixedShape

interface SummaryCardProps {
  sessionId: string
  initialSummary: unknown // JSON from the server; shape depends on summaryType
  initialSummaryType: string | null
  initialGeneratedAt: string | null // ISO string from the server
  initialEventCount: number | null // how many events the summary covers
  currentEventCount: number // session's live event count for delta staleness
  isStale: boolean // summary exists but lastActivityAt > summaryGeneratedAt
}

export function SummaryCard({
  sessionId,
  initialSummary,
  initialSummaryType,
  initialGeneratedAt,
  initialEventCount,
  currentEventCount,
  isStale,
}: SummaryCardProps) {
  const router = useRouter()
  const [summary, setSummary] = useState<unknown>(initialSummary)
  const [summaryType, setSummaryType] = useState<string | null>(
    initialSummaryType
  )
  const [generatedAt, setGeneratedAt] = useState<string | null>(
    initialGeneratedAt
  )
  const [eventCount, setEventCount] = useState<number | null>(initialEventCount)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [, startTransition] = useTransition()
  const now = useNow()

  async function regenerate() {
    setLoading(true)
    setError(null)
    try {
      const ok = await sessionsClient.summarize(sessionId)
      setSummary(ok.summary)
      setSummaryType(ok.summaryType)
      setGeneratedAt(ok.generatedAt)
      setEventCount(ok.eventCount)
      startTransition(() => router.refresh())
    } catch (err) {
      setError(
        err instanceof ApiClientError || err instanceof Error
          ? err.message
          : 'Failed to generate summary'
      )
    } finally {
      setLoading(false)
    }
  }

  const hasSummary = summary !== null && summary !== undefined
  const buttonLabel = loading
    ? 'Generating…'
    : hasSummary
      ? 'Regenerate'
      : 'Generate summary'
  const deltaEvents =
    eventCount !== null ? Math.max(0, currentEventCount - eventCount) : 0

  return (
    <section className='mb-8 rounded-md border bg-muted/20 p-4'>
      <header className='mb-3 flex items-center justify-between gap-4'>
        <h2 className='text-sm font-semibold uppercase tracking-wide text-muted-foreground'>
          Summary
          {summaryType && <TypeBadge type={summaryType} />}
        </h2>
        <div className='flex items-center gap-3 text-xs text-muted-foreground'>
          {generatedAt && now != null && (
            <span>
              generated {formatRelativeTime(new Date(generatedAt), now)}
              {isStale && !loading && ` · stale (+${deltaEvents} events)`}
            </span>
          )}
          <button
            type='button'
            onClick={regenerate}
            disabled={loading}
            className='rounded-sm border border-border bg-background px-3 py-1 text-xs font-medium hover:bg-muted disabled:opacity-50'
          >
            {buttonLabel}
          </button>
        </div>
      </header>

      {error && (
        <p className='mb-3 rounded-sm border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900'>
          {error}
        </p>
      )}

      {hasSummary ? (
        <SummaryBody summary={summary} />
      ) : (
        <p className='text-sm text-muted-foreground'>
          No summary yet. Click <strong>Generate summary</strong> to have Claude
          describe what this session accomplished.
        </p>
      )}
    </section>
  )
}

function TypeBadge({ type }: { type: string }) {
  const icon = TYPE_ICONS[type] ?? '•'
  return (
    <span className='ml-2 inline-flex items-center gap-1 rounded-sm bg-muted px-1.5 py-0.5 font-mono text-[10px] normal-case tracking-normal text-foreground'>
      <span aria-hidden>{icon}</span>
      {type}
    </span>
  )
}

const TYPE_ICONS: Record<string, string> = {
  exploration: '🔍',
  implementation: '🛠',
  debug: '🐛',
  refactor: '🔧',
  review: '👁',
  mixed: '≈',
}

function SummaryBody({ summary }: { summary: unknown }) {
  const shape = coerceShape(summary)
  if (!shape) {
    return (
      <pre className='overflow-x-auto rounded-sm bg-muted/40 p-3 text-xs'>
        {JSON.stringify(summary, null, 2)}
      </pre>
    )
  }
  switch (shape.type) {
    case 'exploration':
      return <ExplorationView s={shape} />
    case 'implementation':
      return <ImplementationView s={shape} />
    case 'debug':
      return <DebugView s={shape} />
    case 'refactor':
      return <RefactorView s={shape} />
    case 'review':
      return <ReviewView s={shape} />
    case 'mixed':
      return <MixedView s={shape} />
  }
}

function coerceShape(summary: unknown): SummaryShape | null {
  if (!summary || typeof summary !== 'object') return null
  const o = summary as Record<string, unknown>
  switch (o.type) {
    case 'exploration':
      return summary as ExplorationShape
    case 'implementation':
      return summary as ImplementationShape
    case 'debug':
      return summary as DebugShape
    case 'refactor':
      return summary as RefactorShape
    case 'review':
      return summary as ReviewShape
    case 'mixed':
      return summary as MixedShape
    default:
      return null
  }
}

// ─── Per-type views ─────────────────────────────────────────────────────────

function ExplorationView({ s }: { s: ExplorationShape }) {
  return (
    <div className='space-y-4 text-sm leading-relaxed'>
      <Section title='What was explored'>
        <p>
          {s.whatExplored || (
            <em className='text-muted-foreground'>not described</em>
          )}
        </p>
      </Section>
      {s.keyFindings.length > 0 && (
        <Section title='Key findings'>
          <BulletList items={s.keyFindings} />
        </Section>
      )}
      {s.filesExamined.length > 0 && (
        <Section title='Files examined'>
          <ul className='space-y-1'>
            {s.filesExamined.map((f, i) => (
              <li key={i} className='flex flex-wrap gap-x-2'>
                <code className='font-mono text-xs'>{f.file}</code>
                <span>— {f.reason}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}
      {s.nextSteps.length > 0 && (
        <Section title='Next steps'>
          <BulletList items={s.nextSteps} />
        </Section>
      )}
    </div>
  )
}

function ImplementationView({ s }: { s: ImplementationShape }) {
  return (
    <div className='space-y-4 text-sm leading-relaxed'>
      <Section title='Goal'>
        <p>{s.goal || <em className='text-muted-foreground'>no goal</em>}</p>
      </Section>
      {s.accomplished.length > 0 && (
        <Section title='Accomplished'>
          <BulletList items={s.accomplished} />
        </Section>
      )}
      {s.keyChanges.length > 0 && (
        <Section title='Key changes'>
          <FileChangeList items={s.keyChanges} />
        </Section>
      )}
      {s.unresolved.length > 0 && (
        <Section title='Unresolved'>
          <BulletList items={s.unresolved} />
        </Section>
      )}
    </div>
  )
}

function DebugView({ s }: { s: DebugShape }) {
  return (
    <div className='space-y-4 text-sm leading-relaxed'>
      <div className='flex items-start justify-between gap-4'>
        <Section title='Problem'>
          <p>
            {s.problem || (
              <em className='text-muted-foreground'>not described</em>
            )}
          </p>
        </Section>
        <StatusChip status={s.status} />
      </div>
      {s.rootCause && (
        <Section title='Root cause'>
          <p>{s.rootCause}</p>
        </Section>
      )}
      {s.fixApplied.length > 0 && (
        <Section title='Fix applied'>
          <FileChangeList items={s.fixApplied} />
        </Section>
      )}
      {s.verification.length > 0 && (
        <Section title='Verification'>
          <BulletList items={s.verification} />
        </Section>
      )}
    </div>
  )
}

function RefactorView({ s }: { s: RefactorShape }) {
  return (
    <div className='space-y-4 text-sm leading-relaxed'>
      <Section title='Refactor goal'>
        <p>
          {s.refactorGoal || (
            <em className='text-muted-foreground'>not described</em>
          )}
        </p>
      </Section>
      {s.changes.length > 0 && (
        <Section title='Changes'>
          <ul className='space-y-1'>
            {s.changes.map((c, i) => (
              <li key={i} className='flex flex-wrap gap-x-2'>
                <code className='font-mono text-xs'>{c.file}</code>
                <span>— {c.description}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}
      <Section title='Scope'>
        <p className='font-mono text-xs text-muted-foreground'>
          {s.scope.filesCount} files · +{s.scope.linesAdded} -
          {s.scope.linesRemoved}
        </p>
      </Section>
      {s.behaviorPreservation && (
        <Section title='Behavior preservation'>
          <p>{s.behaviorPreservation}</p>
        </Section>
      )}
      {s.followUps.length > 0 && (
        <Section title='Follow-ups'>
          <BulletList items={s.followUps} />
        </Section>
      )}
    </div>
  )
}

function ReviewView({ s }: { s: ReviewShape }) {
  return (
    <div className='space-y-4 text-sm leading-relaxed'>
      <Section title='Review scope'>
        <p>
          {s.reviewScope || (
            <em className='text-muted-foreground'>not described</em>
          )}
        </p>
      </Section>
      {s.findings.length > 0 && (
        <Section title='Findings'>
          <BulletList items={s.findings} />
        </Section>
      )}
      {(s.severity.critical.length > 0 ||
        s.severity.improvements.length > 0 ||
        s.severity.notes.length > 0) && (
        <Section title='By severity'>
          <div className='space-y-2'>
            {s.severity.critical.length > 0 && (
              <SeverityGroup
                label='Critical'
                tone='critical'
                items={s.severity.critical}
              />
            )}
            {s.severity.improvements.length > 0 && (
              <SeverityGroup
                label='Improvements'
                tone='improvements'
                items={s.severity.improvements}
              />
            )}
            {s.severity.notes.length > 0 && (
              <SeverityGroup
                label='Notes'
                tone='notes'
                items={s.severity.notes}
              />
            )}
          </div>
        </Section>
      )}
      {s.recommendations.length > 0 && (
        <Section title='Recommendations'>
          <BulletList items={s.recommendations} />
        </Section>
      )}
    </div>
  )
}

function MixedView({ s }: { s: MixedShape }) {
  return (
    <div className='space-y-4 text-sm leading-relaxed'>
      <Section title='Overview'>
        <p>{s.overview}</p>
      </Section>
      {s.mainActivities.length > 0 && (
        <Section title='Main activities'>
          <BulletList items={s.mainActivities} />
        </Section>
      )}
      {s.unresolved.length > 0 && (
        <Section title='Unresolved'>
          <BulletList items={s.unresolved} />
        </Section>
      )}
    </div>
  )
}

// ─── Small shared pieces ────────────────────────────────────────────────────

function Section({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <div>
      <h3 className='mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground'>
        {title}
      </h3>
      {children}
    </div>
  )
}

function BulletList({ items }: { items: string[] }) {
  return (
    <ul className='list-disc space-y-1 pl-5'>
      {items.map((x, i) => (
        <li key={i}>{x}</li>
      ))}
    </ul>
  )
}

function FileChangeList({
  items,
}: {
  items: Array<{ file: string; delta?: string; description: string }>
}) {
  return (
    <ul className='space-y-1'>
      {items.map((c, i) => (
        <li key={i} className='flex flex-wrap gap-x-2'>
          <code className='font-mono text-xs'>{c.file}</code>
          {c.delta && (
            <span className='font-mono text-xs text-muted-foreground'>
              {c.delta}
            </span>
          )}
          <span>— {c.description}</span>
        </li>
      ))}
    </ul>
  )
}

function StatusChip({ status }: { status: DebugStatus }) {
  const className =
    status === 'fixed'
      ? 'bg-green-100 text-green-900 border-green-300'
      : status === 'partial'
        ? 'bg-amber-100 text-amber-900 border-amber-300'
        : 'bg-red-100 text-red-900 border-red-300'
  return (
    <span
      className={`shrink-0 rounded-sm border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${className}`}
    >
      {status}
    </span>
  )
}

function SeverityGroup({
  label,
  tone,
  items,
}: {
  label: string
  tone: 'critical' | 'improvements' | 'notes'
  items: string[]
}) {
  const toneClass =
    tone === 'critical'
      ? 'border-l-4 border-red-400'
      : tone === 'improvements'
        ? 'border-l-4 border-amber-400'
        : 'border-l-4 border-border'
  return (
    <div className={`pl-3 ${toneClass}`}>
      <p className='mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground'>
        {label}
      </p>
      <BulletList items={items} />
    </div>
  )
}

function formatRelativeTime(d: Date, now: number): string {
  const diffMs = now - d.getTime()
  const s = Math.round(diffMs / 1000)
  if (s < 60) return 'just now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  const days = Math.round(h / 24)
  return `${days}d ago`
}
