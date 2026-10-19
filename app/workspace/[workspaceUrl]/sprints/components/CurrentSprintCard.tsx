'use client'

import Link from 'next/link'
import { useIntl } from 'react-intl'
import type { Sprint } from '@prisma/client'
import { cn } from '@/lib/utils'
import { Card } from '@/components/ui/card'
import {
  useSprint,
  useSprintBurnup,
  useSprintTasks,
} from '../../hooks/useSprints'
import { SprintActionsMenu } from './SprintActionsMenu'
import { formatDate } from '../../components/fields/DatePickerField'
import { daysFromNow, timeElapsedPct } from './sprintLandingUtils'
import { fromSample } from '@/lib/baseline/adapters'
import { BaselineStatView } from '@/components/BaselineStat'
import { Progress } from '@/components/ui/progress'

/** Distinct-assignee count for the contributor row (real, not story points). */
function contributorCount(tasks: unknown[] | undefined): number {
  if (!tasks) return 0
  const ids = new Set<string>()
  for (const raw of tasks) {
    const a = (raw as { assignee?: { id?: string } | null }).assignee
    if (a?.id) ids.add(a.id)
  }
  return ids.size
}

/**
 * Burndown sparkline reconstructed from the burnup series: plots the
 * *remaining* scope (scope − completed) over the sprint, so a line falling to
 * the baseline reads as "work burned down". Returns null when there isn't
 * enough real data to draw a line.
 */
function BurndownSpark({ sprintId }: { sprintId: string }) {
  const { burnup } = useSprintBurnup(sprintId)
  const series = burnup?.series ?? []
  const points = series
    .filter(p => p.completed != null)
    .map(p => Math.max(0, p.scope - (p.completed ?? 0)))
  if (points.length < 2) return null

  const max = Math.max(...points, 1)
  const w = 130
  const h = 26
  const coords = points.map((v, i) => {
    const x = (i / (points.length - 1)) * w
    const y = h - (v / max) * (h - 4) - 2
    return `${x.toFixed(1)},${y.toFixed(1)}`
  })
  const last = coords[coords.length - 1]?.split(',') ?? ['0', '0']

  return (
    <svg
      width='100%'
      height='26'
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio='none'
      className='mt-1 block'
      aria-hidden
    >
      <polyline
        points={coords.join(' ')}
        fill='none'
        className='stroke-success-text'
        strokeWidth='2'
        vectorEffect='non-scaling-stroke'
      />
      <circle cx={last[0]} cy={last[1]} r='2.6' className='fill-success-text' />
    </svg>
  )
}

function Metric({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className='rounded-lg border border-border p-3.5'>
      <div className='text-caption text-muted-foreground'>{label}</div>
      <div className='mt-1 text-heading tabular-nums'>{children}</div>
    </div>
  )
}

/**
 * The hero card for the in-progress sprint. Every figure is derived from real
 * data (task completion, calendar dates, burnup series, distinct assignees) —
 * no story points are invented.
 */
export function CurrentSprintCard({
  sprint,
  workspaceUrl,
  now,
  onChanged,
}: {
  sprint: Sprint
  workspaceUrl: string
  now: number
  onChanged: () => void
}) {
  const intl = useIntl()
  const { sprint: detail, progress } = useSprint(sprint.id)
  const { tasks } = useSprintTasks(sprint.id)

  const done = progress?.done ?? 0
  const total = progress?.total ?? 0
  const remaining = Math.max(0, total - done)
  const pct = total > 0 ? Math.round((done / total) * 100) : 0
  const priorPct = (progress?.priorCompletionRates ?? []).map(r =>
    Math.round(r * 100)
  )
  const completionStat = fromSample(total > 0 ? pct : null, priorPct, 'rate')
  const timePct = timeElapsedPct(sprint.startDate, sprint.endDate, now)
  const daysLeft = Math.max(0, daysFromNow(sprint.endDate, now))
  const contributors = contributorCount(tasks)

  const allDone = total > 0 && done >= total
  // "Early" means days still left on the calendar — the last day itself is
  // still part of the sprint, so finishing on it isn't early.
  const finishedEarly = allDone && daysLeft > 0
  // Ahead of plan when work outpaces elapsed calendar; otherwise behind.
  const onTrack = pct >= timePct
  const href = `/workspace/${workspaceUrl}/sprints/${sprint.number}`

  return (
    <Card asChild className='overflow-hidden rounded-xl'>
      <section>
        {/* Header */}
        <div className='flex items-start justify-between gap-4 px-6 pb-1 pt-5'>
          <div className='min-w-0'>
            <div className='flex flex-wrap items-center gap-2'>
              <Link href={href} className='hover:underline'>
                <h2 className='text-title'>{detail?.name ?? sprint.name}</h2>
              </Link>
              <span className='inline-flex h-[22px] items-center gap-1.5 rounded-md border border-success-border bg-success-subtle px-2 text-caption font-semibold text-success-text'>
                <span className='size-1.5 rounded-full bg-success-text' />
                {intl.formatMessage({ id: 'sprints.status.active' })}
              </span>
              {finishedEarly && (
                <span className='inline-flex h-[22px] items-center rounded-md border border-border bg-muted px-2 text-caption text-muted-foreground'>
                  {intl.formatMessage({ id: 'sprints.landing.finishedEarly' })}
                </span>
              )}
            </div>
            <p className='mt-1.5 font-mono text-caption text-muted-foreground'>
              {formatDate(sprint.startDate, intl.locale)} –{' '}
              {formatDate(sprint.endDate, intl.locale)} ·{' '}
              {intl.formatMessage(
                { id: 'sprints.landing.daysLeft' },
                { count: daysLeft }
              )}
            </p>
          </div>
          <SprintActionsMenu sprint={sprint} onDeleted={onChanged} />
        </div>

        {/* Progress + metrics */}
        <div className='px-6 pb-6 pt-3.5'>
          <div className='mb-2.5 flex items-end justify-between gap-4'>
            <div className='flex items-baseline gap-2'>
              <span className='text-display tabular-nums'>
                {done}
                <span className='font-normal text-muted-foreground'>
                  {' '}
                  / {total}
                </span>
              </span>
              <span className='text-body text-muted-foreground'>
                {intl.formatMessage({ id: 'sprints.landing.tasksComplete' })}
              </span>
            </div>
            <BaselineStatView
              stat={completionStat}
              formatValue={n => `${n}%`}
              baseLabel='baseline.history'
            />
          </div>
          {/* Completion fill on the track; elapsed time is a tick that pokes
            past the track so it reads against the card, not the fill. */}
          <div className='relative mb-5'>
            <Progress value={pct} tone='success' />
            <div
              className='absolute -top-1 h-4 w-0.5 -translate-x-1/2 rounded-sm bg-muted-foreground'
              style={{ left: `${timePct}%` }}
              aria-hidden
            />
          </div>

          <div className='mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4'>
            <Metric
              label={intl.formatMessage({ id: 'sprints.metric.completed' })}
            >
              {done}
            </Metric>
            <Metric
              label={intl.formatMessage({ id: 'sprints.metric.remaining' })}
            >
              {remaining}
            </Metric>
            <Metric
              label={intl.formatMessage({ id: 'sprints.metric.timeLeft' })}
            >
              {daysLeft}
              <span className='ml-1 text-caption text-muted-foreground'>
                {intl.formatMessage({ id: 'sprints.metric.days' })}
              </span>
            </Metric>
            <div className='flex flex-col justify-between rounded-lg border border-border p-3.5'>
              <div className='text-caption text-muted-foreground'>
                {intl.formatMessage({ id: 'sprints.metric.burndown' })}
              </div>
              <BurndownSpark sprintId={sprint.id} />
            </div>
          </div>

          <div className='flex items-center justify-between gap-4'>
            {contributors > 0 ? (
              <span className='text-body text-muted-foreground'>
                {intl.formatMessage(
                  { id: 'sprints.landing.contributors' },
                  { count: contributors }
                )}
              </span>
            ) : (
              <span />
            )}
            <span
              className={cn(
                'text-body-strong',
                onTrack ? 'text-success-text' : 'text-muted-foreground'
              )}
            >
              {intl.formatMessage({
                id: onTrack
                  ? 'sprints.landing.onTrack'
                  : 'sprints.landing.behind',
              })}
            </span>
          </div>
        </div>

        {/* Finished-early banner */}
        {finishedEarly && (
          <div className='flex items-center justify-between gap-4 border-t border-border bg-muted/40 px-6 py-3.5'>
            <span className='text-body text-muted-foreground'>
              {intl.formatMessage(
                { id: 'sprints.landing.finishedEarlyBanner' },
                { count: daysLeft }
              )}
            </span>
            <Link
              href={href}
              className='inline-flex h-8 shrink-0 items-center rounded-md bg-primary px-3 text-body-strong text-primary-foreground transition-colors hover:bg-primary/90'
            >
              {intl.formatMessage({ id: 'sprints.detail.closeSprint' })}
            </Link>
          </div>
        )}
      </section>
    </Card>
  )
}
