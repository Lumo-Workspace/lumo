'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
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
import { API, CACHE_KEY } from '../../constants'
import { readCache, writeCache } from '../../cache'
import { ProjectDetailPage } from './ProjectDetailPage'
import { NewTaskModal, NewTaskFormData } from '../modals/NewTaskModal'
import { ProjectSlackDialog } from '../ProjectSlackDialog'
import { copyLink } from '../../utils/copyLink'
import { slugifyProjectName, apiFetch } from '../../utils'
import { useDarkMode } from '../../hooks/useDarkMode'
import { toast } from 'sonner'

interface Props {
  initialProject: ApiProject
  workspaceUrl: string
}

export function ProjectDetailStandalonePage({
  initialProject,
  workspaceUrl,
}: Props) {
  const router = useRouter()

  // ── Dark mode ──────────────────────────────────────────────────────────────
  const { isDarkMode, toggle: handleToggleDarkMode } = useDarkMode()

  // ── Copy link ─────────────────────────────────────────────────────────────
  const [copied, setCopied] = useState(false)
  const handleCopyLink = useCallback(async () => {
    await copyLink(
      `${window.location.origin}/workspace/${workspaceUrl}/project/${slugifyProjectName(initialProject.name)}`
    )
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }, [workspaceUrl, initialProject.id])

  // ── Data state ────────────────────────────────────────────────────────────
  const [project, setProject] = useState<ApiProject>(() => {
    // Seed repositories from projects cache immediately
    const cachedProjects = readCache<ApiProject[]>(CACHE_KEY.projects)
    if (cachedProjects) {
      const cached = cachedProjects.find(p => p.id === initialProject.id)
      if (cached?.repositories)
        return { ...initialProject, repositories: cached.repositories }
    }
    return initialProject
  })
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
  const [loading, setLoading] = useState(() => {
    const cached = readCache<{ tasks?: ApiTask[] }>(
      CACHE_KEY.projectTasks(initialProject.id)
    )
    return !cached?.tasks?.length
  })
  const [error, setError] = useState<string | null>(null)

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
      const res = await fetch(API.projects.tasks(project.id))
      if (!res.ok) throw new Error()
      const data = (await res.json()) as {
        tasks: ApiTask[]
        kanbanViewId: string | null
      }
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
  useEffect(() => {
    Promise.all([
      fetch(API.workspaces.members).then(r => (r.ok ? r.json() : null)),
      fetch(API.projects.tasks(project.id)).then(r => (r.ok ? r.json() : null)),
      fetch(API.projects.list).then(r => (r.ok ? r.json() : null)),
    ])
      .then(([membersData, tasksData, projectsData]) => {
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
        if (projectsData?.projects) {
          writeCache(CACHE_KEY.projects, projectsData.projects)
          const fresh = projectsData.projects.find(
            (p: ApiProject) => p.id === project.id
          )
          if (fresh?.repositories) {
            setProject(prev => ({ ...prev, repositories: fresh.repositories }))
          }
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
    }: NewTaskFormData) => {
      const res = await apiFetch(API.projects.tasks(project.id), {
        method: 'POST',
        body: {
          title,
          description: description?.trim() || undefined,
          status,
          priority,
          assigneeId: assigneeId || undefined,
        },
      })
      if (!res.ok) {
        const err = (await res.json()) as { error?: string }
        toast.error(err.error ?? 'Failed to create task')
        return
      }
      const { task } = (await res.json()) as { task: ApiTask }
      setTasks(prev => [...prev, task])
      toast.success('Task created')
    },
    [project.id]
  )

  const handleDeleteTask = useCallback(async (taskId: string) => {
    setTasks(prev => prev.filter(t => t.id !== taskId))
    await fetch(API.tasks.byId(taskId), { method: 'DELETE' })
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
        defaultReviewerId?: string | null
      }
    ) => {
      const res = await apiFetch(API.projects.byId(id), {
        method: 'PATCH',
        body: data,
      })
      if (!res.ok) throw new Error('Failed to update project')
      const { project: updated } = await res.json()
      setProject(prev => ({ ...prev, ...updated }))
    },
    []
  )

  const handleDeleteProject = useCallback(
    async (id: string) => {
      await fetch(API.projects.byId(id), { method: 'DELETE' })
      router.push(`/workspace/${workspaceUrl}`)
    },
    [router, workspaceUrl]
  )

  return (
    <SidebarProvider className='h-screen font-sans'>
      <AppSidebar
        currentPage={'projects' as Page}
        onNavigate={() => router.push(`/workspace/${workspaceUrl}`)}
        isDarkMode={isDarkMode}
        onToggleDarkMode={handleToggleDarkMode}
        unreadCount={0}
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
            onBack={() => router.push(`/workspace/${workspaceUrl}`)}
            onNewTask={status => {
              setNewTaskDefaultStatus(status)
              setIsNewTaskModalOpen(true)
            }}
            onTaskClick={task =>
              router.push(
                `/workspace/${workspaceUrl}/tasks/${task.teamIdentifier}-${task.number}`
              )
            }
            onDeleteTask={handleDeleteTask}
            onTaskStatusChanged={handleTaskStatusChanged}
            onUpdateProject={handleUpdateProject}
            onDeleteProject={handleDeleteProject}
            members={members}
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
