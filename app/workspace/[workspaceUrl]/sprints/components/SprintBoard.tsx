'use client'

import { useIntl } from 'react-intl'
import { useDroppable } from '@dnd-kit/core'
import type { TaskStatus } from '@prisma/client'
import { ProjectTaskCard } from '../../components/board/SortableTaskCard'
import type { ApiTask, WorkspaceMemberInfo } from '../../types'

const ACTIVE_STATUS_ORDER = [
  'TODO',
  'IN_PROGRESS',
  'IN_REVIEW',
  'DONE',
] as const

type ColumnKey = TaskStatus | 'BACKLOG' | 'PLANNED'

const COLUMN_I18N_KEY: Record<ColumnKey, string> = {
  BACKLOG: 'sprints.plan.backlogTitle',
  PLANNED: 'sprints.plan.plannedTitle',
  TODO: 'sprints.status.todo',
  IN_PROGRESS: 'sprints.status.inProgress',
  IN_REVIEW: 'sprints.status.inReview',
  DONE: 'sprints.status.done',
}

const COLUMN_HEADER_CLASS: Record<ColumnKey, string> = {
  BACKLOG: 'text-zinc-500 dark:text-zinc-400',
  PLANNED: 'text-blue-600 dark:text-blue-400',
  TODO: 'text-muted-foreground',
  IN_PROGRESS: 'text-blue-600 dark:text-blue-400',
  IN_REVIEW: 'text-yellow-600 dark:text-yellow-400',
  DONE: 'text-green-600 dark:text-green-400',
}

interface SprintBoardProps {
  tasks: unknown[]
  onTaskMoved?: () => void
  /** When true, columns accept @dnd-kit drops. */
  droppable?: boolean
  /** When true, render a 2-column [Backlog | Planned] view. */
  planMode?: boolean
  backlogTasks?: unknown[]
  /** Members passed through to ProjectTaskCard for assignee avatar/hover. */
  members?: WorkspaceMemberInfo[] | undefined
  currentActorId?: string | null | undefined
  isOwner?: boolean | undefined
}

export function SprintBoard({
  tasks,
  droppable = false,
  planMode = false,
  backlogTasks = [],
  members,
  currentActorId,
  isOwner,
}: SprintBoardProps) {
  const sprintList = tasks as ApiTask[]
  const backlogList = (backlogTasks as ApiTask[]) ?? []

  if (planMode) {
    // Planning is membership-only: 2 columns, no status concern.
    return (
      <div className='grid grid-cols-2 gap-3 overflow-auto'>
        <PlanColumn
          columnKey='BACKLOG'
          tasks={backlogList}
          droppable={droppable}
          dragKind='backlog-task'
          members={members}
          currentActorId={currentActorId}
          isOwner={isOwner}
        />
        <PlanColumn
          columnKey='PLANNED'
          tasks={sprintList}
          droppable={droppable}
          dragKind='sprint-task'
          members={members}
          currentActorId={currentActorId}
          isOwner={isOwner}
        />
      </div>
    )
  }

  // Execution view: status columns.
  const byStatus = Object.fromEntries(
    ACTIVE_STATUS_ORDER.map(s => [s, [] as ApiTask[]])
  ) as Record<TaskStatus, ApiTask[]>
  for (const t of sprintList) {
    if (t.status in byStatus) byStatus[t.status]!.push(t)
  }

  return (
    <div className='grid grid-cols-4 gap-3 overflow-auto'>
      {ACTIVE_STATUS_ORDER.map(status => (
        <BoardColumn
          key={status}
          status={status}
          tasks={byStatus[status] ?? []}
          droppable={droppable}
          members={members}
          currentActorId={currentActorId}
          isOwner={isOwner}
        />
      ))}
    </div>
  )
}

function PlanColumn({
  columnKey,
  tasks,
  droppable,
  dragKind,
  members,
  currentActorId,
  isOwner,
}: {
  columnKey: 'BACKLOG' | 'PLANNED'
  tasks: ApiTask[]
  droppable: boolean
  dragKind: 'backlog-task' | 'sprint-task'
  members?: WorkspaceMemberInfo[] | undefined
  currentActorId?: string | null | undefined
  isOwner?: boolean | undefined
}) {
  const intl = useIntl()
  const { setNodeRef, isOver } = useDroppable({
    id: `col:${columnKey}`,
    data: { kind: 'sprint-column', status: columnKey },
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
          className={`text-xs font-semibold uppercase tracking-wide ${COLUMN_HEADER_CLASS[columnKey]}`}
        >
          {intl.formatMessage({ id: COLUMN_I18N_KEY[columnKey] })}
        </span>
        <span className='text-xs text-muted-foreground'>{tasks.length}</span>
      </header>
      <div className='flex flex-col gap-2'>
        {tasks.map(t => (
          <ProjectTaskCard
            key={t.id}
            task={t}
            isOverlay={false}
            {...(members ? { members } : {})}
            {...(currentActorId !== undefined ? { currentActorId } : {})}
            {...(isOwner !== undefined ? { isOwner } : {})}
            dragMode='simple'
            dragData={{ kind: dragKind, taskId: t.id }}
          />
        ))}
      </div>
    </section>
  )
}

function BoardColumn({
  status,
  tasks,
  droppable,
  members,
  currentActorId,
  isOwner,
}: {
  status: TaskStatus
  tasks: ApiTask[]
  droppable: boolean
  members?: WorkspaceMemberInfo[] | undefined
  currentActorId?: string | null | undefined
  isOwner?: boolean | undefined
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
          className={`text-xs font-semibold uppercase tracking-wide ${COLUMN_HEADER_CLASS[status]}`}
        >
          {intl.formatMessage({ id: COLUMN_I18N_KEY[status] })}
        </span>
        <span className='text-xs text-muted-foreground'>{tasks.length}</span>
      </header>
      <div className='flex flex-col gap-2'>
        {tasks.map(t => (
          <ProjectTaskCard
            key={t.id}
            task={t}
            isOverlay={false}
            {...(members ? { members } : {})}
            {...(currentActorId !== undefined ? { currentActorId } : {})}
            {...(isOwner !== undefined ? { isOwner } : {})}
            dragMode='none'
          />
        ))}
      </div>
    </section>
  )
}
