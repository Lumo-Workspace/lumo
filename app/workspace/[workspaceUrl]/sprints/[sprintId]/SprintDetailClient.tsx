'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { useIntl } from 'react-intl'
import { useSprint, useSprintTasks } from '../../hooks/useSprints'
import { useMembers } from '../../hooks/useMembers'
import { SprintBoard } from '../components/SprintBoard'
import { SprintSidebar } from '../components/SprintSidebar'
import { SprintActionsMenu } from '../components/SprintActionsMenu'
import { PageBreadcrumb } from '@/app/workspace/[workspaceUrl]/components/PageBreadcrumb'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'

export function SprintDetailClient() {
  const { sprintId, workspaceUrl } = useParams<{
    sprintId: string
    workspaceUrl: string
  }>()
  const router = useRouter()
  const intl = useIntl()
  const { sprint, progress, isLoading, error, refetch } = useSprint(sprintId)
  const { tasks, refetch: refetchTasks } = useSprintTasks(sprintId)
  const { members, fetchMembers } = useMembers()
  // Members are needed by ProjectTaskCard for assignee avatars/hover.
  useEffect(() => {
    void fetchMembers()
  }, [fetchMembers])

  const sprintsHref = `/workspace/${workspaceUrl}/sprints`
  const sprintsLabel = intl.formatMessage({ id: 'sidebar.sprints' })

  function breadcrumb(currentLabel: string) {
    return (
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link href={sprintsHref}>{sprintsLabel}</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>{currentLabel}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
    )
  }

  if (isLoading) {
    return (
      <div className='flex flex-col h-full overflow-hidden'>
        <PageBreadcrumb>
          {breadcrumb(intl.formatMessage({ id: 'sprints.detail.loading' }))}
        </PageBreadcrumb>
        <div className='p-6 text-muted-foreground'>
          {intl.formatMessage({ id: 'sprints.detail.loading' })}
        </div>
      </div>
    )
  }

  if (error || !sprint) {
    return (
      <div className='flex flex-col h-full overflow-hidden'>
        <PageBreadcrumb>
          {breadcrumb(intl.formatMessage({ id: 'sprints.detail.notFound' }))}
        </PageBreadcrumb>
        <div className='p-6 text-muted-foreground'>
          {intl.formatMessage({ id: 'sprints.detail.notFound' })}
        </div>
      </div>
    )
  }

  const taskList = (tasks ?? []) as import('../../types').ApiTask[]

  const board = (
    <SprintBoard
      tasks={taskList}
      onTaskMoved={refetchTasks}
      sprintId={sprint.id}
      members={members}
    />
  )

  const sidePanel = (
    <SprintSidebar
      sprint={sprint}
      progress={progress ?? { done: 0, total: 0 }}
      tasks={taskList}
      members={members}
      onRefresh={() => {
        refetch()
        refetchTasks()
      }}
    />
  )

  return (
    <div className='flex flex-col h-full overflow-hidden'>
      <PageBreadcrumb>
        <div className='flex items-center gap-1.5'>
          {breadcrumb(sprint.name)}
          <SprintActionsMenu
            sprint={sprint}
            onDeleted={() => router.push(sprintsHref)}
          />
        </div>
      </PageBreadcrumb>
      <div className='grid grid-cols-[1fr_320px] gap-4 p-4 flex-1 overflow-hidden'>
        {board}
        {sidePanel}
      </div>
    </div>
  )
}
