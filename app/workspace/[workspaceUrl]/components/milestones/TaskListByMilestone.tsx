'use client'

import { useQuery } from '@tanstack/react-query'
import { useIntl } from 'react-intl'

interface Props {
  projectId: string
  milestoneId: string
}

interface TaskRow {
  id: string
  identifier?: string
  number?: number
  title: string
  status: string
  team?: { identifier?: string }
}

interface TasksResponse {
  tasks: TaskRow[]
}

/**
 * Minimal task list scoped to a milestone. Hits the existing project task
 * route with the new `milestoneId` filter. Rendering is intentionally
 * lightweight — the full TaskTable is heavy on props for sort/drag/etc.
 * which a milestone detail page doesn't need.
 */
export function TaskListByMilestone({ projectId, milestoneId }: Props) {
  const intl = useIntl()
  const { data: tasks = [], isLoading } = useQuery<TaskRow[]>({
    queryKey: ['tasks', 'byMilestone', projectId, milestoneId],
    queryFn: async () => {
      const res = await fetch(
        `/api/projects/${projectId}/tasks?milestoneId=${encodeURIComponent(milestoneId)}`
      )
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = (await res.json()) as TasksResponse
      return data.tasks
    },
  })

  if (isLoading) return null

  if (tasks.length === 0) {
    return (
      <div className='rounded border border-zinc-200 dark:border-zinc-800 p-6 text-center text-sm text-zinc-500'>
        {intl.formatMessage({
          id: 'milestone.empty.title',
          defaultMessage: 'No tasks in this milestone yet.',
        })}
      </div>
    )
  }

  return (
    <div className='rounded border border-zinc-200 dark:border-zinc-800 divide-y divide-zinc-200 dark:divide-zinc-800'>
      {tasks.map(t => {
        const ident =
          t.identifier ??
          (t.team?.identifier && t.number
            ? `${t.team.identifier}-${t.number}`
            : t.id.slice(0, 8))
        return (
          <div key={t.id} className='flex items-center gap-3 p-3 text-sm'>
            <span className='font-mono text-xs text-zinc-500'>{ident}</span>
            <span className='flex-1'>{t.title}</span>
            <span className='text-xs uppercase text-zinc-500'>{t.status}</span>
          </div>
        )
      })}
    </div>
  )
}
