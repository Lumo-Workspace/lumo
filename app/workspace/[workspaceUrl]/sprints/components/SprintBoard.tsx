'use client'

import { useIntl } from 'react-intl'
import { useDroppable } from '@dnd-kit/core'
import type { TaskStatus } from '@prisma/client'

/**
 * Shape of a task returned by tasksClient.listBySprint / taskRepository.findBySprint.
 * Derived from the TASK_LIST_INCLUDE clause in commit f89faee.
 */
export interface SprintTask {
  id: string
  title: string
  number: number
  status: TaskStatus
  priority: string
  projectId: string | null
  team: { identifier: string } | null
  assignee: {
    id: string
    type: string
    member: { id: string; clerkId: string } | null
    agent: { id: string; name: string; avatarColor: string } | null
  } | null
  parent: {
    id: string
    title: string
    number: number
    team: { identifier: string } | null
  } | null
  _count: { children: number }
  children: { id: string }[]
}

const STATUS_ORDER = ['TODO', 'IN_PROGRESS', 'IN_REVIEW', 'DONE'] as const

const STATUS_I18N_KEY: Record<TaskStatus, string> = {
  TODO: 'sprints.status.todo',
  IN_PROGRESS: 'sprints.status.inProgress',
  IN_REVIEW: 'sprints.status.inReview',
  DONE: 'sprints.status.done',
}

const STATUS_HEADER_CLASS: Record<TaskStatus, string> = {
  TODO: 'text-muted-foreground',
  IN_PROGRESS: 'text-blue-600 dark:text-blue-400',
  IN_REVIEW: 'text-yellow-600 dark:text-yellow-400',
  DONE: 'text-green-600 dark:text-green-400',
}

interface SprintBoardProps {
  tasks: unknown[]
  onTaskMoved?: () => void
  /** When true, columns accept @dnd-kit drops (id = `col:<status>`). */
  droppable?: boolean
}

export function SprintBoard({ tasks, droppable = false }: SprintBoardProps) {
  // Group tasks by status
  const byStatus = Object.fromEntries(
    STATUS_ORDER.map(s => [s, [] as SprintTask[]])
  ) as Record<TaskStatus, SprintTask[]>

  for (const raw of tasks) {
    const t = raw as SprintTask
    if (t.status in byStatus) {
      byStatus[t.status].push(t)
    }
  }

  return (
    <div className='grid grid-cols-4 gap-3 overflow-auto'>
      {STATUS_ORDER.map(status => (
        <BoardColumn
          key={status}
          status={status}
          tasks={byStatus[status]}
          droppable={droppable}
        />
      ))}
    </div>
  )
}

function BoardColumn({
  status,
  tasks,
  droppable,
}: {
  status: TaskStatus
  tasks: SprintTask[]
  droppable: boolean
}) {
  const intl = useIntl()
  const { setNodeRef, isOver } = useDroppable({
    id: `col:${status}`,
    data: { kind: 'sprint-column', status },
    disabled: !droppable,
  })

  return (
    <section
      ref={setNodeRef}
      className={`flex flex-col gap-2 rounded-lg border bg-muted/20 p-2 min-h-full transition-colors ${
        isOver ? 'ring-2 ring-primary bg-primary/5' : ''
      }`}
    >
      <header className='flex items-center justify-between px-1 py-0.5'>
        <span
          className={`text-xs font-semibold uppercase tracking-wide ${STATUS_HEADER_CLASS[status]}`}
        >
          {intl.formatMessage({ id: STATUS_I18N_KEY[status] })}
        </span>
        <span className='text-xs text-muted-foreground'>{tasks.length}</span>
      </header>
      <div className='flex flex-col gap-2'>
        {tasks.map(t => (
          <TaskCard key={t.id} task={t} />
        ))}
      </div>
    </section>
  )
}

function TaskCard({ task: t }: { task: SprintTask }) {
  const prefix = t.team?.identifier
    ? `${t.team.identifier}-${t.number}`
    : `#${t.number}`

  return (
    <article className='rounded border bg-background p-2 text-sm shadow-sm hover:shadow-md transition-shadow'>
      <div className='flex items-center justify-between gap-1 text-xs text-muted-foreground'>
        <span className='shrink-0 font-mono'>{prefix}</span>
        {t.parent && (
          <span className='truncate text-muted-foreground/70'>
            ↳{' '}
            {t.parent.team?.identifier
              ? `${t.parent.team.identifier}-${t.parent.number}`
              : `#${t.parent.number}`}
          </span>
        )}
      </div>
      <p className='mt-1 font-medium leading-snug line-clamp-2'>{t.title}</p>
    </article>
  )
}
