'use client'

import { useState, useTransition } from 'react'
import { useIntl, type IntlShape, type MessageDescriptor } from 'react-intl'
import { useRouter } from 'next/navigation'
import {
  Bug,
  CircleAlert,
  Code,
  Eye,
  Info,
  Layers,
  Search,
  TriangleAlert,
  Wrench,
  type LucideIcon,
} from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Card } from '@/components/ui/card'
import { sessionsClient, ApiClientError } from '@/lib/api-client'
import { useNow } from '@/hooks/use-now'
import { SESSION_MESSAGES as M } from '../messages'
import { AI_DERIVED_OFF_CODE } from '@/lib/ai-derived/constants'
import { Badge } from '@/components/ui/badge'

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
  const intl = useIntl()
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
        err instanceof ApiClientError && err.code === AI_DERIVED_OFF_CODE
          ? intl.formatMessage(M['summary.aiDerivedOff'])
          : err instanceof ApiClientError || err instanceof Error
            ? err.message
            : intl.formatMessage(M['summary.generateFailed'])
      )
    } finally {
      setLoading(false)
    }
  }

  const hasSummary = summary !== null && summary !== undefined
  const buttonLabel = loading
    ? intl.formatMessage(M['summary.generating'])
    : hasSummary
      ? intl.formatMessage(M['summary.regenerate'])
      : intl.formatMessage(M['summary.generate'])
  const deltaEvents =
    eventCount !== null ? Math.max(0, currentEventCount - eventCount) : 0

  return (
    <section className='mb-8 rounded-md border bg-muted/20 p-4'>
      <header className='mb-3 flex items-center justify-between gap-4'>
        <h2 className='text-body-strong uppercase text-muted-foreground'>
          {intl.formatMessage(M['summary.title'])}
          {summaryType && <TypeBadge type={summaryType} />}
        </h2>
        <div className='flex items-center gap-3 text-caption text-muted-foreground'>
          {generatedAt && now != null && (
            <span>
              {intl.formatMessage(M['summary.generated'], {
                when: formatRelativeTime(intl, new Date(generatedAt), now),
              })}
              {isStale &&
                !loading &&
                ` · ${intl.formatMessage(M['summary.stale'], { count: deltaEvents })}`}
            </span>
          )}
          <button
            type='button'
            onClick={regenerate}
            disabled={loading}
            className='rounded-sm border border-border bg-background px-3 py-1 text-caption hover:bg-muted disabled:opacity-50'
          >
            {buttonLabel}
          </button>
        </div>
      </header>

      {error && (
        <Alert variant='danger' size='sm' className='mb-3'>
          <CircleAlert />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {hasSummary ? (
        <SummaryBody summary={summary} />
      ) : (
        <p className='text-body text-muted-foreground'>
          {intl.formatMessage(M['summary.empty'], {
            strong: (chunks: React.ReactNode) => <strong>{chunks}</strong>,
          })}
        </p>
      )}
    </section>
  )
}

const TYPE_MESSAGES: Record<string, MessageDescriptor> = {
  exploration: M['summary.typeExploration'],
  implementation: M['summary.typeImplementation'],
  debug: M['summary.typeDebug'],
  refactor: M['summary.typeRefactor'],
  review: M['summary.typeReview'],
  mixed: M['summary.typeMixed'],
}

function TypeBadge({ type }: { type: string }) {
  const intl = useIntl()
  // Own keys only: a server-sent type like 'toString' must not hit Object.prototype.
  const Icon = Object.prototype.hasOwnProperty.call(TYPE_ICONS, type)
    ? TYPE_ICONS[type]
    : undefined
  const label = Object.prototype.hasOwnProperty.call(TYPE_MESSAGES, type)
    ? TYPE_MESSAGES[type]
    : undefined
  return (
    <Badge
      variant='muted'
      size='xs'
      shape='square'
      className='ml-2 font-mono normal-case text-foreground'
    >
      {Icon && (
        <Icon
          aria-hidden
          data-summary-type-icon={type}
          className='size-3 shrink-0 text-muted-foreground'
        />
      )}
      {label ? intl.formatMessage(label) : type}
    </Badge>
  )
}

// Decorative: the adjacent type label carries the meaning (LUM-1250).
const TYPE_ICONS: Record<string, LucideIcon> = {
  exploration: Search,
  implementation: Code,
  debug: Bug,
  refactor: Wrench,
  review: Eye,
  mixed: Layers,
}

function SummaryBody({ summary }: { summary: unknown }) {
  const shape = coerceShape(summary)
  if (!shape) {
    return (
      <pre className='overflow-x-auto rounded-sm bg-muted/40 p-3 text-caption'>
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
  const intl = useIntl()
  return (
    <div className='space-y-4 text-body'>
      <Section title={intl.formatMessage(M['summary.whatExplored'])}>
        <p>
          {s.whatExplored || (
            <em className='text-muted-foreground'>
              {intl.formatMessage(M['summary.notDescribed'])}
            </em>
          )}
        </p>
      </Section>
      {s.keyFindings.length > 0 && (
        <Section title={intl.formatMessage(M['summary.keyFindings'])}>
          <BulletList items={s.keyFindings} />
        </Section>
      )}
      {s.filesExamined.length > 0 && (
        <Section title={intl.formatMessage(M['summary.filesExamined'])}>
          <ul className='space-y-1'>
            {s.filesExamined.map((f, i) => (
              <li key={i} className='flex flex-wrap gap-x-2'>
                <code className='font-mono text-caption'>{f.file}</code>
                <span>— {f.reason}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}
      {s.nextSteps.length > 0 && (
        <Section title={intl.formatMessage(M['summary.nextSteps'])}>
          <BulletList items={s.nextSteps} />
        </Section>
      )}
    </div>
  )
}

function ImplementationView({ s }: { s: ImplementationShape }) {
  const intl = useIntl()
  return (
    <div className='space-y-4 text-body'>
      <Section title={intl.formatMessage(M['summary.goal'])}>
        <p>
          {s.goal || (
            <em className='text-muted-foreground'>
              {intl.formatMessage(M['summary.noGoal'])}
            </em>
          )}
        </p>
      </Section>
      {s.accomplished.length > 0 && (
        <Section title={intl.formatMessage(M['summary.accomplished'])}>
          <BulletList items={s.accomplished} />
        </Section>
      )}
      {s.keyChanges.length > 0 && (
        <Section title={intl.formatMessage(M['summary.keyChanges'])}>
          <FileChangeList items={s.keyChanges} />
        </Section>
      )}
      {s.unresolved.length > 0 && (
        <Section title={intl.formatMessage(M['summary.unresolved'])}>
          <BulletList items={s.unresolved} />
        </Section>
      )}
    </div>
  )
}

function DebugView({ s }: { s: DebugShape }) {
  const intl = useIntl()
  return (
    <div className='space-y-4 text-body'>
      <div className='flex items-start justify-between gap-4'>
        <Section title={intl.formatMessage(M['summary.problem'])}>
          <p>
            {s.problem || (
              <em className='text-muted-foreground'>
                {intl.formatMessage(M['summary.notDescribed'])}
              </em>
            )}
          </p>
        </Section>
        <StatusChip status={s.status} />
      </div>
      {s.rootCause && (
        <Section title={intl.formatMessage(M['summary.rootCause'])}>
          <p>{s.rootCause}</p>
        </Section>
      )}
      {s.fixApplied.length > 0 && (
        <Section title={intl.formatMessage(M['summary.fixApplied'])}>
          <FileChangeList items={s.fixApplied} />
        </Section>
      )}
      {s.verification.length > 0 && (
        <Section title={intl.formatMessage(M['summary.verification'])}>
          <BulletList items={s.verification} />
        </Section>
      )}
    </div>
  )
}

function RefactorView({ s }: { s: RefactorShape }) {
  const intl = useIntl()
  return (
    <div className='space-y-4 text-body'>
      <Section title={intl.formatMessage(M['summary.refactorGoal'])}>
        <p>
          {s.refactorGoal || (
            <em className='text-muted-foreground'>
              {intl.formatMessage(M['summary.notDescribed'])}
            </em>
          )}
        </p>
      </Section>
      {s.changes.length > 0 && (
        <Section title={intl.formatMessage(M['summary.changes'])}>
          <ul className='space-y-1'>
            {s.changes.map((c, i) => (
              <li key={i} className='flex flex-wrap gap-x-2'>
                <code className='font-mono text-caption'>{c.file}</code>
                <span>— {c.description}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}
      <Section title={intl.formatMessage(M['summary.scope'])}>
        <p className='font-mono text-caption text-muted-foreground'>
          {intl.formatMessage(M['summary.scopeLine'], {
            count: s.scope.filesCount,
            added: s.scope.linesAdded,
            removed: s.scope.linesRemoved,
          })}
        </p>
      </Section>
      {s.behaviorPreservation && (
        <Section title={intl.formatMessage(M['summary.behaviorPreservation'])}>
          <p>{s.behaviorPreservation}</p>
        </Section>
      )}
      {s.followUps.length > 0 && (
        <Section title={intl.formatMessage(M['summary.followUps'])}>
          <BulletList items={s.followUps} />
        </Section>
      )}
    </div>
  )
}

function ReviewView({ s }: { s: ReviewShape }) {
  const intl = useIntl()
  return (
    <div className='space-y-4 text-body'>
      <Section title={intl.formatMessage(M['summary.reviewScope'])}>
        <p>
          {s.reviewScope || (
            <em className='text-muted-foreground'>
              {intl.formatMessage(M['summary.notDescribed'])}
            </em>
          )}
        </p>
      </Section>
      {s.findings.length > 0 && (
        <Section title={intl.formatMessage(M['summary.findings'])}>
          <BulletList items={s.findings} />
        </Section>
      )}
      {(s.severity.critical.length > 0 ||
        s.severity.improvements.length > 0 ||
        s.severity.notes.length > 0) && (
        <Section title={intl.formatMessage(M['summary.bySeverity'])}>
          <div className='space-y-2'>
            {s.severity.critical.length > 0 && (
              <SeverityGroup
                label={intl.formatMessage(M['summary.critical'])}
                tone='critical'
                items={s.severity.critical}
              />
            )}
            {s.severity.improvements.length > 0 && (
              <SeverityGroup
                label={intl.formatMessage(M['summary.improvements'])}
                tone='improvements'
                items={s.severity.improvements}
              />
            )}
            {s.severity.notes.length > 0 && (
              <SeverityGroup
                label={intl.formatMessage(M['summary.notes'])}
                tone='notes'
                items={s.severity.notes}
              />
            )}
          </div>
        </Section>
      )}
      {s.recommendations.length > 0 && (
        <Section title={intl.formatMessage(M['summary.recommendations'])}>
          <BulletList items={s.recommendations} />
        </Section>
      )}
    </div>
  )
}

function MixedView({ s }: { s: MixedShape }) {
  const intl = useIntl()
  return (
    <div className='space-y-4 text-body'>
      <Section title={intl.formatMessage(M['summary.overview'])}>
        <p>{s.overview}</p>
      </Section>
      {s.mainActivities.length > 0 && (
        <Section title={intl.formatMessage(M['summary.mainActivities'])}>
          <BulletList items={s.mainActivities} />
        </Section>
      )}
      {s.unresolved.length > 0 && (
        <Section title={intl.formatMessage(M['summary.unresolved'])}>
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
      <h3 className='mb-1 text-caption font-semibold uppercase text-muted-foreground'>
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
          <code className='font-mono text-caption'>{c.file}</code>
          {c.delta && (
            <span className='font-mono text-caption text-muted-foreground'>
              {c.delta}
            </span>
          )}
          <span>— {c.description}</span>
        </li>
      ))}
    </ul>
  )
}

const STATUS_MESSAGES: Record<DebugStatus, MessageDescriptor> = {
  fixed: M['summary.statusFixed'],
  partial: M['summary.statusPartial'],
  unresolved: M['summary.statusUnresolved'],
}

function StatusChip({ status }: { status: DebugStatus }) {
  const intl = useIntl()
  const variant =
    status === 'fixed' ? 'success' : status === 'partial' ? 'warning' : 'danger'
  return (
    <Badge
      variant={variant}
      size='sm'
      shape='square'
      className='shrink-0 font-semibold uppercase'
    >
      {intl.formatMessage(STATUS_MESSAGES[status])}
    </Badge>
  )
}

// Severity is carried by an icon + the group's label word inside a neutral
// bordered card — never by a coloured stripe alone (LUM-1249).
const SEVERITY_ICONS = {
  critical: { Icon: CircleAlert, className: 'text-danger-text' },
  improvements: { Icon: TriangleAlert, className: 'text-warning-text' },
  notes: { Icon: Info, className: 'text-muted-foreground' },
} as const

function SeverityGroup({
  label,
  tone,
  items,
}: {
  label: string
  tone: 'critical' | 'improvements' | 'notes'
  items: string[]
}) {
  const { Icon, className } = SEVERITY_ICONS[tone]
  return (
    <Card className='rounded-md p-3 shadow-none'>
      <p className='mb-1 flex items-center gap-1.5 text-caption font-semibold uppercase text-muted-foreground'>
        <Icon aria-hidden className={`size-3.5 shrink-0 ${className}`} />
        {label}
      </p>
      <BulletList items={items} />
    </Card>
  )
}

function formatRelativeTime(intl: IntlShape, d: Date, now: number): string {
  const diffMs = now - d.getTime()
  const s = Math.round(diffMs / 1000)
  if (s < 60) return intl.formatMessage(M['summary.relJustNow'])
  const m = Math.round(s / 60)
  if (m < 60) return intl.formatMessage(M['summary.relMinutes'], { n: m })
  const h = Math.round(m / 60)
  if (h < 24) return intl.formatMessage(M['summary.relHours'], { n: h })
  const days = Math.round(h / 24)
  return intl.formatMessage(M['summary.relDays'], { n: days })
}
