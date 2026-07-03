'use client'

import { useIntl } from 'react-intl'
import { cn } from '@/lib/utils'
import type { ApiMilestone } from '@/lib/api-client/milestones'

type GreenQuality = NonNullable<
  NonNullable<ApiMilestone['outcome']>['greenQuality']
>

/** Segment palette — design Milestone Detail 2a, mapped onto repo tokens. */
const SEGMENT = {
  green: 'bg-chart-2',
  amber: 'bg-chart-3',
  red: 'bg-danger',
  blue: 'bg-chart-1',
  gray: 'bg-muted-foreground/30',
  /** The explicit absence bucket — neutral dashed, never a warning color. */
  dashed: 'border border-dashed border-muted-foreground/40 bg-muted/40',
} as const

interface Bucket {
  labelId: string
  count: number
  swatch: string
}

interface MilestoneOutcomeSectionProps {
  greenQuality: GreenQuality | undefined
}

/**
 * LUM-639 acceptance-quality audit footnote (design: Milestone Detail 2a).
 * Three count groups over the milestone's DONE tasks — verification friction,
 * claim faithfulness, criteria referent kind — each as a proportional
 * composition bar + swatch legend + one summary chip. Counts only; no merged
 * score. Absence buckets (no verification record / no frozen contract) render
 * as neutral dashed segments, never as warnings; zero-count legend rows dim
 * rather than disappear. Renders nothing on a pre-LUM-639 payload and an
 * explicit empty line when the milestone has no DONE task yet.
 */
export function MilestoneOutcomeSection({
  greenQuality,
}: MilestoneOutcomeSectionProps) {
  const intl = useIntl()
  if (!greenQuality) return null

  const { doneCount, friction, faithfulness, referentKind } = greenQuality
  const selfConfirmingPlus =
    referentKind.selfConfirming +
    referentKind.other +
    referentKind.noSnapshotTasks

  return (
    <div className='rounded-lg border border-border bg-card p-5'>
      <div className='mb-3.5 flex flex-wrap items-baseline gap-2'>
        <h3 className='text-sm font-semibold'>
          {intl.formatMessage({ id: 'milestone.greenQuality.title' })}
        </h3>
        <span className='text-xs text-muted-foreground'>
          {intl.formatMessage(
            { id: 'milestone.greenQuality.subtitle' },
            { count: doneCount }
          )}
        </span>
      </div>

      {doneCount === 0 ? (
        <p className='text-sm text-muted-foreground'>
          {intl.formatMessage({ id: 'milestone.greenQuality.empty' })}
        </p>
      ) : (
        <>
          <div className='grid gap-x-7 gap-y-5 md:grid-cols-3'>
            <QualityGroup
              titleId='milestone.greenQuality.friction.title'
              chip={intl.formatMessage(
                { id: 'milestone.greenQuality.friction.chip' },
                { clean: friction.singleRound, done: doneCount }
              )}
              chipClass='text-[var(--chart-2)]'
              buckets={[
                {
                  labelId: 'milestone.greenQuality.friction.singleRound',
                  count: friction.singleRound,
                  swatch: SEGMENT.green,
                },
                {
                  labelId: 'milestone.greenQuality.friction.multiRound',
                  count: friction.multiRoundOrSendback,
                  swatch: SEGMENT.amber,
                },
                {
                  labelId: 'milestone.greenQuality.friction.noRecord',
                  count: friction.noVerification,
                  swatch: SEGMENT.dashed,
                },
              ]}
            />
            <QualityGroup
              titleId='milestone.greenQuality.faithfulness.title'
              chip={intl.formatMessage(
                { id: 'milestone.greenQuality.faithfulness.chip' },
                { count: faithfulness.overstated }
              )}
              chipClass={
                faithfulness.overstated === 0
                  ? 'text-[var(--chart-2)]'
                  : 'text-[var(--danger)]'
              }
              buckets={[
                {
                  labelId: 'milestone.greenQuality.faithfulness.faithful',
                  count: faithfulness.faithful,
                  swatch: SEGMENT.green,
                },
                {
                  labelId: 'milestone.greenQuality.faithfulness.overstated',
                  count: faithfulness.overstated,
                  swatch: SEGMENT.red,
                },
                {
                  labelId: 'milestone.greenQuality.faithfulness.underReported',
                  count: faithfulness.underReported,
                  swatch: SEGMENT.blue,
                },
                {
                  labelId: 'milestone.greenQuality.faithfulness.unjudged',
                  count: faithfulness.unjudged,
                  swatch: SEGMENT.gray,
                },
              ]}
            />
            <QualityGroup
              titleId='milestone.greenQuality.referent.title'
              chip={intl.formatMessage(
                { id: 'milestone.greenQuality.referent.chip' },
                { count: selfConfirmingPlus }
              )}
              chipClass='text-[var(--chart-3)]'
              buckets={[
                {
                  labelId: 'milestone.greenQuality.referent.external',
                  count: referentKind.externallyAnchored,
                  swatch: SEGMENT.blue,
                },
                {
                  labelId: 'milestone.greenQuality.referent.selfConfirming',
                  count: referentKind.selfConfirming,
                  swatch: SEGMENT.amber,
                },
                {
                  labelId: 'milestone.greenQuality.referent.other',
                  count: referentKind.other,
                  swatch: SEGMENT.gray,
                },
                {
                  labelId: 'milestone.greenQuality.referent.noSnapshot',
                  count: referentKind.noSnapshotTasks,
                  swatch: SEGMENT.dashed,
                  // Counts tasks, not criteria — kept out of the criteria bar.
                  barExcluded: true,
                },
              ]}
            />
          </div>
          <p className='mt-4 text-xs leading-normal text-muted-foreground'>
            {intl.formatMessage({ id: 'milestone.greenQuality.note' })}
          </p>
        </>
      )}
    </div>
  )
}

/**
 * One bucket group: uppercase title + summary chip, a proportional
 * composition bar over the bar-included buckets, and the full legend —
 * zero-count rows dim but stay visible (explicit, never dropped).
 */
function QualityGroup({
  titleId,
  chip,
  chipClass,
  buckets,
}: {
  titleId: string
  chip: string
  chipClass: string
  buckets: Array<Bucket & { barExcluded?: boolean }>
}) {
  const intl = useIntl()
  const barBuckets = buckets.filter(b => !b.barExcluded && b.count > 0)
  return (
    <div>
      <div className='mb-2 flex items-baseline justify-between gap-2'>
        <p className='text-[11px] font-semibold uppercase tracking-wider text-muted-foreground'>
          {intl.formatMessage({ id: titleId })}
        </p>
        <span className={cn('text-xs font-medium', chipClass)}>{chip}</span>
      </div>
      <div className='mb-3 flex h-[22px] gap-[3px]' aria-hidden='true'>
        {barBuckets.length === 0 ? (
          <span className={cn('flex-1 rounded-sm', SEGMENT.dashed)} />
        ) : (
          barBuckets.map(b => (
            <span
              key={b.labelId}
              className={cn('rounded-sm', b.swatch)}
              style={{ flex: b.count }}
            />
          ))
        )}
      </div>
      <div className='flex flex-col gap-1 text-xs'>
        {buckets.map(b => (
          <div
            key={b.labelId}
            className={cn(
              'flex items-center gap-1.5',
              b.count === 0 && 'text-muted-foreground'
            )}
          >
            <span
              className={cn('size-2 shrink-0 rounded-[2px]', b.swatch)}
              aria-hidden='true'
            />
            <span className='flex-1'>
              {intl.formatMessage({ id: b.labelId })}
            </span>
            <span className='text-[13px] font-semibold tabular-nums'>
              {b.count}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
