'use client'

import { useEffect, useState } from 'react'
import { useIntl } from 'react-intl'
import { toast } from 'sonner'
import { Progress } from '@/components/ui/progress'
import { sprintsClient } from '@/lib/api-client'
import type { Sprint } from '@prisma/client'
import {
  deriveSprintState,
  type DerivedSprintState,
} from '@/lib/services/sprint-date'
import { DatePickerField, startOfDay } from './DatePickerField'

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

export function SprintSidebar({
  sprint,
  progress,
  onRefresh,
}: SprintSidebarProps) {
  const intl = useIntl()
  const state = deriveSprintState(sprint)

  // Track edits locally so the displayed value flips immediately on pick;
  // server response (success or error) reconciles via onRefresh / revert.
  const [start, setStart] = useState<Date>(() => new Date(sprint.startDate))
  const [end, setEnd] = useState<Date>(() => new Date(sprint.endDate))

  // Re-sync when the parent hands us a fresh sprint (e.g. after refetch).
  useEffect(() => {
    setStart(new Date(sprint.startDate))
    setEnd(new Date(sprint.endDate))
  }, [sprint.startDate, sprint.endDate])

  const pct =
    progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0

  async function applyChange(field: 'startDate' | 'endDate', next: Date) {
    const prevStart = start
    const prevEnd = end
    if (field === 'startDate') setStart(next)
    else setEnd(next)

    try {
      await sprintsClient.update(sprint.id, { [field]: next.toISOString() })
      toast.success(intl.formatMessage({ id: 'sprints.detail.dateUpdated' }))
      onRefresh()
    } catch (e) {
      // Roll back local state to whatever the server thinks is correct.
      setStart(prevStart)
      setEnd(prevEnd)
      toast.error(e instanceof Error ? e.message : 'Update failed')
    }
  }

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

      {/* Editable dates */}
      <div className='flex flex-col gap-1 text-sm'>
        <div className='flex items-center justify-between gap-2'>
          <span className='text-muted-foreground'>
            {intl.formatMessage({ id: 'sprints.detail.dateStart' })}
          </span>
          <DatePickerField
            variant='ghost'
            value={start}
            onChange={d => applyChange('startDate', startOfDay(d))}
          />
        </div>
        <div className='flex items-center justify-between gap-2'>
          <span className='text-muted-foreground'>
            {intl.formatMessage({ id: 'sprints.detail.dateEnd' })}
          </span>
          <DatePickerField
            variant='ghost'
            value={end}
            onChange={d => applyChange('endDate', startOfDay(d))}
          />
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
