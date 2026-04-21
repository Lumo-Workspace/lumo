'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { useIntl } from 'react-intl'
import { useSprintByNumber, useSprintTasks } from '../../hooks/useSprints'
import { useMembers } from '../../hooks/useMembers'
import { useProjects } from '../../hooks/useProjects'
import type { ApiStatus, MyTask } from '../../types'
import { SprintTasksView } from '../components/SprintTasksView'
import { SprintSidebar } from '../components/SprintSidebar'
import { SprintActionsMenu } from '../components/SprintActionsMenu'
import { CACHE_KEY } from '../../constants'
import { readCache, writeCache } from '../../cache'
import { PageBreadcrumb } from '@/app/workspace/[workspaceUrl]/components/PageBreadcrumb'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'

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
  const { members, fetchMembers } = useMembers()
  const { projects, fetchProjects } = useProjects()
  // Mirror the fetched sprint tasks into a local state tuple so
  // SprintTasksView (which drives inline edits + DnD) owns the source of
  // truth for list updates between refetches.
  const [localTasks, setLocalTasks] = useState<MyTask[]>([])
  useEffect(() => {
    setLocalTasks((tasks ?? []) as MyTask[])
  }, [tasks])

  // Collapse / expand the right-hand sprint info panel. Preference is global
  // across sprints (not per-sprint) so users don't have to re-toggle on every
  // visit — matches how doc tree collapse behaves.
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
  useEffect(() => {
    void fetchMembers()
    void fetchProjects()
  }, [fetchMembers, fetchProjects])

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

  const workspace = (
    <SprintTasksView
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
    />
  )

  const sidePanel = (
    <SprintSidebar
      sprint={sprint}
      progress={progress ?? { done: 0, total: 0 }}
      tasks={localTasks}
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
      <div
        className={`grid flex-1 overflow-hidden ${
          sidebarCollapsed
            ? 'grid-cols-[1fr]'
            : 'grid-cols-[1fr_320px] gap-4 pr-4'
        }`}
      >
        {workspace}
        {!sidebarCollapsed && sidePanel}
      </div>
    </div>
  )
}
