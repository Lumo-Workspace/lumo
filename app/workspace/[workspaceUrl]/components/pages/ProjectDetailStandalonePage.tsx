'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronLeft, Link as LinkIcon, Check, Slack } from 'lucide-react'
import { AnimatePresence } from 'motion/react'
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar'
import { AppSidebar } from '../Sidebar'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
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
import { slugifyProjectName } from '../../utils'
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

  // ── Dark mode (same pattern as TaskDetailPage) ────────────────────────────
  const [isDarkMode, setIsDarkMode] = useState(false)
  useEffect(() => {
    setIsDarkMode(localStorage.getItem(CACHE_KEY.darkMode) === 'true')
  }, [])
  const handleToggleDarkMode = useCallback(() => {
    setIsDarkMode(prev => {
      const next = !prev
      localStorage.setItem(CACHE_KEY.darkMode, String(next))
      document.documentElement.classList.toggle('dark', next)
      return next
    })
  }, [])

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
  const [project, setProject] = useState<ApiProject>(initialProject)
  const [tasks, setTasks] = useState<ApiTask[]>([])
  const [kanbanViewId, setKanbanViewId] = useState<string | null>(null)
  const [members, setMembers] = useState<WorkspaceMemberInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // ── Slack integration ─────────────────────────────────────────────────────
  const [slackConnected, setSlackConnected] = useState<boolean | null>(null) // null = loading
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
        taskIds: data.tasks.map(t => t.id),
        kanbanViewId: data.kanbanViewId,
      })
    } catch {
      setError('Could not load tasks.')
    } finally {
      setLoading(false)
    }
  }, [project.id])

  // ── Mount: hydrate from cache + parallel fetch ────────────────────────────
  useEffect(() => {
    // Hydrate from cache immediately
    const cachedMembers = readCache<WorkspaceMemberInfo[]>(CACHE_KEY.members)
    if (cachedMembers) setMembers(cachedMembers)

    const cachedTasks = readCache<{
      taskIds?: string[]
      tasks?: ApiTask[]
      kanbanViewId?: string | null
    }>(CACHE_KEY.projectTasks(project.id))
    if (cachedTasks?.tasks) {
      setTasks(cachedTasks.tasks)
      setKanbanViewId(cachedTasks.kanbanViewId ?? null)
    }

    // Parallel fetch: members + project tasks + projects list (cache refresh only) + Slack status
    Promise.all([
      fetch(API.workspaces.members).then(r => (r.ok ? r.json() : null)),
      fetch(API.projects.tasks(project.id)).then(r => (r.ok ? r.json() : null)),
      fetch(API.projects.list).then(r => (r.ok ? r.json() : null)),
      fetch(API.slack.integration(workspaceUrl))
        .then(r => (r.ok ? r.json() : null))
        .catch(() => null),
    ])
      .then(([membersData, tasksData, projectsData, slackData]) => {
        if (slackData !== null) {
          setSlackConnected(slackData.connected === true)
        }
        if (membersData?.members) {
          setMembers(membersData.members)
          writeCache(CACHE_KEY.members, membersData.members)
        }
        if (tasksData?.tasks) {
          setTasks(tasksData.tasks)
          setKanbanViewId(tasksData.kanbanViewId ?? null)
          writeCache(CACHE_KEY.projectTasks(project.id), {
            taskIds: tasksData.tasks.map((t: ApiTask) => t.id),
            kanbanViewId: tasksData.kanbanViewId,
          })
        }
        if (projectsData?.projects) {
          writeCache(CACHE_KEY.projects, projectsData.projects)
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
      const res = await fetch(API.projects.tasks(project.id), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          description: description?.trim() || undefined,
          status,
          priority,
          assigneeId: assigneeId || undefined,
        }),
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
      const res = await fetch(API.projects.byId(id), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
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
        {/* Breadcrumb */}
        <div className='flex items-center justify-between px-5 h-10 border-b border-zinc-100 dark:border-zinc-800 shrink-0 text-sm'>
          <div className='flex items-center gap-1.5'>
            <button
              onClick={() => router.push(`/workspace/${workspaceUrl}`)}
              className='flex items-center gap-1 text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors'
            >
              <ChevronLeft size={14} />
              <span>Projects</span>
            </button>
            <span className='text-zinc-300 dark:text-zinc-600'>›</span>
            <span className='text-zinc-700 dark:text-zinc-300 truncate max-w-xs'>
              {project.name}
            </span>
          </div>
          <div className='flex items-center gap-1'>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant='ghost'
                  size='icon'
                  onClick={() => setSlackDialogOpen(true)}
                  disabled={slackConnected === null}
                  className='h-7 w-7 text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 disabled:opacity-30'
                >
                  <Slack size={14} />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {slackConnected === false
                  ? 'Connect Slack in Settings first'
                  : 'Slack notifications'}
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant='ghost'
                  size='icon'
                  onClick={handleCopyLink}
                  className='h-7 w-7 text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100'
                >
                  {copied ? <Check size={14} /> : <LinkIcon size={14} />}
                </Button>
              </TooltipTrigger>
              <TooltipContent>Copy link</TooltipContent>
            </Tooltip>
          </div>
        </div>

        {/* Main content */}
        <div className='flex-1 overflow-hidden'>
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
