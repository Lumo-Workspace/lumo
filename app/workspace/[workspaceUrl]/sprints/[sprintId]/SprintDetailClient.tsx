'use client'

import { useEffect } from 'react'
import { useParams } from 'next/navigation'
import { useIntl } from 'react-intl'
import { useSprint, useSprintTasks } from '../../hooks/useSprints'
import { useMembers } from '../../hooks/useMembers'
import { SprintBoard } from '../components/SprintBoard'
import { SprintSidebar } from '../components/SprintSidebar'
import { PageBreadcrumb } from '@/app/workspace/[workspaceUrl]/components/PageBreadcrumb'

export function SprintDetailClient() {
  const { sprintId } = useParams<{ sprintId: string }>()
  const intl = useIntl()
  const { sprint, progress, isLoading, error, refetch } = useSprint(sprintId)
  const { tasks, refetch: refetchTasks } = useSprintTasks(sprintId)
  const { members, fetchMembers } = useMembers()
  // Members are needed by ProjectTaskCard for assignee avatars/hover.
  useEffect(() => {
    void fetchMembers()
  }, [fetchMembers])

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
      sprintId={sprint.id}
      members={members}
    />
  )

  const sidePanel = (
    <SprintSidebar
      sprint={sprint}
      progress={progress ?? { done: 0, total: 0 }}
      onRefresh={() => {
        refetch()
        refetchTasks()
      }}
    />
  )

  return (
    <div className='flex flex-col h-full overflow-hidden'>
      <PageBreadcrumb title={sprint.name} />
      <div className='grid grid-cols-[1fr_320px] gap-4 p-4 flex-1 overflow-hidden'>
        {board}
        {sidePanel}
      </div>
    </div>
  )
}
