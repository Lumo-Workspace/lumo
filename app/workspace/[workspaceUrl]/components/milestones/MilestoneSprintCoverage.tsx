'use client'

import { useIntl } from 'react-intl'
import type { ApiMilestone } from '@/lib/api-client/milestones'

type Coverage = NonNullable<ApiMilestone['sprintCoverage']>
type SprintStatus = Coverage['sprints'][number]['status']

const STATUS_BADGE: Record<SprintStatus, string> = {
  DRAFT: 'bg-muted text-muted-foreground',
  ACTIVE: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  CLOSED:
    'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
}

export function MilestoneSprintCoverage({
  coverage,
}: {
  coverage: ApiMilestone['sprintCoverage']
}) {
  const intl = useIntl()
  if (!coverage) return null

  return (
    <section className='space-y-2'>
      <h3 className='text-sm font-medium text-foreground'>
        {intl.formatMessage({ id: 'milestone.sprintCoverage.title' })}
      </h3>

      {coverage.sprints.length === 0 ? (
        <p className='text-sm text-muted-foreground'>
          {intl.formatMessage({ id: 'milestone.sprintCoverage.empty' })}
        </p>
      ) : (
        <ul className='space-y-1'>
          {coverage.sprints.map(s => (
            <li
              key={s.sprintId}
              className='flex items-center gap-2 text-sm text-foreground'
            >
              <span className='text-muted-foreground tabular-nums'>
                #{s.number}
              </span>
              <span
                className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[s.status]}`}
              >
                {intl.formatMessage({
                  id: `milestone.sprintCoverage.status.${s.status}`,
                })}
              </span>
              <span className='flex-1 truncate'>{s.name}</span>
              <span className='tabular-nums text-muted-foreground'>
                {intl.formatMessage(
                  { id: 'milestone.sprintCoverage.progress' },
                  { done: s.doneCount, total: s.taskCount }
                )}
              </span>
            </li>
          ))}
        </ul>
      )}

      {coverage.unsprinted > 0 && (
        <p className='text-xs text-muted-foreground'>
          {intl.formatMessage(
            { id: 'milestone.sprintCoverage.unsprinted' },
            { count: coverage.unsprinted }
          )}
        </p>
      )}
    </section>
  )
}
