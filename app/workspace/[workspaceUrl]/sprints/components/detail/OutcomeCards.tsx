'use client'

import { useIntl } from 'react-intl'
import { fmtCompact } from '../../../components/AgentRunTimeline/model-cost-format'
import { StageCard } from './StageCards'
import type {
  CarriedOverDestination,
  RetroStatsStatus,
} from './retro-view-model'

interface OutcomeCardsProps {
  /** Not `ready` → the stats-backed cards say why instead of showing 0. */
  statsStatus: RetroStatsStatus
  /** The attention read (cost) failed. */
  costFailed: boolean
  /** Tasks verified at close; null when the summary predates LUM-1280. */
  verifiedCount: number | null
  totalTasks: number | null
  /** The previous sprint's stored verified figure, when it has one. */
  previousVerified: { name: string; count: number; total: number } | null
  /** Stored spillover count; null while there is no summary. */
  carriedOver: number | null
  /** Where carried-over tasks went, when that is readable; null hides it. */
  carriedOverDestinations: CarriedOverDestination[] | null
  tokensPerVerifiedTask: number | null
  previousTokensPerVerifiedTask: { name: string; value: number } | null
  reworkShare: number | null
}

/**
 * The closed sprint's outcome cards: verified x / y, carried over, tokens per
 * verified task. Every figure is a stored field — the design's cycle-time card
 * is deliberately absent (no stored field; product ruling, option A).
 */
export function OutcomeCards({
  statsStatus,
  costFailed,
  verifiedCount,
  totalTasks,
  previousVerified,
  carriedOver,
  carriedOverDestinations,
  tokensPerVerifiedTask,
  previousTokensPerVerifiedTask,
  reworkShare,
}: OutcomeCardsProps) {
  const intl = useIntl()
  const t = (id: string, values?: Record<string, string | number>) =>
    intl.formatMessage({ id: `sprints.detail.retro.outcome.${id}` }, values)

  // Why a stats-backed figure is missing, when the stats themselves are.
  const statsGap =
    statsStatus === 'failed'
      ? t('unavailable')
      : statsStatus === 'pending'
        ? intl.formatMessage({ id: 'sprints.detail.retro.carried.pending' })
        : null
  // Verified x / y needs both stored figures.
  const verified =
    verifiedCount !== null && totalTasks !== null
      ? { count: verifiedCount, total: totalTasks }
      : null
  const destinations = (carriedOverDestinations ?? []).map(d =>
    d.sprintName === null
      ? t('toBacklog', { count: d.count })
      : t('toSprint', { count: d.count, name: d.sprintName })
  )

  return (
    <section
      aria-label={t('aria')}
      className='grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4'
    >
      <StageCard
        label={t('verified')}
        badge={
          verified && verified.total > 0
            ? intl.formatNumber(verified.count / verified.total, {
                style: 'percent',
              })
            : null
        }
        count={verified ? `${verified.count} / ${verified.total}` : '—'}
        foot={
          statsGap
            ? statsGap
            : verified === null
              ? t('notRecorded')
              : previousVerified
                ? t('previousVerified', {
                    name: previousVerified.name,
                    count: previousVerified.count,
                    total: previousVerified.total,
                  })
                : null
        }
        sub={t('verifiedDef')}
      />
      <StageCard
        label={t('carriedOver')}
        badge={null}
        count={statsGap ? '—' : (carriedOver ?? '—')}
        foot={statsGap ?? destinations[0] ?? null}
        sub={
          !statsGap && destinations.length > 1
            ? destinations.slice(1).join(' · ')
            : t('carriedOverSub')
        }
      />
      <StageCard
        label={t('perVerified')}
        badge={null}
        count={
          tokensPerVerifiedTask === null
            ? '—'
            : fmtCompact(intl, tokensPerVerifiedTask)
        }
        foot={
          costFailed
            ? t('unavailable')
            : reworkShare === null
              ? null
              : t('rework', {
                  share: intl.formatNumber(reworkShare, { style: 'percent' }),
                })
        }
        sub={
          previousTokensPerVerifiedTask
            ? t('previousTokens', {
                name: previousTokensPerVerifiedTask.name,
                value: fmtCompact(intl, previousTokensPerVerifiedTask.value),
              })
            : t('tokensSub')
        }
      />
    </section>
  )
}
