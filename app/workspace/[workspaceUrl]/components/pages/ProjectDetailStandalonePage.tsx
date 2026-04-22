'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { useCurrentUser } from '../../hooks/useCurrentUser'
import { AnimatePresence } from 'motion/react'
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar'
import { AppSidebar } from '../Sidebar'
import {
  ApiProject,
  ApiTask,
  ApiStatus,
  WorkspaceMemberInfo,
  Page,
} from '../../types'
import { CACHE_KEY } from '../../constants'
import { readCache, writeCache } from '../../cache'
import { ProjectDetailPage } from './ProjectDetailPage'
import { NewTaskModal, NewTaskFormData } from '../modals/NewTaskModal'
import { ProjectSlackDialog } from '../ProjectSlackDialog'
import { copyLink } from '@/lib/utils/copyLink'
import { slugify } from '@/lib/utils/slugify'
import {
  apiFetchQuiet,
  tasksClient,
  projectsClient,
  workspacesClient,
} from '@/lib/api-client'
import { useCopyState } from '../../hooks/useCopyState'
import { useProjects } from '../../hooks/useProjects'
import { useRealtimeNotifications } from '../../hooks/useRealtimeNotifications'
import { usePusherEvent } from '../../hooks/usePusher'
import { toast } from 'sonner'
import { useIntl } from 'react-intl'

interface Props {
  initialProject: ApiProject
  workspaceUrl: string
}

export function ProjectDetailStandalonePage({
  initialProject,
  workspaceUrl,
}: Props) {
  const intl = useIntl()
  const router = useRouter()

  // ── Shared workspace projects store (so edits/deletes from this standalone
  // page propagate to the sidebar and the projects list without a refetch).
  // We also read `projects` to hydrate repositories for the current entity
  // without a second fetch — `ProjectsProvider` already fetched the list.
  const {
    projects: workspaceProjects,
    setProjects,
    fetchProjects,
  } = useProjects()

  // ── Notifications ─────────────────────────────────────────────────────────
  const { unreadCount } = useRealtimeNotifications()

  // ── Copy link ─────────────────────────────────────────────────────────────
  const [copied, triggerCopy] = useCopyState()
  const handleCopyLink = useCallback(async () => {
    await copyLink(
      `${window.location.origin}/workspace/${workspaceUrl}/project/${slugify(initialProject.name)}`
    )
    triggerCopy()
  }, [workspaceUrl, initialProject.id, triggerCopy])

  // ── Data state ────────────────────────────────────────────────────────────
  const [project, setProject] = useState<ApiProject>(initialProject)

  // Hydrate repositories from the shared projects store whenever the
  // Provider's list has a richer copy than `initialProject`. `initialProject`
  // is the server-rendered prop which may omit `repositories`; the Provider's
  // `projects` list comes from `projectsClient.list()` which includes them.
  // Reading from the Provider (single source of truth) replaces the old
  // readCache(CACHE_KEY.projects) path that bypassed Provider state.
  useEffect(() => {
    const fresh = workspaceProjects.find(p => p.id === initialProject.id)
    if (!fresh?.repositories?.length) return
    setProject(prev =>
      prev.repositories?.length
        ? prev
        : { ...prev, repositories: fresh.repositories! }
    )
  }, [initialProject.id, workspaceProjects])
  const [tasks, setTasks] = useState<ApiTask[]>(() => {
    const cached = readCache<{ tasks?: ApiTask[] }>(
      CACHE_KEY.projectTasks(initialProject.id)
    )
    return cached?.tasks ?? []
  })
  const [kanbanViewId, setKanbanViewId] = useState<string | null>(() => {
    const cached = readCache<{ kanbanViewId?: string | null }>(
      CACHE_KEY.projectTasks(initialProject.id)
    )
    return cached?.kanbanViewId ?? null
  })
  const [members, setMembers] = useState<WorkspaceMemberInfo[]>(() => {
    return readCache<WorkspaceMemberInfo[]>(CACHE_KEY.members) ?? []
  })

  // Current user identity for agent card styling
  const { user } = useCurrentUser()
  const currentMember = useMemo(
    () => members.find(m => m.clerkId === user?.id),
    [members, user?.id]
  )
  const currentActorId = currentMember?.actorId ?? null
  const isOwner = currentMember?.role === 'OWNER'

  const [loading, setLoading] = useState(() => {
    const cached = readCache<{ tasks?: ApiTask[] }>(
      CACHE_KEY.projectTasks(initialProject.id)
    )
    return !cached?.tasks?.length
  })
  const [error, setError] = useState<string | null>(null)

  // ── Real-time board updates via project channel ────────────────────────────
  usePusherEvent<{
    taskId: string
    fields: string[]
    patch?: Record<string, unknown>
  }>(
    `project-${initialProject.id}`,
    'project-update',
    useCallback(event => {
      if (event.patch) {
        setTasks(
          prev =>
            prev.map(t =>
              t.id === event.taskId ? { ...t, ...event.patch } : t
            ) as ApiTask[]
        )
      }
    }, [])
  )

  // ── Slack integration ─────────────────────────────────────────────────────
  const [slackDialogOpen, setSlackDialogOpen] = useState(false)

  // ── New task modal ────────────────────────────────────────────────────────
  const [isNewTaskModalOpen, setIsNewTaskModalOpen] = useState(false)
  const [newTaskDefaultStatus, setNewTaskDefaultStatus] = useState<
    ApiStatus | undefined
  >()

  // ── Fetch tasks ───────────────────────────────────────────────────────────
  const fetchTasks = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const data = await projectsClient.listTasks<{
        tasks: ApiTask[]
        kanbanViewId: string | null
      }>(project.id)
      setTasks(data.tasks)
      setKanbanViewId(data.kanbanViewId)
      writeCache(CACHE_KEY.projectTasks(project.id), {
        tasks: data.tasks,
        taskIds: data.tasks.map(t => t.id),
        kanbanViewId: data.kanbanViewId,
      })
    } catch {
      setError('Could not load tasks.')
    } finally {
      setLoading(false)
    }
  }, [project.id])

  // ── Mount: background fetch (state already seeded from cache in initializers) ──
  //
  // Projects list is intentionally NOT fetched here — `ProjectsProvider` is the
  // sole owner of `CACHE_KEY.projects` (both state and cache). A stale
  // `projectsClient.list()` resolving after a concurrent delete used to
  // repopulate the cache with the just-deleted project, which reappeared on
  // the next refresh. `repositories` hydration happens via the effect above
  // that reads from `useProjects().projects`.
  useEffect(() => {
    Promise.all([
      workspacesClient
        .listMembers<{ members: WorkspaceMemberInfo[] }>()
        .catch(() => null),
      projectsClient
        .listTasks<{
          tasks: ApiTask[]
          kanbanViewId: string | null
        }>(project.id)
        .catch(() => null),
    ])
      .then(([membersData, tasksData]) => {
        if (membersData?.members) {
          setMembers(membersData.members)
          writeCache(CACHE_KEY.members, membersData.members)
        }
        if (tasksData?.tasks) {
          setTasks(tasksData.tasks)
          setKanbanViewId(tasksData.kanbanViewId ?? null)
          writeCache(CACHE_KEY.projectTasks(project.id), {
            tasks: tasksData.tasks,
            taskIds: tasksData.tasks.map((t: ApiTask) => t.id),
            kanbanViewId: tasksData.kanbanViewId,
          })
        }
        setLoading(false)
      })
      .catch(() => {
        setLoading(false)
      })
  }, [project.id])

  // ── Handlers ──────────────────────────────────────────────────────────────
  const handleCreateTask = useCallback(
    async ({
      title,
      description,
      status,
      priority,
      assigneeId,
      aiSuggestedPriority,
    }: NewTaskFormData) => {
      let task: ApiTask
      try {
        const data = await projectsClient.createTask<{ task: ApiTask }>(
          project.id,
          {
            title,
            description: description?.trim() || undefined,
            status,
            priority,
            assigneeId: assigneeId || undefined,
          }
        )
        task = data.task
      } catch (err) {
        const message =
          err instanceof Error
            ? err.message
            : intl.formatMessage({ id: 'task.createFailed' })
        toast.error(message)
        return
      }
      setTasks(prev => [...prev, task])
      toast.success(intl.formatMessage({ id: 'task.createSuccess' }))

      // Record AI priority override if user changed the suggestion
      if (aiSuggestedPriority && aiSuggestedPriority !== priority) {
        apiFetchQuiet('/api/tasks/priority-override', {
          method: 'POST',
          body: {
            taskId: task.id,
            projectId: project.id,
            aiSuggested: aiSuggestedPriority,
            userChosen: priority,
            taskTitle: title,
            taskDescription: description || undefined,
          },
        })
      }
    },
    [project.id]
  )

  const handleDeleteTask = useCallback(async (taskId: string) => {
    setTasks(prev => prev.filter(t => t.id !== taskId))
    await tasksClient.delete(taskId)
  }, [])

  const handleTaskStatusChanged = useCallback(
    (_taskId: string, _old: string, _new: string) => {
      // ProjectDetailPage handles optimistic DnD update internally via setTasks
    },
    []
  )

  const handleUpdateProject = useCallback(
    async (
      id: string,
      data: {
        name?: string
        description?: string
        ownerId?: string | null
      }
    ) => {
      const { project: updated } = await projectsClient.update<{
        project: ApiProject
      }>(id, data)
      setProject(prev => ({ ...prev, ...updated }))
      // Mirror the change into the shared projects store so the sidebar
      // and the projects list reflect it without waiting for a refetch.
      setProjects(prev =>
        prev.map(p => (p.id === id ? { ...p, ...updated } : p))
      )
    },
    [setProjects]
  )

  const handleDeleteProject = useCallback(
    async (id: string) => {
      // Drop from the shared store first so the sidebar and list never show
      // the stale entry after we navigate away. Revert on server error.
      setProjects(prev => prev.filter(p => p.id !== id))
      try {
        await projectsClient.delete(id)
      } catch (err) {
        // Reconcile with the server on failure.
        void fetchProjects()
        throw err
      }
      router.push(`/workspace/${workspaceUrl}`)
    },
    [fetchProjects, router, setProjects, workspaceUrl]
  )

  return (
    <SidebarProvider className='h-screen font-sans'>
      <AppSidebar
        currentPage={'projects' as Page}
        onNavigate={() => router.push(`/workspace/${workspaceUrl}`)}
        unreadCount={unreadCount}
        draftCount={0}
      />

      <SidebarInset className='overflow-hidden flex flex-col'>
        {/* Main content */}
        <div className='flex-1 overflow-hidden flex flex-col'>
          <ProjectDetailPage
            project={project}
            tasks={tasks}
            setTasks={setTasks}
            viewId={kanbanViewId}
            loading={loading}
            error={error}
            onRetry={fetchTasks}
            onBack={() => router.push(`/workspace/${workspaceUrl}/projects`)}
            onNewTask={status => {
              setNewTaskDefaultStatus(status)
              setIsNewTaskModalOpen(true)
            }}
            onTaskClick={task =>
              router.push(
                `/workspace/${workspaceUrl}/project/${slugify(project.name)}/tasks/${task.teamIdentifier}-${task.number}`
              )
            }
            onDeleteTask={handleDeleteTask}
            onTaskStatusChanged={handleTaskStatusChanged}
            onUpdateProject={handleUpdateProject}
            onDeleteProject={handleDeleteProject}
            members={members}
            currentActorId={currentActorId}
            isOwner={isOwner}
            onSlack={() => setSlackDialogOpen(true)}
            onCopyLink={handleCopyLink}
            copied={copied}
            workspaceUrl={workspaceUrl}
          />
        </div>
      </SidebarInset>

      <ProjectSlackDialog
        isOpen={slackDialogOpen}
        onClose={() => setSlackDialogOpen(false)}
        projectId={project.id}
        projectName={project.name}
        workspaceUrl={workspaceUrl}
      />

      <AnimatePresence>
        {isNewTaskModalOpen && (
          <NewTaskModal
            isOpen={isNewTaskModalOpen}
            onClose={() => {
              setIsNewTaskModalOpen(false)
              setNewTaskDefaultStatus(undefined)
            }}
            projects={[project]}
            members={members}
            defaultProjectId={project.id}
            defaultStatus={newTaskDefaultStatus}
            onSubmit={handleCreateTask}
          />
        )}
      </AnimatePresence>
    </SidebarProvider>
  )
}
