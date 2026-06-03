'use client'

import { useQuery } from '@tanstack/react-query'
import { useIntl } from 'react-intl'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { tasksClient } from '@/lib/api-client'
import { StatusIcon } from '../StatusIcon'

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

// Task status enum → existing localized label key.
const STATUS_LABEL_KEY: Record<string, string> = {
  TODO: 'status.todo',
  IN_PROGRESS: 'status.inProgress',
  IN_REVIEW: 'status.inReview',
  DONE: 'status.done',
}

/**
 * Minimal task list scoped to a milestone. Hits the existing project task
 * route with the `milestoneId` filter. Rendering is intentionally
 * lightweight — the full TaskTable is heavy on props for sort/drag/etc.
 * which a milestone detail page doesn't need.
 */
export function TaskListByMilestone({ projectId, milestoneId }: Props) {
  const intl = useIntl()
  const params = useParams<{ workspaceUrl: string; projectSlug: string }>()
  const { data: tasks = [], isLoading } = useQuery<TaskRow[]>({
    queryKey: ['tasks', 'byMilestone', projectId, milestoneId],
    queryFn: async () => {
      const data = await tasksClient.listByProject<TasksResponse>(projectId, {
        milestoneId,
      })
      return data.tasks
    },
  })

  if (isLoading) {
    return (
      <div
        className='h-24 animate-pulse rounded border border-border bg-muted/50'
        aria-busy='true'
      />
    )
  }

  if (tasks.length === 0) {
    return (
      <div className='rounded border border-border p-6 text-center text-sm text-muted-foreground'>
        {intl.formatMessage({ id: 'milestone.tasks.empty' })}
      </div>
    )
  }

  return (
    <div className='rounded border border-border divide-y divide-border'>
      {tasks.map(t => {
        const ident =
          t.identifier ??
          (t.team?.identifier && t.number
            ? `${t.team.identifier}-${t.number}`
            : t.id.slice(0, 8))
        const statusKey = STATUS_LABEL_KEY[t.status]
        const done = t.status === 'DONE'
        const href = `/workspace/${params.workspaceUrl}/projects/${params.projectSlug}/tasks/${ident}`
        return (
          <Link
            key={t.id}
            href={href}
            className='flex items-center gap-3 p-3 text-sm hover:bg-muted/50 transition-colors'
          >
            <span className='shrink-0'>
              <StatusIcon status={t.status} />
            </span>
            <span className='font-mono text-xs text-muted-foreground'>
              {ident}
            </span>
            <span
              className={`min-w-0 flex-1 truncate ${done ? 'text-muted-foreground' : ''}`}
            >
              {t.title}
            </span>
            <span className='shrink-0 text-xs text-muted-foreground'>
              {statusKey ? intl.formatMessage({ id: statusKey }) : t.status}
            </span>
          </Link>
        )
      })}
    </div>
  )
}
