'use client'

import { useIntl } from 'react-intl'

interface CompletionTrendChartProps {
  trend: Array<{ date: string; completed: number }>
}

const DAY_ABBR = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export function CompletionTrendChart({ trend }: CompletionTrendChartProps) {
  const intl = useIntl()

  const last7 = trend.slice(-7)
  const maxCompleted = Math.max(...last7.map(d => d.completed), 1)

  return (
    <div className='rounded-lg border border-border bg-muted p-4 space-y-3'>
      <p className='text-xs font-semibold uppercase tracking-wider text-muted-foreground'>
        {intl.formatMessage({ id: 'summary.completionTrend' })}
      </p>

      {last7.length === 0 ? (
        <p className='text-xs text-muted-foreground'>No data</p>
      ) : (
        <div className='flex items-end gap-1 h-20'>
          {last7.map(entry => {
            const dayAbbr = DAY_ABBR[new Date(entry.date).getDay()]
            const heightPct =
              maxCompleted > 0 ? (entry.completed / maxCompleted) * 100 : 0

            return (
              <div
                key={entry.date}
                className='flex flex-col items-center gap-1 flex-1'
              >
                <div className='flex-1 w-full flex items-end'>
                  <div
                    className='w-full bg-chart-1 rounded-t transition-all'
                    style={{ height: `${heightPct}%` }}
                    title={`${entry.completed} completed`}
                  />
                </div>
                <span className='text-[10px] text-muted-foreground'>
                  {dayAbbr}
                </span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
