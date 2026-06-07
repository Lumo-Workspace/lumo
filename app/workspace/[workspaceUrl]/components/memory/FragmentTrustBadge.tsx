'use client'

import { useIntl } from 'react-intl'
import type { TrustVerdict } from '@/types/lineage'

/**
 * Fragment-level "trust score" badge (LUM-303): the cross-task merge
 * contribution of a memory, rendered next to its category label. Neutral
 * muted pill — order via typography, no semantic color (a green low score
 * would mislead). Strong (usage) = solid border; weak (presence) = dashed
 * border + "weak" suffix + dimmed text. Undefined verdict → renders nothing
 * (cold-start / zero-variance / no edges don't get a badge).
 */
export function FragmentTrustBadge({
  verdict,
}: {
  verdict: TrustVerdict | undefined
}) {
  const intl = useIntl()
  if (!verdict) return null

  const isWeak = verdict.kind === 'presence'
  const tooltip = intl.formatMessage(
    {
      id: isWeak ? 'trust.tooltip.presence' : 'trust.tooltip.usage',
      defaultMessage: isWeak
        ? 'Co-loaded in {resolved} resolved tasks · {merged} merged · co-load only, weak signal'
        : 'Used in {resolved} resolved tasks · {merged} merged · real-usage signal',
    },
    { resolved: verdict.resolvedTasks, merged: verdict.mergedTasks }
  )

  return (
    <span
      title={tooltip}
      className={`inline-flex items-baseline gap-1 rounded-sm border bg-muted/50 px-1.5 leading-5 ${
        isWeak ? 'border-dashed border-border' : 'border-border'
      }`}
    >
      <span
        className={`text-[11px] font-semibold tabular-nums ${
          isWeak ? 'text-muted-foreground' : 'text-foreground'
        }`}
      >
        {verdict.pct}%
      </span>
      <span className='text-[10px] text-muted-foreground'>
        {intl.formatMessage(
          {
            id: 'trust.badge.meta',
            defaultMessage: '· {n, plural, one {# task} other {# tasks}}',
          },
          { n: verdict.resolvedTasks }
        )}
        {isWeak
          ? intl.formatMessage({
              id: 'trust.badge.weak',
              defaultMessage: ' · weak',
            })
          : ''}
      </span>
    </span>
  )
}
