'use client'

import { useIntl } from 'react-intl'
import type { TaskStatus } from '@prisma/client'
import type { MilestoneHealth } from '@/lib/summaries/milestone-health'
import { useFormatDate } from '../../hooks/useFormatDate'
import { DATE_OPTS, HEALTH_DOT } from './milestoneDisplay'

/** Neutral placeholder for a stat that has no data — shown, never hidden. */
const EMPTY = '—'

interface MilestoneRollupBarProps {
  taskCounts: Record<TaskStatus, number> | null
  health: MilestoneHealth | null
  startDate: string | null
  targetDate: string | null
  /** One-line key outcome from the generated retro; null until generated. */
  summaryTldr: string | null
}

/**
 * Decision-first rollup at the top of the milestone Overview tab:
 * completion, health light, time span, one-line key outcome. Missing data
 * renders an explicit placeholder — the bar never fabricates a value.
 */
export function MilestoneRollupBar({
  taskCounts,
  health,
  startDate,
  targetDate,
  summaryTldr,
}: MilestoneRollupBarProps) {
  const intl = useIntl()
  const { fmtDate } = useFormatDate()

  const done = taskCounts?.DONE ?? 0
  const total = taskCounts
    ? Object.values(taskCounts).reduce((sum, n) => sum + n, 0)
    : 0
  const pct = total > 0 ? Math.round((done / total) * 100) : null

  const label = (id: string) => (
    <dt className='text-[11px] font-semibold uppercase tracking-wider text-muted-foreground'>
      {intl.formatMessage({ id })}
    </dt>
  )

  return (
    <section
      aria-label={intl.formatMessage({ id: 'milestone.rollup.label' })}
      className='mb-8 border-b border-border pb-6'
    >
      <dl className='flex flex-wrap gap-x-12 gap-y-4'>
        <div>
          {label('milestone.rollup.completion')}
          <dd className='mt-1 text-lg font-semibold tabular-nums'>
            {total > 0 ? (
              <>
                {intl.formatMessage(
                  { id: 'milestone.progress' },
                  { done, total }
                )}
                <span className='ml-2 text-muted-foreground'>{pct}%</span>
              </>
            ) : (
              <span className='font-normal text-muted-foreground'>
                {intl.formatMessage({ id: 'milestone.rollup.noTasks' })}
              </span>
            )}
          </dd>
        </div>

        <div>
          {label('milestone.rollup.health')}
          <dd className='mt-1 flex items-center gap-2 text-lg font-semibold'>
            {health ? (
              <>
                <span
                  className={`h-[7px] w-[7px] shrink-0 rounded-full ${HEALTH_DOT[health]}`}
                  aria-hidden='true'
                />
                {intl.formatMessage({ id: `milestone.health.${health}` })}
              </>
            ) : (
              <span className='font-normal text-muted-foreground'>{EMPTY}</span>
            )}
          </dd>
        </div>

        <div>
          {label('milestone.rollup.timespan')}
          <dd className='mt-1 text-lg font-semibold tabular-nums'>
            {startDate || targetDate ? (
              <>
                {startDate ? fmtDate(startDate, DATE_OPTS) : EMPTY}
                <span className='mx-1.5 text-muted-foreground'>→</span>
                {targetDate ? fmtDate(targetDate, DATE_OPTS) : EMPTY}
              </>
            ) : (
              <span className='font-normal text-muted-foreground'>
                {intl.formatMessage({ id: 'milestone.rollup.noDates' })}
              </span>
            )}
          </dd>
        </div>

        <div className='w-full'>
          {label('milestone.rollup.keyOutcome')}
          <dd className='mt-1 text-sm'>
            {summaryTldr ?? (
              <span className='text-muted-foreground'>
                {intl.formatMessage({ id: 'milestone.rollup.noOutcome' })}
              </span>
            )}
          </dd>
        </div>
      </dl>
    </section>
  )
}
