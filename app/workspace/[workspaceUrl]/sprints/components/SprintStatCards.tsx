'use client'

import { useState } from 'react'
import { useIntl } from 'react-intl'
import type { Sprint } from '@prisma/client'
import {
  DAY_MS,
  calendarDayKey,
  deriveSprintState,
  viewerDayKey,
  type DerivedSprintState,
} from '@/lib/services/sprint-date'
import { formatCalendarDate } from '@/lib/datetime/format'
import { SprintBurnupSparkline } from './SprintBurnupSparkline'
import { SprintDateRange } from './SprintDateRange'

interface SprintStatCardsProps {
  sprint: Sprint
  progress: { done: number; total: number }
  /** Refetch after an inline sprint-date edit in the header. */
  onRefresh: () => void
}

const STATE_I18N_KEY: Record<DerivedSprintState, string> = {
  UPCOMING: 'sprints.state.upcoming',
  CURRENT: 'sprints.state.current',
  COMPLETED: 'sprints.state.completed',
}

// Neutral text + a semantic subtle fill/border carries the state colour
// (design-system rule: badge copy stays foreground-neutral, colour signals via
// bg/border), so it survives lint:tokens and both light/dark modes.
const STATE_BADGE: Record<DerivedSprintState, string> = {
  UPCOMING: 'bg-muted text-muted-foreground',
  CURRENT: 'border border-info-border bg-info-subtle text-foreground',
  COMPLETED: 'border border-success-border bg-success-subtle text-foreground',
}

const RING_R = 20
const RING_C = 2 * Math.PI * RING_R

/** One stat card — bordered frame with a header label on top. */
function Card({
  label,
  action,
  children,
}: {
  label: string
  action?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className='flex flex-col gap-2.5 rounded-lg border border-border p-4'>
      <div className='flex items-center justify-between'>
        <span className='text-caption font-semibold uppercase tracking-wider text-muted-foreground'>
          {label}
        </span>
        {action}
      </div>
      {children}
    </div>
  )
}

/**
 * The three sprint stat cards that head the detail page (Progress / Time left /
 * Burnup), laid out above the task board — the relocated, redesigned form of
 * the old right-hand info sidebar.
 */
export function SprintStatCards({
  sprint,
  progress,
  onRefresh,
}: SprintStatCardsProps) {
  const intl = useIntl()

  // Capture "now" once (lazy initializer runs a single time) — stable across
  // renders, so it honors render purity while still measuring time-left.
  const [now] = useState(() => new Date())
  const state = deriveSprintState(sprint, now)

  const pct =
    progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0

  // Sprint endpoints are calendar days: count and render them in the same
  // UTC-pinned frame the rest of the sprint surfaces use, or the detail page
  // disagrees with the landing about which day a sprint ends on.
  const daysLeft = Math.max(
    0,
    (calendarDayKey(sprint.endDate) - viewerDayKey(now)) / DAY_MS
  )
  const endLabel = formatCalendarDate(sprint.endDate, intl.locale)

  const fmtDate = (d: string | Date) => formatCalendarDate(d, intl.locale)

  return (
    <div className='flex flex-col gap-4'>
      {/* Header — name + derived state + inline-editable date range */}
      <div className='flex flex-wrap items-center justify-between gap-x-4 gap-y-1'>
        <div className='flex items-center gap-2.5'>
          <span className='text-title font-semibold tracking-tight'>
            {sprint.name}
          </span>
          <span
            className={`inline-flex rounded-full px-2 py-0.5 text-caption font-medium ${STATE_BADGE[state]}`}
          >
            {intl.formatMessage({ id: STATE_I18N_KEY[state] })}
          </span>
        </div>
        <SprintDateRange sprint={sprint} onRefresh={onRefresh} />
      </div>

      <div className='grid grid-cols-2 gap-3.5 lg:grid-cols-3'>
        {/* Progress — ring + percentage */}
        <Card label={intl.formatMessage({ id: 'sprints.detail.progress' })}>
          <div className='flex items-center gap-3.5'>
            <svg width='48' height='48' viewBox='0 0 48 48' aria-hidden>
              <circle
                className='text-muted'
                cx='24'
                cy='24'
                r={RING_R}
                fill='none'
                stroke='currentColor'
                strokeWidth='5'
              />
              <circle
                className='text-foreground'
                cx='24'
                cy='24'
                r={RING_R}
                fill='none'
                stroke='currentColor'
                strokeWidth='5'
                strokeLinecap='round'
                strokeDasharray={`${(pct / 100) * RING_C} ${RING_C}`}
                transform='rotate(-90 24 24)'
              />
            </svg>
            <div>
              <div className='text-title font-semibold tracking-tight tabular-nums'>
                {pct}%
              </div>
              <div className='text-caption text-muted-foreground'>
                {intl.formatMessage(
                  {
                    id: 'sprints.detail.tasksDone',
                    defaultMessage: '{done} / {total} tasks done',
                  },
                  { done: progress.done, total: progress.total }
                )}
              </div>
            </div>
          </div>
        </Card>

        {/* Time left — days remaining + end date */}
        <Card
          label={intl.formatMessage({
            id: 'sprints.detail.timeLeft',
            defaultMessage: 'Time left',
          })}
        >
          {state === 'COMPLETED' ? (
            <div className='text-title font-semibold tracking-tight'>
              {intl.formatMessage({
                id: 'sprints.detail.timeLeftDone',
                defaultMessage: 'Completed',
              })}
            </div>
          ) : (
            <div className='text-title font-semibold tracking-tight tabular-nums'>
              {intl.formatMessage(
                {
                  id: 'sprints.detail.daysLeft',
                  defaultMessage: '{days, plural, one {# day} other {# days}}',
                },
                { days: daysLeft }
              )}
            </div>
          )}
          <div className='text-caption text-muted-foreground'>
            {intl.formatMessage(
              { id: 'sprints.detail.endsOn', defaultMessage: 'Ends {date}' },
              { date: endLabel }
            )}
          </div>
        </Card>

        {/* Burnup — compact sparkline */}
        <Card
          label={intl.formatMessage({
            id: 'sprints.detail.burnup',
            defaultMessage: 'Burnup',
          })}
        >
          <SprintBurnupSparkline sprintId={sprint.id} formatDate={fmtDate} />
        </Card>
      </div>
    </div>
  )
}
