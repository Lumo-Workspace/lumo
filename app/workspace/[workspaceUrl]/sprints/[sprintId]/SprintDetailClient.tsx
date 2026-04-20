'use client'

import { useState } from 'react'
import { useParams, useSearchParams } from 'next/navigation'
import { useIntl } from 'react-intl'
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import { useSprint, useSprintTasks } from '../../hooks/useSprints'
import { SprintBoard } from '../components/SprintBoard'
import { SprintSidebar } from '../components/SprintSidebar'
import { PlanBacklogPanel } from '../components/PlanBacklogPanel'
import { RetroPanel } from '../components/RetroPanel'
import { PageBreadcrumb } from '@/app/workspace/[workspaceUrl]/components/PageBreadcrumb'
import { sprintsClient, tasksClient } from '@/lib/api-client'

export function SprintDetailClient() {
  const { sprintId } = useParams<{ sprintId: string }>()
  const searchParams = useSearchParams()
  const intl = useIntl()
  const { sprint, progress, isLoading, error, refetch } = useSprint(sprintId)
  const { tasks, refetch: refetchTasks } = useSprintTasks(sprintId)
  const planMode =
    searchParams.get('plan') === '1' && sprint?.status === 'DRAFT'
  const [backlogReloadKey, setBacklogReloadKey] = useState(0)
  // Require a few pixels of movement before drag activates so the + button
  // stays clickable.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } })
  )

  async function handleDragEnd(e: DragEndEvent) {
    const activeData = e.active.data.current as
      | { kind: string; taskId: string }
      | undefined
    const overData = e.over?.data.current as
      | { kind: string; status: string }
      | undefined
    if (
      !sprint ||
      activeData?.kind !== 'backlog-task' ||
      overData?.kind !== 'sprint-column'
    ) {
      return
    }
    try {
      await sprintsClient.addTask(sprint.id, activeData.taskId)
      // Match the column the user dropped on by updating the task's status.
      if (overData.status) {
        try {
          await tasksClient.update(activeData.taskId, {
            status: overData.status,
          })
        } catch {
          // Non-fatal: task is in sprint; status stays as-is.
        }
      }
      refetchTasks()
      setBacklogReloadKey(k => k + 1)
    } catch (err) {
      alert((err as Error).message)
    }
  }

  if (isLoading) {
    return (
      <div className='flex flex-col h-full overflow-hidden'>
        <PageBreadcrumb title={intl.formatMessage({ id: 'sidebar.sprints' })} />
        <div className='p-6 text-muted-foreground'>
          {intl.formatMessage({ id: 'sprints.detail.loading' })}
        </div>
      </div>
    )
  }

  if (error || !sprint) {
    return (
      <div className='flex flex-col h-full overflow-hidden'>
        <PageBreadcrumb title={intl.formatMessage({ id: 'sidebar.sprints' })} />
        <div className='p-6 text-muted-foreground'>
          {intl.formatMessage({ id: 'sprints.detail.notFound' })}
        </div>
      </div>
    )
  }

  const board = (
    <SprintBoard
      tasks={tasks ?? []}
      onTaskMoved={refetchTasks}
      droppable={planMode}
    />
  )

  const sidePanel =
    sprint.status === 'CLOSED' ? (
      <RetroPanel sprintId={sprint.id} />
    ) : planMode ? (
      <PlanBacklogPanel
        sprint={sprint}
        teamId={sprint.teamId}
        onAdded={refetchTasks}
        reloadKey={backlogReloadKey}
      />
    ) : (
      <SprintSidebar
        sprint={sprint}
        progress={progress ?? { done: 0, total: 0 }}
        onRefresh={() => {
          refetch()
          refetchTasks()
        }}
      />
    )

  const content = (
    <div className='grid grid-cols-[1fr_320px] gap-4 p-4 flex-1 overflow-hidden'>
      {board}
      {sidePanel}
    </div>
  )

  return (
    <div className='flex flex-col h-full overflow-hidden'>
      <PageBreadcrumb title={sprint.name} />
      {planMode ? (
        <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
          {content}
        </DndContext>
      ) : (
        content
      )}
    </div>
  )
}
