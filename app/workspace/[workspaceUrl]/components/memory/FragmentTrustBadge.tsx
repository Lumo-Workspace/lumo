'use client'

import { useIntl } from 'react-intl'
import type { TrustVerdict } from '@/types/lineage'

/**
 * Fragment-level "trust score" badge (LUM-303, LUM-539): a memory's cross-task
 * judged-used track record, rendered next to its category label. Neutral muted
 * pill — order via typography, no semantic color (a green low score would
 * mislead). Proven (`qualified`) = solid border; not-yet-proven = dashed border
 * + "unproven" suffix + dimmed text. Undefined verdict → renders nothing
 * (cold-start / no audited edges don't get a badge).
 */
export function FragmentTrustBadge({
  verdict,
}: {
  verdict: TrustVerdict | undefined
}) {
  const intl = useIntl()
  if (!verdict) return null

  const isWeak = !verdict.qualified
  const tooltip = intl.formatMessage(
    {
      id: 'trust.tooltip.judgedUsed',
      defaultMessage:
        'Judged used in {used} of {appeared} tasks · {pct}% of audited · judged-used track record',
    },
    {
      used: verdict.judgedUsedTasks,
      appeared: verdict.appearanceTasks,
      pct: verdict.usefulnessPct,
    }
  )

  return (
    <span
      title={tooltip}
      className={`inline-flex items-baseline gap-1 rounded-sm border border-border bg-muted/50 px-1.5 leading-5 ${
        isWeak ? 'border-dashed' : ''
      }`}
    >
      <span
        className={`text-caption font-semibold tabular-nums ${
          isWeak ? 'text-muted-foreground' : 'text-foreground'
        }`}
      >
        {verdict.usefulnessPct}%
      </span>
      <span className='text-caption text-muted-foreground'>
        {intl.formatMessage(
          {
            id: 'trust.badge.judgedUsed',
            defaultMessage: '· judged-used {used}/{appeared}',
          },
          { used: verdict.judgedUsedTasks, appeared: verdict.appearanceTasks }
        )}
        {isWeak &&
          intl.formatMessage({
            id: 'trust.badge.unproven',
            defaultMessage: ' · unproven',
          })}
      </span>
    </span>
  )
}
