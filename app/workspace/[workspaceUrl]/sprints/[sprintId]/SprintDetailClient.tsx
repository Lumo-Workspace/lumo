'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { useIntl } from 'react-intl'
import { useSprintByNumber, useSprintTasks } from '../../hooks/useSprints'
import { useMembers } from '../../hooks/useMembers'
import { useProjects } from '../../hooks/useProjects'
import { CheckSquare, Plus } from 'lucide-react'
import type { ApiStatus, MyTask } from '../../types'
import { TaskWorkspaceView } from '../../components/task-list/TaskWorkspaceView'
import { SprintActionsMenu } from '../components/SprintActionsMenu'
import { SprintHeader } from '../components/SprintHeader'
import { SprintTeamPerformance } from '../components/SprintTeamPerformance'
import { DetailLayout } from '@/app/workspace/[workspaceUrl]/components/DetailLayout'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'
import { Button } from '@/components/ui/button'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'

interface SprintDetailClientProps {
  /** Open the global NewTaskModal with the current sprint pre-selected. */
  onNewTask?: (sprintId: string, teamId: string, status?: ApiStatus) => void
  /** Open the global task drawer for a clicked task card. */
  onOpenTask?: (task: MyTask) => void
}

export function SprintDetailClient({
  onNewTask,
  onOpenTask,
}: SprintDetailClientProps = {}) {
  const { sprintId, workspaceUrl } = useParams<{
    sprintId: string
    workspaceUrl: string
  }>()
  const router = useRouter()
  const intl = useIntl()
  // The `sprintId` segment is now the per-team sprint number (e.g. `1`).
  const parsedNumber = Number(sprintId)
  const sprintNumber = Number.isInteger(parsedNumber) ? parsedNumber : null
  const { sprint, progress, isLoading, error, refetch } = useSprintByNumber(
    workspaceUrl,
    sprintNumber
  )
  const { tasks, refetch: refetchTasks } = useSprintTasks(sprint?.id ?? null)
  const { members } = useMembers()
  const { projects, fetchProjects } = useProjects()
  // Mirror the fetched sprint tasks into a local state tuple so
  // TaskWorkspaceView (which drives inline edits + DnD) owns the source of
  // truth for list updates between refetches.
  const [localTasks, setLocalTasks] = useState<MyTask[]>([])
  useEffect(() => {
    setLocalTasks((tasks ?? []) as MyTask[])
  }, [tasks])

  useEffect(() => {
    void fetchProjects()
  }, [fetchProjects])

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
      <DetailLayout
        breadcrumb={breadcrumb(
          intl.formatMessage({ id: 'sprints.detail.loading' })
        )}
      >
        <div className='p-6 text-muted-foreground'>
          {intl.formatMessage({ id: 'sprints.detail.loading' })}
        </div>
      </DetailLayout>
    )
  }

  if (error || !sprint) {
    return (
      <DetailLayout
        breadcrumb={breadcrumb(
          intl.formatMessage({ id: 'sprints.detail.notFound' })
        )}
      >
        <div className='p-6 text-muted-foreground'>
          {intl.formatMessage({ id: 'sprints.detail.notFound' })}
        </div>
      </DetailLayout>
    )
  }

  const workspace = (
    <TaskWorkspaceView
      tasks={localTasks}
      setTasks={setLocalTasks}
      loading={false}
      error={null}
      onRetry={refetchTasks}
      onTaskClick={onOpenTask ?? (() => {})}
      onNewTask={status => {
        if (onNewTask) onNewTask(sprint.id, sprint.teamId, status)
      }}
      members={members}
      projects={projects}
      displayOptionsKey={`lumo:display:sprint:${sprint.id}`}
      emptyState={
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant='icon'>
              <CheckSquare />
            </EmptyMedia>
            <EmptyTitle>
              {intl.formatMessage({ id: 'sprints.tasks.empty.title' })}
            </EmptyTitle>
            <EmptyDescription>
              {intl.formatMessage({ id: 'sprints.tasks.empty.description' })}
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button
              onClick={() => {
                if (onNewTask) onNewTask(sprint.id, sprint.teamId)
              }}
            >
              <Plus size={16} />
              {intl.formatMessage({ id: 'task.create' })}
            </Button>
          </EmptyContent>
        </Empty>
      }
    />
  )

  return (
    <DetailLayout
      scrollBody
      breadcrumb={
        <div className='flex items-center gap-1.5'>
          {breadcrumb(sprint.name)}
          <SprintActionsMenu
            sprint={sprint}
            onDeleted={() => router.push(sprintsHref)}
          />
        </div>
      }
    >
      {/*
        Sprint info — the relocated sidebar content — sits above the board and
        grows unbounded (Team performance expands per member and per task), so
        the body scrolls (`scrollBody`) rather than clipping it.
      */}
      <div className='flex shrink-0 flex-col gap-6 px-6 pb-2 pt-5'>
        <SprintHeader
          sprint={sprint}
          progress={progress ?? { done: 0, total: 0 }}
          onRefresh={() => {
            refetch()
            refetchTasks()
          }}
        />
        <SprintTeamPerformance sprintId={sprint.id} members={members} />
      </div>
      {/*
        `flex-1` still fills the viewport when the info block is short; the
        `min-h` floor keeps the board/list usable (its columns scroll
        internally) once a tall info block pushes it past the fold.
      */}
      <div className='flex min-h-[480px] flex-1 flex-col'>{workspace}</div>
    </DetailLayout>
  )
}
