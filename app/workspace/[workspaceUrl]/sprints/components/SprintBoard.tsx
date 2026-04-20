'use client'

import { useState, useMemo } from 'react'
import { useIntl } from 'react-intl'
import { type DragEndEvent } from '@dnd-kit/core'
import { ProjectTaskCard } from '../../components/board/SortableTaskCard'
import {
  BoardView,
  type BoardColumn as BoardColumnConfig,
} from '../../components/board/BoardView'
import { useBoardSensors } from '../../hooks/useBoardSensors'
import { sprintsClient, tasksClient } from '@/lib/api-client'
import type { ApiStatus, ApiTask, WorkspaceMemberInfo } from '../../types'

interface SprintBoardProps {
  tasks: unknown[]
  onTaskMoved?: () => void
  /** When true, render a 2-column [Backlog | Planned] view. */
  planMode?: boolean
  backlogTasks?: unknown[]
  /** Sprint id — used in plan mode to bucket each task into Backlog vs Planned. */
  sprintId?: string
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
  planMode = false,
  backlogTasks = [],
  sprintId,
  members,
  currentActorId,
  isOwner,
  enableStatusDrag = true,
}: SprintBoardProps) {
  const sprintList = tasks as ApiTask[]
  const backlogList = (backlogTasks as ApiTask[]) ?? []

  if (planMode) {
    return (
      <PlanBoard
        sprintId={sprintId ?? ''}
        sprintTasks={sprintList}
        backlogTasks={backlogList}
        members={members}
        currentActorId={currentActorId}
        isOwner={isOwner}
        onChanged={onTaskMoved}
      />
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

function PlanBoard({
  sprintId,
  sprintTasks,
  backlogTasks,
  members,
  currentActorId,
  isOwner,
  onChanged,
}: {
  sprintId: string
  sprintTasks: ApiTask[]
  backlogTasks: ApiTask[]
  members?: WorkspaceMemberInfo[] | undefined
  currentActorId?: string | null | undefined
  isOwner?: boolean | undefined
  onChanged?: (() => void) | undefined
}) {
  const intl = useIntl()
  const sensors = useBoardSensors()
  const [activeId, setActiveId] = useState<string | null>(null)

  const columns = useMemo<BoardColumnConfig[]>(
    () => [
      {
        id: 'BACKLOG',
        label: intl.formatMessage({ id: 'sprints.plan.backlogTitle' }),
      },
      {
        id: 'PLANNED',
        label: intl.formatMessage({ id: 'sprints.plan.plannedTitle' }),
      },
    ],
    [intl]
  )

  // Merge so BoardView can bucket via getColumnId.
  const allTasks = useMemo(
    () => [...backlogTasks, ...sprintTasks],
    [backlogTasks, sprintTasks]
  )

  function getColumnId(t: ApiTask): string {
    return t.sprintId === sprintId ? 'PLANNED' : 'BACKLOG'
  }

  async function handleDragEnd(e: DragEndEvent) {
    setActiveId(null)
    const { active, over } = e
    if (!over) return
    const activeTask = allTasks.find(t => t.id === active.id)
    if (!activeTask) return

    const fromCol = getColumnId(activeTask)
    let toCol: 'BACKLOG' | 'PLANNED' | null = null
    const overStr = String(over.id)
    if (overStr === 'BACKLOG' || overStr === 'PLANNED') {
      toCol = overStr
    } else {
      const overTask = allTasks.find(t => t.id === overStr)
      if (overTask)
        toCol = getColumnId(overTask) === 'PLANNED' ? 'PLANNED' : 'BACKLOG'
    }
    if (!toCol || toCol === fromCol) return

    try {
      if (toCol === 'PLANNED') {
        await sprintsClient.addTask(sprintId, activeTask.id)
      } else {
        await sprintsClient.removeTask(sprintId, activeTask.id)
      }
      onChanged?.()
    } catch (err) {
      alert((err as Error).message)
    }
  }

  return (
    <BoardView
      tasks={allTasks}
      columns={columns}
      getColumnId={getColumnId}
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
        />
      )}
    />
  )
}
