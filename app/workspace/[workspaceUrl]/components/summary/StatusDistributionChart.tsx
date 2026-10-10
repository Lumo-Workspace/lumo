'use client'

import { useIntl } from 'react-intl'

interface StatusDistributionChartProps {
  distribution: Record<string, number>
}

// Status colors come from the semantic --status-* tokens (single source of
// truth, shared with <StatusIcon> and .mention-task chips). Bars and legend
// dots use the same map.
const STATUS_BG_CLASS: Record<string, string> = {
  BACKLOG: 'bg-status-todo/50',
  TODO: 'bg-status-todo',
  IN_PROGRESS: 'bg-status-in-progress',
  IN_REVIEW: 'bg-status-in-review',
  DONE: 'bg-status-done',
}

const STATUS_KEYS = [
  'BACKLOG',
  'TODO',
  'IN_PROGRESS',
  'IN_REVIEW',
  'DONE',
] as const

export function StatusDistributionChart({
  distribution,
}: StatusDistributionChartProps) {
  const intl = useIntl()

  const STATUS_LABELS: Record<string, string> = {
    BACKLOG: intl.formatMessage({ id: 'status.backlog' }),
    TODO: intl.formatMessage({ id: 'summary.todo' }),
    IN_PROGRESS: intl.formatMessage({ id: 'summary.inProgress' }),
    IN_REVIEW: intl.formatMessage({ id: 'summary.inReview' }),
    DONE: intl.formatMessage({ id: 'summary.done' }),
  }

  const total = STATUS_KEYS.reduce(
    (sum, key) => sum + (distribution[key] ?? 0),
    0
  )

  return (
    <div className='rounded-lg border border-border bg-muted p-4 space-y-3'>
      <p className='text-xs font-semibold uppercase tracking-wider text-muted-foreground'>
        {intl.formatMessage({ id: 'summary.statusDistribution' })}
      </p>

      {total > 0 ? (
        <div className='flex rounded-full overflow-hidden h-3'>
          {STATUS_KEYS.map(key => {
            const count = distribution[key] ?? 0
            if (count === 0) return null
            return (
              <div
                key={key}
                className={STATUS_BG_CLASS[key]}
                style={{ flex: count }}
                title={`${STATUS_LABELS[key]}: ${count}`}
              />
            )
          })}
        </div>
      ) : (
        <div className='h-3 rounded-full bg-muted' />
      )}

      <div className='flex flex-wrap gap-x-4 gap-y-1.5'>
        {STATUS_KEYS.map(key => {
          const count = distribution[key] ?? 0
          // Backlog only shows up once something is in it (LUM-1057).
          if (key === 'BACKLOG' && count === 0) return null
          return (
            <div key={key} className='flex items-center gap-1.5'>
              <span
                className={`inline-block size-2 rounded-full ${STATUS_BG_CLASS[key]}`}
              />
              <span className='text-xs text-muted-foreground'>
                {STATUS_LABELS[key]}
              </span>
              <span className='text-xs font-medium text-foreground'>
                {count}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
