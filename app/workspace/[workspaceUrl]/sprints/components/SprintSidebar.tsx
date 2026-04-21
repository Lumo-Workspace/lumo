'use client'

import { useIntl } from 'react-intl'
import { Progress } from '@/components/ui/progress'
import type { Sprint } from '@prisma/client'
import {
  deriveSprintState,
  type DerivedSprintState,
} from '@/lib/services/sprint-date'

interface SprintProgress {
  done: number
  total: number
}

interface SprintSidebarProps {
  sprint: Sprint
  progress: SprintProgress
  onRefresh: () => void
}

const STATE_BADGE: Record<DerivedSprintState, string> = {
  UPCOMING: 'bg-muted text-muted-foreground',
  CURRENT: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  COMPLETED:
    'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
}

const STATE_I18N_KEY: Record<DerivedSprintState, string> = {
  UPCOMING: 'sprints.state.upcoming',
  CURRENT: 'sprints.state.current',
  COMPLETED: 'sprints.state.completed',
}

function formatDate(value: string | Date | null | undefined): string {
  if (!value) return '—'
  return new Date(value).toLocaleDateString()
}

export function SprintSidebar({ sprint, progress }: SprintSidebarProps) {
  const intl = useIntl()
  const state = deriveSprintState(sprint)

  const pct =
    progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0

  return (
    <aside className='flex flex-col gap-4 rounded-lg border bg-muted/10 p-4 overflow-y-auto'>
      {/* Name + derived state badge */}
      <div>
        <p className='text-xs font-medium uppercase tracking-wide text-muted-foreground mb-0.5'>
          {sprint.name}
        </p>
        <span
          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${STATE_BADGE[state]}`}
        >
          {intl.formatMessage({ id: STATE_I18N_KEY[state] })}
        </span>
      </div>

      {/* Dates */}
      <div className='flex flex-col gap-1 text-sm'>
        <div className='flex justify-between'>
          <span className='text-muted-foreground'>
            {intl.formatMessage({ id: 'sprints.detail.dateStart' })}
          </span>
          <span>{formatDate(sprint.startDate)}</span>
        </div>
        <div className='flex justify-between'>
          <span className='text-muted-foreground'>
            {intl.formatMessage({ id: 'sprints.detail.dateEnd' })}
          </span>
          <span>{formatDate(sprint.endDate)}</span>
        </div>
      </div>

      {/* Progress */}
      <div className='flex flex-col gap-1.5'>
        <div className='flex justify-between text-xs text-muted-foreground'>
          <span>{intl.formatMessage({ id: 'sprints.detail.progress' })}</span>
          <span>
            {progress.done} / {progress.total}
          </span>
        </div>
        <Progress value={pct} className='h-2' />
        <p className='text-xs text-muted-foreground text-right'>{pct}%</p>
      </div>
    </aside>
  )
}
