'use client'

import { useIntl } from 'react-intl'
import { useDroppable, useDraggable } from '@dnd-kit/core'
import type { TaskStatus } from '@prisma/client'
import { PriorityBadge } from '../../components/PriorityBadge'
import { Bot } from 'lucide-react'

/**
 * Shape of a task returned by /api/sprints/[sprintId]/tasks after flattening.
 * Matches ApiTask so we can lean on the same visual conventions as the project Kanban.
 */
export interface SprintTask {
  id: string
  title: string
  number: number
  status: TaskStatus
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT' | string
  dueDate?: string | null
  updatedAt: string
  teamIdentifier: string
  assigneeActorId: string | null
  assignee?: {
    id: string
    type: string
    member: { id: string; clerkId: string } | null
    agent: { id: string; name: string; avatarColor: string } | null
  } | null
  parent: {
    id: string
    title: string
    number: number
    teamIdentifier: string
  } | null
  _count?: { children: number }
  childrenDoneCount?: number
}

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
  /** When true, render a 2-column [Backlog | Planned] view (status doesn't
   * matter during planning). When false, render the 4 status columns. */
  planMode?: boolean
  backlogTasks?: unknown[]
}

export function SprintBoard({
  tasks,
  droppable = false,
  planMode = false,
  backlogTasks = [],
}: SprintBoardProps) {
  const sprintList = tasks as SprintTask[]
  const backlogList = (backlogTasks as SprintTask[]) ?? []

  if (planMode) {
    // Planning is membership-only: 2 columns, no status concern.
    return (
      <div className='grid grid-cols-2 gap-3 overflow-auto'>
        <BacklogPlanningColumn
          columnKey='BACKLOG'
          tasks={backlogList}
          droppable={droppable}
          draggableKind='backlog-task'
        />
        <BacklogPlanningColumn
          columnKey='PLANNED'
          tasks={sprintList}
          droppable={droppable}
          draggableKind='sprint-task'
        />
      </div>
    )
  }

  // Execution view: status columns.
  const byStatus = Object.fromEntries(
    ACTIVE_STATUS_ORDER.map(s => [s, [] as SprintTask[]])
  ) as Record<TaskStatus, SprintTask[]>
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
        />
      ))}
    </div>
  )
}

function BacklogPlanningColumn({
  columnKey,
  tasks,
  droppable,
  draggableKind,
}: {
  columnKey: 'BACKLOG' | 'PLANNED'
  tasks: SprintTask[]
  droppable: boolean
  draggableKind: 'backlog-task' | 'sprint-task'
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
          <DraggablePlanCard key={t.id} task={t} kind={draggableKind} />
        ))}
      </div>
    </section>
  )
}

function DraggablePlanCard({
  task,
  kind,
}: {
  task: SprintTask
  kind: 'backlog-task' | 'sprint-task'
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `${kind}:${task.id}`,
    data: { kind, taskId: task.id },
  })
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={`${isDragging ? 'opacity-40 cursor-grabbing' : 'cursor-grab'} select-none`}
    >
      <TaskCard task={task} />
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
          className={`text-xs font-semibold uppercase tracking-wide ${COLUMN_HEADER_CLASS[status]}`}
        >
          {intl.formatMessage({ id: COLUMN_I18N_KEY[status] })}
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
  const prefix = t.teamIdentifier
    ? `${t.teamIdentifier}-${t.number}`
    : `#${t.number}`
  const isAgent = t.assignee?.type === 'AGENT'
  const childrenTotal = t._count?.children ?? 0
  const childrenDone = t.childrenDoneCount ?? 0
  const hasChildren = childrenTotal > 0

  const bottomText = t.dueDate
    ? `Due ${new Date(t.dueDate).toLocaleDateString()}`
    : `Updated ${new Date(t.updatedAt).toLocaleDateString()}`

  return (
    <article className='bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-3 rounded-lg shadow-sm hover:shadow-md transition-shadow'>
      <div className='flex justify-between items-start mb-2'>
        <span className='text-xs font-mono text-zinc-500 dark:text-zinc-400'>
          {prefix}
        </span>
        <PriorityBadge priority={t.priority as any} />
      </div>

      {t.parent && (
        <div className='mb-1'>
          <span className='text-[10px] text-zinc-500 dark:text-zinc-400 bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 rounded'>
            ↑ {t.parent.teamIdentifier}-{t.parent.number}
          </span>
        </div>
      )}

      <h4 className='text-sm font-medium mb-3 leading-relaxed line-clamp-2'>
        {t.title}
      </h4>

      {hasChildren && (
        <div className='flex items-center gap-1.5 mb-2'>
          <div className='flex-1 h-1 bg-zinc-200 dark:bg-zinc-700 rounded-full overflow-hidden'>
            <div
              className='h-full bg-blue-500 rounded-full transition-all'
              style={{
                width: `${Math.round((childrenDone / childrenTotal) * 100)}%`,
              }}
            />
          </div>
          <span className='text-[10px] text-zinc-400 dark:text-zinc-500 tabular-nums'>
            {childrenDone}/{childrenTotal}
          </span>
        </div>
      )}

      <div className='flex justify-between items-center'>
        {isAgent ? (
          <div
            className='flex items-center justify-center size-5 rounded-full'
            style={{
              backgroundColor: t.assignee?.agent?.avatarColor ?? '#ede9fe',
            }}
            title={t.assignee?.agent?.name ?? 'Agent'}
          >
            <Bot size={11} className='text-white' />
          </div>
        ) : t.assigneeActorId ? (
          <div
            className='size-5 rounded-full bg-zinc-200 dark:bg-zinc-700'
            title='Assigned'
          />
        ) : (
          <div className='size-5 rounded-full border border-dashed border-zinc-300 dark:border-zinc-600' />
        )}

        <span className='text-[10px] text-zinc-400'>{bottomText}</span>
      </div>
    </article>
  )
}
