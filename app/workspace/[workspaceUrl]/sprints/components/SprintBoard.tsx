'use client'

import { useState } from 'react'
import { type DragEndEvent } from '@dnd-kit/core'
import { ProjectTaskCard } from '../../components/board/SortableTaskCard'
import { BoardView } from '../../components/board/BoardView'
import { useBoardSensors } from '../../hooks/useBoardSensors'
import { tasksClient } from '@/lib/api-client'
import type { ApiStatus, ApiTask, WorkspaceMemberInfo } from '../../types'

interface SprintBoardProps {
  tasks: unknown[]
  onTaskMoved?: () => void
  /** Sprint id (currently unused in the kanban view, kept for future routing). */
  sprintId?: string
  /** Members passed through to ProjectTaskCard for assignee avatar/hover. */
  members?: WorkspaceMemberInfo[] | undefined
  currentActorId?: string | null | undefined
  isOwner?: boolean | undefined
  /** When true, the board lets users drag cards between status columns and
   * persists each move via tasksClient.update. Defaults to true. */
  enableStatusDrag?: boolean
  /** If provided, renders an "Add task" button per column. Parent is
   *  responsible for opening the new-task modal pre-scoped to the sprint. */
  onAddTask?: (status: ApiStatus) => void
}

export function SprintBoard({
  tasks,
  onTaskMoved,
  members,
  currentActorId,
  isOwner,
  enableStatusDrag = true,
  onAddTask,
}: SprintBoardProps) {
  const sprintList = tasks as ApiTask[]

  return (
    <ActiveBoard
      tasks={sprintList}
      members={members}
      currentActorId={currentActorId}
      isOwner={isOwner}
      enableDrag={enableStatusDrag}
      onTaskMoved={onTaskMoved}
      onAddTask={onAddTask}
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
  onAddTask,
}: {
  tasks: ApiTask[]
  members?: WorkspaceMemberInfo[] | undefined
  currentActorId?: string | null | undefined
  isOwner?: boolean | undefined
  enableDrag: boolean
  onTaskMoved?: (() => void) | undefined
  onAddTask?: ((status: ApiStatus) => void) | undefined
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
      {...(onAddTask
        ? { onAddTask: (columnId: string) => onAddTask(columnId as ApiStatus) }
        : {})}
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
