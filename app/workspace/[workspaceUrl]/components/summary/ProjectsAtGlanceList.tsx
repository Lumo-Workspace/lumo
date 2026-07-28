'use client'

import { useMemo } from 'react'
import { useIntl } from 'react-intl'
import type { WorkspaceSummaryStats } from '@/types/summary'

interface ProjectsAtGlanceListProps {
  projects: WorkspaceSummaryStats['projectBreakdown']
  onNavigate: (projectId: string) => void
}

export function ProjectsAtGlanceList({
  projects,
  onNavigate,
}: ProjectsAtGlanceListProps) {
  const intl = useIntl()

  // Most overdue first — the ordering the risk badge used to encode.
  const sorted = useMemo(
    () => [...projects].sort((a, b) => b.overdueTasks - a.overdueTasks),
    [projects]
  )

  if (projects.length === 0) return null

  return (
    <div className='rounded-lg border border-border overflow-hidden'>
      <div className='flex items-center justify-between px-4 py-3 border-b border-border'>
        <p className='text-sm font-semibold text-foreground'>
          {intl.formatMessage({ id: 'summary.projectsAtGlance' })}
        </p>
      </div>

      <div className='divide-y divide-border'>
        {sorted.map(p => {
          const pct =
            p.totalTasks > 0
              ? Math.round((p.completedTasks / p.totalTasks) * 100)
              : 0
          return (
            <button
              key={p.projectId}
              type='button'
              data-testid='project-row'
              onClick={() => onNavigate(p.projectId)}
              className='w-full flex items-center gap-4 px-4 py-3 text-left hover:bg-muted transition-colors'
            >
              <div className='flex-1 min-w-0'>
                <p
                  data-testid='project-row-name'
                  className='text-sm font-medium text-foreground truncate'
                >
                  {p.projectName}
                </p>
                <div className='mt-1.5 h-1.5 w-full rounded-full bg-muted overflow-hidden'>
                  <div
                    className='h-full rounded-full bg-indigo-500'
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
              <div className='shrink-0 text-right text-xs text-muted-foreground w-20'>
                <span className='font-medium text-foreground'>
                  {p.completedTasks}/{p.totalTasks}
                </span>
              </div>
              {p.overdueTasks > 0 && (
                <div className='shrink-0 text-xs text-amber-500 font-medium w-24 text-right'>
                  {p.overdueTasks}{' '}
                  {intl.formatMessage({ id: 'summary.overdue' }).toLowerCase()}
                </div>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
