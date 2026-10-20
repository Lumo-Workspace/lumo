'use client'

import { useIntl } from 'react-intl'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import type { StageCardsModel } from './view-model'
import { formatDwellDays } from './format'

export interface StageCardProps {
  label: string
  badge: string | null
  /** The big figure: a count, or a preformatted value ("27 / 31"). */
  count: number | string
  foot: string | null
  sub: string | null
}

/** One metric card; also the closed-sprint outcome card (LUM-1281). */
export function StageCard({ label, badge, count, foot, sub }: StageCardProps) {
  return (
    <Card className='flex flex-col gap-1.5 p-4 sm:p-6'>
      <div className='flex items-start justify-between gap-2'>
        <span className='text-caption text-muted-foreground sm:text-body'>
          {label}
        </span>
        {badge && (
          <Badge variant='outline' size='sm' className='hidden sm:inline-flex'>
            {badge}
          </Badge>
        )}
      </div>
      <span className='text-heading tabular-nums sm:text-display'>{count}</span>
      {foot && <span className='text-body-strong'>{foot}</span>}
      {sub && <span className='text-body text-muted-foreground'>{sub}</span>}
    </Card>
  )
}

/**
 * The four flow stages: agent in progress, in review / ruling, done awaiting
 * verification, verified. Counts only — the model is built from the
 * attention DTO by `buildStageCards`.
 */
export function StageCards({
  inProgress,
  inReview,
  awaitingVerification,
  verified,
}: StageCardsModel) {
  const intl = useIntl()
  const t = (id: string, values?: Record<string, string | number>) =>
    intl.formatMessage({ id: `sprints.detail.stage.${id}` }, values)
  const median = (sec: number | null) =>
    sec === null ? null : t('median', { days: formatDwellDays(intl, sec) })

  return (
    <section
      aria-label={t('aria')}
      className='grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4'
    >
      <StageCard
        label={t('inProgress')}
        badge={median(inProgress.medianDwellSec)}
        count={inProgress.count}
        foot={null}
        sub={t('calendarTime')}
      />
      <StageCard
        label={t('inReview')}
        badge={median(inReview.medianDwellSec)}
        count={inReview.count}
        foot={t('inReviewFoot', {
          prs: inReview.prReviews,
          crossings: inReview.crossingRulings,
        })}
        sub={t('calendarTime')}
      />
      <StageCard
        label={t('awaitingVerification')}
        badge={null}
        count={awaitingVerification.count}
        foot={t('missingTc', { count: awaitingVerification.missingTc })}
        sub={null}
      />
      <StageCard
        label={t('verified')}
        badge={
          verified.total > 0
            ? intl.formatNumber(verified.count / verified.total, {
                style: 'percent',
              })
            : null
        }
        count={verified.count}
        foot={t('total', { count: verified.total })}
        sub={t('notStarted', { count: verified.notStarted })}
      />
    </section>
  )
}
