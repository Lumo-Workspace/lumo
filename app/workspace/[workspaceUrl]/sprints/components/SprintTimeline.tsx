'use client'

import Link from 'next/link'
import { useIntl } from 'react-intl'
import type { Sprint } from '@prisma/client'
import { cn } from '@/lib/utils'
import { Card } from '@/components/ui/card'
import {
  DAY_MS as DAY,
  calendarDayKey,
  viewerDayKey,
} from '@/lib/services/sprint-date'
import { useSprint } from '../../hooks/useSprints'
import { formatDate } from './DatePickerField'
import { Badge } from '@/components/ui/badge'

interface Domain {
  min: number
  max: number
}

function pctOf(t: number, d: Domain): number {
  if (d.max <= d.min) return 0
  return ((t - d.min) / (d.max - d.min)) * 100
}

/**
 * First-of-month ticks spanning the domain, for the month axis + gridlines.
 * The domain is calendar-day keys (UTC midnight), so the cursor walks in UTC —
 * reading local month fields off a UTC key puts the "Jul" tick on Jun 30 for
 * viewers west of UTC.
 */
function monthTicks(
  d: Domain,
  locale: string
): Array<{ pos: number; label: string }> {
  const fmt = new Intl.DateTimeFormat(locale, {
    month: 'short',
    timeZone: 'UTC',
  })
  const out: Array<{ pos: number; label: string }> = []
  const start = new Date(d.min)
  const cursor = new Date(
    Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1)
  )
  // Begin at the first month boundary at or after the domain start.
  if (cursor.getTime() < d.min) cursor.setUTCMonth(cursor.getUTCMonth() + 1)
  while (cursor.getTime() <= d.max) {
    out.push({ pos: pctOf(cursor.getTime(), d), label: fmt.format(cursor) })
    cursor.setUTCMonth(cursor.getUTCMonth() + 1)
  }
  return out
}

function TimelineRow({
  sprint,
  domain,
  bucket,
  href,
}: {
  sprint: Sprint
  domain: Domain
  bucket: 'completed' | 'active' | 'planned'
  href: string
}) {
  const intl = useIntl()
  // Completion fill is real (task progress); planned sprints have no work yet.
  const enabled = bucket !== 'planned'
  const { progress } = useSprint(enabled ? sprint.id : null)
  const total = progress?.total ?? 0
  const done = progress?.done ?? 0
  const pct = total > 0 ? Math.round((done / total) * 100) : 0

  // Bars span through the end of the inclusive last day, so a 14-day sprint
  // covers 14 days of axis rather than stopping at the start of day 14.
  const start = calendarDayKey(sprint.startDate)
  const end = calendarDayKey(sprint.endDate) + DAY
  const left = Math.max(0, pctOf(start, domain))
  const width = Math.max(2, pctOf(end, domain) - left)

  const dot = {
    completed: 'bg-muted-foreground/40',
    active: 'bg-success-text',
    planned: 'border border-dashed border-muted-foreground/50',
  }[bucket]

  const barLabel = enabled
    ? `${done}/${total}`
    : intl.formatMessage({ id: 'sprints.status.draft' })

  return (
    <Link
      href={href}
      className='relative z-10 grid grid-cols-[168px_1fr] items-center'
    >
      <div className='flex items-center gap-2.5 pr-3.5'>
        <span className={cn('size-2 shrink-0 rounded-full', dot)} />
        <div className='min-w-0'>
          <div
            className={cn(
              'truncate text-body-strong',
              bucket === 'completed'
                ? 'text-muted-foreground'
                : 'text-foreground'
            )}
          >
            {sprint.name}
          </div>
          <div className='truncate font-mono text-caption text-muted-foreground'>
            {formatDate(sprint.startDate, intl.locale)} –{' '}
            {formatDate(sprint.endDate, intl.locale)}
          </div>
        </div>
      </div>
      <div className='relative h-12'>
        <div
          className={cn(
            'absolute top-[9px] flex h-[30px] items-center overflow-hidden rounded-lg',
            bucket === 'completed' && 'bg-muted',
            bucket === 'active' && 'bg-success-subtle',
            bucket === 'planned' &&
              'border border-dashed border-muted-foreground/40 bg-transparent'
          )}
          style={{ left: `${left}%`, width: `${width}%` }}
        >
          {/* Active progress is a bottom strip, not a fill behind the label:
              the strip clears 3:1 on the subtle bar while the label keeps
              AA on the bar itself (a darker full-height fill can't do both). */}
          {enabled && (
            <div
              className={cn(
                'absolute left-0',
                bucket === 'active'
                  ? 'bottom-0 h-[3px] bg-success-text'
                  : 'inset-y-0 bg-muted-foreground/15'
              )}
              style={{ width: `${pct}%` }}
              aria-hidden
            />
          )}
          <span
            className={cn(
              'relative whitespace-nowrap px-2.5 font-mono text-caption font-semibold',
              bucket === 'completed' && 'text-muted-foreground',
              bucket === 'active' && 'text-success-text',
              bucket === 'planned' && 'text-muted-foreground'
            )}
          >
            {barLabel}
          </span>
        </div>
      </div>
    </Link>
  )
}

function LegendDot({ className, label }: { className: string; label: string }) {
  return (
    <span className='inline-flex items-center gap-1.5'>
      <span className={cn('size-2.5 rounded-[3px]', className)} />
      {label}
    </span>
  )
}

/**
 * Gantt-style timeline of every sprint, positioned by real start/end dates
 * over a shared month axis, with a "today" marker. Completion fill comes from
 * each sprint's task progress.
 */
export function SprintTimeline({
  sprints,
  workspaceUrl,
  now,
}: {
  sprints: Sprint[]
  workspaceUrl: string
  now: number
}) {
  const intl = useIntl()

  if (sprints.length === 0) {
    return (
      <Card className='rounded-xl py-16 text-center'>
        <div className='text-body-strong text-muted-foreground'>
          {intl.formatMessage({ id: 'sprints.landing.noResults' })}
        </div>
      </Card>
    )
  }

  // Everything on this axis is a calendar-day key (UTC midnight), including
  // "today" — the bars are drawn from UTC-pinned dates, so the marker has to
  // live in that same frame or it drifts by the viewer's UTC offset.
  const today = viewerDayKey(now)
  const ordered = sprints
    .slice()
    .sort((a, b) => calendarDayKey(a.startDate) - calendarDayKey(b.startDate))
  const starts = ordered.map(s => calendarDayKey(s.startDate))
  const ends = ordered.map(s => calendarDayKey(s.endDate) + DAY)
  // Pad the domain a few days each side so end-anchored bars aren't flush.
  const domain: Domain = {
    min: Math.min(...starts, today) - 3 * DAY,
    max: Math.max(...ends, today) + 3 * DAY,
  }
  const months = monthTicks(domain, intl.locale)
  const todayPos = pctOf(today, domain)

  function bucketOf(s: Sprint): 'completed' | 'active' | 'planned' {
    const start = calendarDayKey(s.startDate)
    const end = calendarDayKey(s.endDate)
    if (end < today) return 'completed'
    if (start > today) return 'planned'
    return 'active'
  }

  return (
    <div>
      <div className='mb-3.5 flex flex-wrap items-center gap-2.5'>
        <span className='text-caption font-semibold text-muted-foreground'>
          {intl.formatMessage({ id: 'sprints.view.timeline' })}
        </span>
        <span className='text-caption text-muted-foreground'>·</span>
        <span className='text-caption text-muted-foreground'>
          {intl.formatMessage(
            { id: 'sprints.timeline.count' },
            { count: ordered.length }
          )}
        </span>
        <div className='ml-auto flex flex-wrap items-center gap-3.5 text-caption text-muted-foreground'>
          <LegendDot
            className='bg-muted-foreground/40'
            label={intl.formatMessage({ id: 'sprints.state.completed' })}
          />
          <LegendDot
            className='bg-success-text'
            label={intl.formatMessage({ id: 'sprints.status.active' })}
          />
          <LegendDot
            className='border border-dashed border-muted-foreground/50'
            label={intl.formatMessage({ id: 'sprints.state.upcoming' })}
          />
        </div>
      </div>

      <Card className='rounded-xl px-5 pb-5 pt-4'>
        {/* Month axis */}
        <div className='mb-2 grid grid-cols-[168px_1fr]'>
          <div />
          <div className='relative h-4'>
            {months.map((m, i) => (
              <span
                key={i}
                className='absolute top-0 border-l border-border pl-1.5 text-caption text-muted-foreground'
                style={{ left: `${m.pos}%` }}
              >
                {m.label}
              </span>
            ))}
          </div>
        </div>

        {/* Plot */}
        <div className='relative'>
          {/* gridlines */}
          <div className='pointer-events-none absolute inset-y-0 left-[168px] right-0 z-0'>
            {months.map((m, i) => (
              <div
                key={i}
                className='absolute inset-y-0 border-l border-border/50'
                style={{ left: `${m.pos}%` }}
              />
            ))}
          </div>

          {/* rows */}
          {ordered.map(s => (
            <TimelineRow
              key={s.id}
              sprint={s}
              domain={domain}
              bucket={bucketOf(s)}
              href={`/workspace/${workspaceUrl}/sprints/${s.number}`}
            />
          ))}

          {/* today marker (above bars) */}
          {todayPos >= 0 && todayPos <= 100 && (
            <div className='pointer-events-none absolute inset-y-0 left-[168px] right-0 z-20'>
              <div
                className='absolute -top-0.5 bottom-2 border-l-2 border-dashed border-primary'
                style={{ left: `${todayPos}%` }}
              >
                <Badge
                  size='xs'
                  shape='square'
                  className='absolute -top-1 left-1.5'
                >
                  {intl.formatMessage({ id: 'sprints.timeline.today' })}
                </Badge>
              </div>
            </div>
          )}
        </div>
      </Card>
    </div>
  )
}
