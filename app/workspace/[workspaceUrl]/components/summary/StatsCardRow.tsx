'use client'

import { useIntl } from 'react-intl'
import { cn } from '@/lib/utils'
import type { TaskSummaryStats } from '@/types/summary'

interface StatsCardRowProps {
  stats: TaskSummaryStats
}

interface StatCardProps {
  label: string
  value: string | number
  valueClassName?: string
}

function StatCard({ label, value, valueClassName }: StatCardProps) {
  return (
    <div className='rounded-lg border border-border bg-muted p-4 flex flex-col gap-1'>
      <span
        className={cn(
          'text-2xl font-bold',
          valueClassName ?? 'text-foreground'
        )}
      >
        {value}
      </span>
      <span className='text-xs text-muted-foreground'>{label}</span>
    </div>
  )
}

export function StatsCardRow({ stats }: StatsCardRowProps) {
  const intl = useIntl()

  const completed = stats.statusDistribution['DONE'] ?? 0
  const overdue = stats.overdueTasks.count

  const avgCompletionValue =
    stats.avgCompletionTime !== null
      ? intl.formatMessage(
          { id: 'summary.hours' },
          { count: Math.round(stats.avgCompletionTime * 10) / 10 }
        )
      : 'N/A'

  return (
    <div className='grid grid-cols-2 md:grid-cols-4 gap-3'>
      <StatCard
        label={intl.formatMessage({ id: 'summary.totalTasks' })}
        value={stats.totalTasks}
      />
      <StatCard
        label={intl.formatMessage({ id: 'summary.completed' })}
        value={completed}
        valueClassName='text-green-500'
      />
      <StatCard
        label={intl.formatMessage({ id: 'summary.overdue' })}
        value={overdue}
        valueClassName={
          overdue > 0 ? 'text-amber-500' : 'text-foreground'
        }
      />
      <StatCard
        label={intl.formatMessage({ id: 'summary.avgCompletion' })}
        value={avgCompletionValue}
        valueClassName='text-indigo-400'
      />
    </div>
  )
}
