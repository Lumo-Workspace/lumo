'use client'

import { useIntl } from 'react-intl'
import { Badge } from '@/components/ui/badge'
import {
  Card,
  CardAction,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
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

/**
 * One metric card; also the closed-sprint outcome card (LUM-1281). Built as
 * shadcn's metric card: label + figure in the header with the badge as its
 * action, the explanation in the footer.
 */
export function StageCard({ label, badge, count, foot, sub }: StageCardProps) {
  return (
    <Card className='flex flex-col'>
      <CardHeader className='space-y-1 p-4 sm:p-6'>
        <CardDescription className='text-caption sm:text-body'>
          {label}
        </CardDescription>
        <CardTitle className='text-heading tabular-nums sm:text-display'>
          {count}
        </CardTitle>
        {badge && (
          <CardAction className='hidden sm:block'>
            <Badge variant='outline' size='sm'>
              {badge}
            </Badge>
          </CardAction>
        )}
      </CardHeader>
      {(foot || sub) && (
        <CardFooter className='flex-col items-start gap-1 p-4 pt-0 sm:p-6 sm:pt-0'>
          {foot && <span className='text-body-strong'>{foot}</span>}
          {sub && (
            <span className='text-body text-muted-foreground'>{sub}</span>
          )}
        </CardFooter>
      )}
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
