'use client'

import Link from 'next/link'
import { useIntl } from 'react-intl'
import type { Sprint } from '@prisma/client'
import { cn } from '@/lib/utils'
import { useSprint } from '../../hooks/useSprints'
import { formatDate } from './DatePickerField'

const DAY = 24 * 60 * 60 * 1000

interface Domain {
  min: number
  max: number
}

function pctOf(t: number, d: Domain): number {
  if (d.max <= d.min) return 0
  return ((t - d.min) / (d.max - d.min)) * 100
}

/** First-of-month ticks spanning the domain, for the month axis + gridlines. */
function monthTicks(d: Domain): Array<{ pos: number; label: string }> {
  const fmt = new Intl.DateTimeFormat(undefined, { month: 'short' })
  const out: Array<{ pos: number; label: string }> = []
  const start = new Date(d.min)
  const cursor = new Date(start.getFullYear(), start.getMonth(), 1)
  // Begin at the first month boundary at or after the domain start.
  if (cursor.getTime() < d.min) cursor.setMonth(cursor.getMonth() + 1)
  while (cursor.getTime() <= d.max) {
    out.push({ pos: pctOf(cursor.getTime(), d), label: fmt.format(cursor) })
    cursor.setMonth(cursor.getMonth() + 1)
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

  const start = new Date(sprint.startDate).getTime()
  const end = new Date(sprint.endDate).getTime()
  const left = Math.max(0, pctOf(start, domain))
  const width = Math.max(2, pctOf(end, domain) - left)

  const dot = {
    completed: 'bg-muted-foreground/40',
    active: 'bg-success',
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
              'truncate text-[13.5px] font-semibold leading-tight',
              bucket === 'completed'
                ? 'text-muted-foreground'
                : 'text-foreground'
            )}
          >
            {sprint.name}
          </div>
          <div className='truncate font-mono text-[10.5px] text-muted-foreground'>
            {formatDate(sprint.startDate)} – {formatDate(sprint.endDate)}
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
          {enabled && (
            <div
              className={cn(
                'absolute inset-y-0 left-0',
                bucket === 'active' ? 'bg-success/35' : 'bg-muted-foreground/15'
              )}
              style={{ width: `${pct}%` }}
              aria-hidden
            />
          )}
          <span
            className={cn(
              'relative whitespace-nowrap px-2.5 font-mono text-[11px] font-semibold',
              bucket === 'completed' && 'text-muted-foreground',
              bucket === 'active' && 'text-success',
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
      <div className='rounded-xl border border-border bg-card py-16 text-center shadow-elevation-1'>
        <div className='text-sm font-semibold text-muted-foreground'>
          {intl.formatMessage({ id: 'sprints.landing.noResults' })}
        </div>
      </div>
    )
  }

  const ordered = sprints
    .slice()
    .sort(
      (a, b) =>
        new Date(a.startDate).getTime() - new Date(b.startDate).getTime()
    )
  const starts = ordered.map(s => new Date(s.startDate).getTime())
  const ends = ordered.map(s => new Date(s.endDate).getTime())
  // Pad the domain a few days each side so end-anchored bars aren't flush.
  const domain: Domain = {
    min: Math.min(...starts, now) - 3 * DAY,
    max: Math.max(...ends, now) + 3 * DAY,
  }
  const months = monthTicks(domain)
  const todayPos = pctOf(now, domain)

  function bucketOf(s: Sprint): 'completed' | 'active' | 'planned' {
    const start = new Date(s.startDate).getTime()
    const end = new Date(s.endDate).getTime()
    if (end < now) return 'completed'
    if (start > now) return 'planned'
    return 'active'
  }

  return (
    <div>
      <div className='mb-3.5 flex flex-wrap items-center gap-2.5'>
        <span className='text-xs font-semibold text-muted-foreground'>
          {intl.formatMessage({ id: 'sprints.view.timeline' })}
        </span>
        <span className='text-xs text-muted-foreground'>·</span>
        <span className='text-xs text-muted-foreground'>
          {intl.formatMessage(
            { id: 'sprints.timeline.count' },
            { count: ordered.length }
          )}
        </span>
        <div className='ml-auto flex flex-wrap items-center gap-3.5 text-[11.5px] text-muted-foreground'>
          <LegendDot
            className='bg-muted-foreground/40'
            label={intl.formatMessage({ id: 'sprints.state.completed' })}
          />
          <LegendDot
            className='bg-success'
            label={intl.formatMessage({ id: 'sprints.status.active' })}
          />
          <LegendDot
            className='border border-dashed border-muted-foreground/50'
            label={intl.formatMessage({ id: 'sprints.state.upcoming' })}
          />
        </div>
      </div>

      <div className='rounded-xl border border-border bg-card px-5 pb-5 pt-4 shadow-elevation-1'>
        {/* Month axis */}
        <div className='mb-2 grid grid-cols-[168px_1fr]'>
          <div />
          <div className='relative h-4'>
            {months.map((m, i) => (
              <span
                key={i}
                className='absolute top-0 border-l border-border pl-1.5 text-[11.5px] font-medium text-muted-foreground'
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
                <span className='absolute -top-1 left-1.5 whitespace-nowrap rounded-sm bg-primary px-1.5 py-0.5 text-[10px] font-semibold text-primary-foreground'>
                  {intl.formatMessage({ id: 'sprints.timeline.today' })}
                </span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
