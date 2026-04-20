'use client'

import { useParams, useSearchParams } from 'next/navigation'
import { useIntl } from 'react-intl'
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  useSprint,
  useSprintTasks,
  useBacklogTasks,
} from '../../hooks/useSprints'
import { SprintBoard } from '../components/SprintBoard'
import { SprintSidebar } from '../components/SprintSidebar'
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
  const { tasks: backlogTasks, refetch: refetchBacklog } = useBacklogTasks(
    planMode && sprint ? sprint.teamId : null
  )
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
    if (!sprint || !activeData || overData?.kind !== 'sprint-column') return

    try {
      // Case 1: drag a Backlog task onto a status column → add to sprint,
      // set its status to match the column.
      if (
        activeData.kind === 'backlog-task' &&
        overData.status &&
        overData.status !== 'BACKLOG'
      ) {
        await sprintsClient.addTask(sprint.id, activeData.taskId)
        try {
          await tasksClient.update(activeData.taskId, {
            status: overData.status,
          })
        } catch {
          // Non-fatal: task is in sprint; status stays as-is.
        }
      }
      // Case 2: drag a Sprint task onto the Backlog column → remove from sprint.
      else if (
        activeData.kind === 'sprint-task' &&
        overData.status === 'BACKLOG'
      ) {
        await sprintsClient.removeTask(sprint.id, activeData.taskId)
      }
      // Case 3: drag a Sprint task onto a different status column → update status.
      else if (
        activeData.kind === 'sprint-task' &&
        overData.status &&
        overData.status !== 'BACKLOG'
      ) {
        await tasksClient.update(activeData.taskId, {
          status: overData.status,
        })
      } else {
        return
      }
      refetchTasks()
      refetchBacklog()
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
      planMode={planMode}
      backlogTasks={backlogTasks ?? []}
    />
  )

  const sidePanel =
    sprint.status === 'CLOSED' ? (
      <RetroPanel sprintId={sprint.id} />
    ) : (
      <SprintSidebar
        sprint={sprint}
        progress={progress ?? { done: 0, total: 0 }}
        onRefresh={() => {
          refetch()
          refetchTasks()
          refetchBacklog()
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
