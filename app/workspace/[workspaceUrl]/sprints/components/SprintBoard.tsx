'use client'

import { useState } from 'react'
import { useIntl } from 'react-intl'
import { useDroppable, type DragEndEvent } from '@dnd-kit/core'
import { ProjectTaskCard } from '../../components/board/SortableTaskCard'
import { BoardView } from '../../components/board/BoardView'
import { useBoardSensors } from '../../hooks/useBoardSensors'
import { tasksClient } from '@/lib/api-client'
import type { ApiStatus, ApiTask, WorkspaceMemberInfo } from '../../types'

// Plan-mode column metadata (BACKLOG / PLANNED). Active mode uses BoardView,
// which has its own status-column constants.
const PLAN_COLUMN_I18N_KEY: Record<'BACKLOG' | 'PLANNED', string> = {
  BACKLOG: 'sprints.plan.backlogTitle',
  PLANNED: 'sprints.plan.plannedTitle',
}

const PLAN_COLUMN_HEADER_CLASS: Record<'BACKLOG' | 'PLANNED', string> = {
  BACKLOG: 'text-zinc-500 dark:text-zinc-400',
  PLANNED: 'text-blue-600 dark:text-blue-400',
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
  /** When true, the active board lets users drag cards between status columns
   * and persists each move via tasksClient.update. Defaults to true. */
  enableStatusDrag?: boolean
}

export function SprintBoard({
  tasks,
  onTaskMoved,
  droppable = false,
  planMode = false,
  backlogTasks = [],
  members,
  currentActorId,
  isOwner,
  enableStatusDrag = true,
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

  // Active / Closed: full kanban via the shared BoardView.
  return (
    <ActiveBoard
      tasks={sprintList}
      members={members}
      currentActorId={currentActorId}
      isOwner={isOwner}
      enableDrag={enableStatusDrag}
      onTaskMoved={onTaskMoved}
    />
  )
}

function ActiveBoard({
  tasks,
  members,
  currentActorId,
  isOwner,
  enableDrag,
  onTaskMoved,
}: {
  tasks: ApiTask[]
  members?: WorkspaceMemberInfo[] | undefined
  currentActorId?: string | null | undefined
  isOwner?: boolean | undefined
  enableDrag: boolean
  onTaskMoved?: (() => void) | undefined
}) {
  const sensors = useBoardSensors()
  const [activeId, setActiveId] = useState<string | null>(null)

  // BoardView's column ids are the status names. When the user drops a card
  // over a column or another card, resolve the target status either way.
  function resolveTargetStatus(overId: string | number): ApiStatus | null {
    const overStr = String(overId)
    if (
      overStr === 'TODO' ||
      overStr === 'IN_PROGRESS' ||
      overStr === 'IN_REVIEW' ||
      overStr === 'DONE'
    ) {
      return overStr as ApiStatus
    }
    const overTask = tasks.find(t => t.id === overStr)
    return (overTask?.status as ApiStatus | undefined) ?? null
  }

  async function handleDragEnd(e: DragEndEvent) {
    setActiveId(null)
    if (!enableDrag) return
    const { active, over } = e
    if (!over) return
    const activeTask = tasks.find(t => t.id === active.id)
    if (!activeTask) return
    const targetStatus = resolveTargetStatus(over.id)
    if (!targetStatus || targetStatus === activeTask.status) return
    try {
      await tasksClient.update(activeTask.id, { status: targetStatus })
      onTaskMoved?.()
    } catch (err) {
      alert((err as Error).message)
    }
  }

  return (
    <BoardView
      tasks={tasks}
      sensors={sensors}
      activeId={activeId}
      onDragStart={e => setActiveId(String(e.active.id))}
      onDragOver={() => {}}
      onDragEnd={handleDragEnd}
      renderCard={(task, isOverlay) => (
        <ProjectTaskCard
          task={task}
          isOverlay={isOverlay}
          {...(members ? { members } : {})}
          {...(currentActorId !== undefined ? { currentActorId } : {})}
          {...(isOwner !== undefined ? { isOwner } : {})}
          dragMode={enableDrag ? 'sortable' : 'none'}
        />
      )}
    />
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
          className={`text-xs font-semibold uppercase tracking-wide ${PLAN_COLUMN_HEADER_CLASS[columnKey]}`}
        >
          {intl.formatMessage({ id: PLAN_COLUMN_I18N_KEY[columnKey] })}
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
