'use client'

import { useIntl } from 'react-intl'
import { formatDuration } from './AgentRunTimeline/format-duration'

// Single delivery KPI: label on top, value below. No hint, no warning tint —
// the block is identical in the in-progress and done delivery cards (LUM-524).
function KpiMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className='flex flex-col'>
      <span className='text-caption text-muted-foreground'>{label}</span>
      <span className='text-body-strong tabular-nums'>{value}</span>
    </div>
  )
}

/**
 * Shared bottom KPI block for the delivery card — the same labeled three-column
 * layout (运行次数 / 交互轮次 / 运行时长) whether the task is in-progress or done.
 * Values only: forecast ranges and over-budget warnings live in the token zone,
 * not here. `null` renders as an em-dash. `duration` is in seconds.
 */
export function DeliveryKpis({
  runs,
  interactionRounds,
  duration,
}: {
  runs: number | null
  interactionRounds: number | null
  duration: number | null
}) {
  const intl = useIntl()
  const fmtCount = (n: number | null) =>
    n !== null ? String(Math.round(n)) : '—'
  return (
    <div className='mt-4 border-t border-border pt-3'>
      <p className='mb-2 text-caption text-muted-foreground'>
        {intl.formatMessage({ id: 'retrospective.delivery' })}
      </p>
      <div className='flex flex-wrap gap-x-8 gap-y-2'>
        <KpiMetric
          label={intl.formatMessage({ id: 'retrospective.iterations' })}
          value={fmtCount(runs)}
        />
        <KpiMetric
          label={intl.formatMessage({
            id: 'retrospective.interactionRounds',
          })}
          value={fmtCount(interactionRounds)}
        />
        <KpiMetric
          label={intl.formatMessage({ id: 'retrospective.totalDuration' })}
          value={duration !== null ? formatDuration(duration * 1000) : '—'}
        />
      </div>
    </div>
  )
}
