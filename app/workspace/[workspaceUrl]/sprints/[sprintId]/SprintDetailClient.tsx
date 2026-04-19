'use client'

import { useParams, useSearchParams } from 'next/navigation'
import { useIntl } from 'react-intl'
import { useSprint, useSprintTasks } from '../../hooks/useSprints'
import { SprintBoard } from '../components/SprintBoard'
import { SprintSidebar } from '../components/SprintSidebar'
import { PlanBacklogPanel } from '../components/PlanBacklogPanel'
import { PageBreadcrumb } from '@/app/workspace/[workspaceUrl]/components/PageBreadcrumb'

export function SprintDetailClient() {
  const { sprintId } = useParams<{ sprintId: string }>()
  const searchParams = useSearchParams()
  const intl = useIntl()
  const { sprint, progress, isLoading, error, refetch } = useSprint(sprintId)
  const { tasks, refetch: refetchTasks } = useSprintTasks(sprintId)
  const planMode =
    searchParams.get('plan') === '1' && sprint?.status === 'DRAFT'

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

  return (
    <div className='flex flex-col h-full overflow-hidden'>
      <PageBreadcrumb title={sprint.name} />
      <div className='grid grid-cols-[1fr_320px] gap-4 p-4 flex-1 overflow-hidden'>
        <SprintBoard tasks={tasks ?? []} onTaskMoved={refetchTasks} />
        {planMode ? (
          <PlanBacklogPanel
            sprint={sprint}
            teamId={sprint.teamId}
            onAdded={refetchTasks}
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
        )}
      </div>
    </div>
  )
}
