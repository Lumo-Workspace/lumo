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
import { CACHE_KEY } from '../../constants'
import { readCache, writeCache } from '../../cache'
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

  // Collapse / expand the right-hand sprint info rail. The preference is global
  // across sprints (mirrors the milestone detail page) so it survives
  // navigation instead of re-toggling on every visit.
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  useEffect(() => {
    const cached = readCache<boolean>(CACHE_KEY.sprintSidebarCollapsed)
    if (cached !== null) setSidebarCollapsed(cached)
  }, [])
  const toggleSidebar = () => {
    setSidebarCollapsed(prev => {
      const next = !prev
      writeCache(CACHE_KEY.sprintSidebarCollapsed, next)
      return next
    })
  }

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
      sidebarCollapsed={sidebarCollapsed}
      onToggleSidebar={toggleSidebar}
      sidebarExpandLabel={intl.formatMessage({
        id: 'sprints.detail.expandSidebar',
      })}
      sidebarCollapseLabel={intl.formatMessage({
        id: 'sprints.detail.collapseSidebar',
      })}
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

  /*
    Sprint info lives in the right rail, which scrolls on its own — the members
    section grows unbounded (it expands per member and per task) but that no
    longer pushes the board past the fold, so the page body stays pinned to the
    viewport and the board keeps its full height.
  */
  const sidePanel = (
    <div className='flex h-full flex-col gap-6 overflow-y-auto border-l border-border bg-muted/30 px-5 py-6'>
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
  )

  return (
    <DetailLayout
      breadcrumb={
        <div className='flex items-center gap-1.5'>
          {breadcrumb(sprint.name)}
          <SprintActionsMenu
            sprint={sprint}
            onDeleted={() => router.push(sprintsHref)}
          />
        </div>
      }
      sidebar={sidePanel}
      sidebarCollapsed={sidebarCollapsed}
      flushSidebar
    >
      {workspace}
    </DetailLayout>
  )
}
