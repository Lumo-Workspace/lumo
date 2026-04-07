'use client'

import { useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { useIntl } from 'react-intl'
import type { TaskSummaryStats } from '@/types/summary'

interface AdditionalStatsProps {
  stats: TaskSummaryStats
}

export function AdditionalStats({ stats }: AdditionalStatsProps) {
  const intl = useIntl()
  const [expanded, setExpanded] = useState(false)

  const subtaskRateDisplay =
    stats.subtaskCompletionRate !== null
      ? `${Math.round(stats.subtaskCompletionRate)}%`
      : 'N/A'

  return (
    <div className='rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900'>
      <button
        onClick={() => setExpanded(prev => !prev)}
        className='flex items-center justify-between w-full px-4 py-3 text-sm font-medium text-zinc-700 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors'
      >
        <span>{intl.formatMessage({ id: 'summary.additionalStats' })}</span>
        {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
      </button>

      {expanded && (
        <div className='border-t border-zinc-200 dark:border-zinc-800 px-4 py-4 grid grid-cols-2 md:grid-cols-4 gap-4'>
          {/* Priority Distribution */}
          <div className='space-y-2'>
            <p className='text-xs font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500'>
              {intl.formatMessage({ id: 'summary.priorityDistribution' })}
            </p>
            <ul className='space-y-1'>
              {Object.entries(stats.priorityDistribution).map(
                ([priority, count]) => (
                  <li
                    key={priority}
                    className='flex items-center justify-between'
                  >
                    <span className='text-xs text-zinc-600 dark:text-zinc-400 capitalize'>
                      {priority.toLowerCase()}
                    </span>
                    <span className='text-xs font-medium text-zinc-800 dark:text-zinc-200'>
                      {count}
                    </span>
                  </li>
                )
              )}
            </ul>
          </div>

          {/* Subtask Completion Rate */}
          <div className='space-y-2'>
            <p className='text-xs font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500'>
              {intl.formatMessage({ id: 'summary.subtaskRate' })}
            </p>
            <p className='text-2xl font-bold text-zinc-900 dark:text-zinc-100'>
              {subtaskRateDisplay}
            </p>
          </div>

          {/* Agent Stats */}
          <div className='space-y-2'>
            <p className='text-xs font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500'>
              {intl.formatMessage({ id: 'summary.agentStats' })}
            </p>
            <ul className='space-y-1'>
              <li className='flex items-center justify-between'>
                <span className='text-xs text-zinc-600 dark:text-zinc-400'>
                  {intl.formatMessage({ id: 'summary.total' })}
                </span>
                <span className='text-xs font-medium text-zinc-800 dark:text-zinc-200'>
                  {stats.agentStats.total}
                </span>
              </li>
              <li className='flex items-center justify-between'>
                <span className='text-xs text-zinc-600 dark:text-zinc-400'>
                  {intl.formatMessage({ id: 'summary.completed' })}
                </span>
                <span className='text-xs font-medium text-zinc-800 dark:text-zinc-200'>
                  {stats.agentStats.completed}
                </span>
              </li>
              <li className='flex items-center justify-between'>
                <span className='text-xs text-zinc-600 dark:text-zinc-400'>
                  {intl.formatMessage({ id: 'summary.failed' })}
                </span>
                <span className='text-xs font-medium text-zinc-800 dark:text-zinc-200'>
                  {stats.agentStats.failed}
                </span>
              </li>
              <li className='flex items-center justify-between'>
                <span className='text-xs text-zinc-600 dark:text-zinc-400'>
                  {intl.formatMessage({ id: 'summary.working' })}
                </span>
                <span className='text-xs font-medium text-zinc-800 dark:text-zinc-200'>
                  {stats.agentStats.working}
                </span>
              </li>
            </ul>
          </div>

          {/* PR Stats */}
          <div className='space-y-2'>
            <p className='text-xs font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500'>
              {intl.formatMessage({ id: 'summary.prStats' })}
            </p>
            <ul className='space-y-1'>
              <li className='flex items-center justify-between'>
                <span className='text-xs text-zinc-600 dark:text-zinc-400'>
                  {intl.formatMessage({ id: 'summary.total' })}
                </span>
                <span className='text-xs font-medium text-zinc-800 dark:text-zinc-200'>
                  {stats.prStats.total}
                </span>
              </li>
              <li className='flex items-center justify-between'>
                <span className='text-xs text-zinc-600 dark:text-zinc-400'>
                  {intl.formatMessage({ id: 'summary.merged' })}
                </span>
                <span className='text-xs font-medium text-zinc-800 dark:text-zinc-200'>
                  {stats.prStats.merged}
                </span>
              </li>
              <li className='flex items-center justify-between'>
                <span className='text-xs text-zinc-600 dark:text-zinc-400'>
                  {intl.formatMessage({ id: 'summary.open' })}
                </span>
                <span className='text-xs font-medium text-zinc-800 dark:text-zinc-200'>
                  {stats.prStats.open}
                </span>
              </li>
            </ul>
          </div>
        </div>
      )}
    </div>
  )
}
