'use client'

import { useMemo, useState } from 'react'
import { useIntl } from 'react-intl'
import type { WorkspaceSummaryStats, RiskLevel } from '@/types/summary'
import { RiskBadge } from './RiskBadge'

interface ProjectsAtGlanceListProps {
  projects: WorkspaceSummaryStats['projectBreakdown']
  onNavigate: (projectId: string) => void
}

type FilterKey = 'all' | RiskLevel

const SORT_ORDER: Record<string, number> = {
  'at-risk': 0,
  watch: 1,
  healthy: 2,
  null: 3,
}

export function ProjectsAtGlanceList({
  projects,
  onNavigate,
}: ProjectsAtGlanceListProps) {
  const intl = useIntl()
  const [filter, setFilter] = useState<FilterKey>('all')

  const sorted = useMemo(
    () =>
      [...projects].sort((a, b) => {
        const d =
          (SORT_ORDER[a.risk?.level ?? 'null'] ?? 3) -
          (SORT_ORDER[b.risk?.level ?? 'null'] ?? 3)
        return d !== 0 ? d : b.overdueTasks - a.overdueTasks
      }),
    [projects]
  )

  const counts = useMemo(
    () => ({
      'at-risk': projects.filter(p => p.risk?.level === 'at-risk').length,
      watch: projects.filter(p => p.risk?.level === 'watch').length,
      healthy: projects.filter(p => p.risk?.level === 'healthy').length,
    }),
    [projects]
  )

  const visible =
    filter === 'all' ? sorted : sorted.filter(p => p.risk?.level === filter)

  if (projects.length === 0) return null

  const filters: Array<{ key: FilterKey; labelKey: string; count: number }> = [
    {
      key: 'all',
      labelKey: 'summary.filterAll',
      count: projects.length,
    },
    {
      key: 'at-risk',
      labelKey: 'summary.riskLevel.atRisk',
      count: counts['at-risk'],
    },
    {
      key: 'watch',
      labelKey: 'summary.riskLevel.watch',
      count: counts.watch,
    },
    {
      key: 'healthy',
      labelKey: 'summary.riskLevel.healthy',
      count: counts.healthy,
    },
  ]

  return (
    <div className='rounded-lg border border-zinc-200 dark:border-zinc-800 overflow-hidden'>
      <div className='flex items-center justify-between px-4 py-3 border-b border-zinc-100 dark:border-zinc-800'>
        <p className='text-sm font-semibold text-zinc-800 dark:text-zinc-200'>
          {intl.formatMessage({ id: 'summary.projectsAtGlance' })}
        </p>
        <div className='flex gap-1'>
          {filters.map(f => (
            <button
              key={f.key}
              type='button'
              onClick={() => setFilter(f.key)}
              className={`text-xs px-2 py-1 rounded-md ${
                filter === f.key
                  ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
                  : 'text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800'
              }`}
            >
              {intl.formatMessage({ id: f.labelKey })} ({f.count})
            </button>
          ))}
        </div>
      </div>

      {visible.length === 0 ? (
        <div className='px-4 py-6 text-center text-xs text-zinc-500 dark:text-zinc-400'>
          {intl.formatMessage({
            id: 'summary.noProjectsMatchFilter',
            defaultMessage: 'No projects match this filter',
          })}
        </div>
      ) : (
        <div className='divide-y divide-zinc-100 dark:divide-zinc-800'>
          {visible.map(p => {
            const pct =
              p.totalTasks > 0
                ? Math.round((p.completedTasks / p.totalTasks) * 100)
                : 0
            const reasonLine = p.risk?.reasons
              .slice(0, 2)
              .map(r => r.detail)
              .join(', ')
            return (
              <button
                key={p.projectId}
                type='button'
                data-testid='project-row'
                onClick={() => onNavigate(p.projectId)}
                className='w-full flex items-center gap-4 px-4 py-3 text-left hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors'
              >
                <RiskBadge
                  level={p.risk?.level ?? null}
                  size='sm'
                  showLabel={false}
                />
                <div className='flex-1 min-w-0'>
                  <p
                    data-testid='project-row-name'
                    className='text-sm font-medium text-zinc-800 dark:text-zinc-200 truncate'
                  >
                    {p.projectName}
                  </p>
                  {reasonLine && (
                    <p className='text-xs text-zinc-500 dark:text-zinc-400 truncate'>
                      {reasonLine}
                    </p>
                  )}
                  <div className='mt-1.5 h-1.5 w-full rounded-full bg-zinc-200 dark:bg-zinc-700 overflow-hidden'>
                    <div
                      className='h-full rounded-full bg-indigo-500'
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
                <div className='shrink-0 text-right text-xs text-zinc-500 dark:text-zinc-400 w-20'>
                  <span className='font-medium text-zinc-700 dark:text-zinc-300'>
                    {p.completedTasks}/{p.totalTasks}
                  </span>
                </div>
                {p.overdueTasks > 0 && (
                  <div className='shrink-0 text-xs text-amber-500 font-medium w-24 text-right'>
                    {p.overdueTasks}{' '}
                    {intl
                      .formatMessage({ id: 'summary.overdue' })
                      .toLowerCase()}
                  </div>
                )}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
