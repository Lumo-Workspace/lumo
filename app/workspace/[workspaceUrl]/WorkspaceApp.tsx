'use client'

import {
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
  Dispatch,
  SetStateAction,
} from 'react'
import { useParams } from 'next/navigation'
import { AnimatePresence } from 'motion/react'
import { PageTransition } from '@/components/PageTransition'
import { toast } from 'sonner'
import { useUser } from '@clerk/nextjs'
import {
  Page,
  ApiProject,
  ApiTask,
  MyTask,
  ApiStatus,
  ApiPriority,
} from './types'
import { API, CACHE_KEY } from './constants'
import { clearCache, readCache, writeCache } from './cache'

// Hooks
import { useTaskStore } from './hooks/useTaskStore'
import { useMyTasks } from './hooks/useMyTasks'
import { useProjects } from './hooks/useProjects'
import { useProjectTasks } from './hooks/useProjectTasks'
import { useMembers } from './hooks/useMembers'
import { useNotifications } from './hooks/useNotifications'

// Components
import { AppSidebar } from './components/Sidebar'
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar'
import { MobileSidebar } from './components/MobileSidebar'
import { ProjectsPage } from './components/pages/ProjectsPage'
import { ProjectDetailPage } from './components/pages/ProjectDetailPage'
import { MyTasksPage } from './components/pages/MyTasksPage'
import { InboxPage } from './components/pages/InboxPage'
import { NewTaskModal, NewTaskFormData } from './components/modals/NewTaskModal'
import {
  NewProjectModal,
  NewProjectFormData,
} from './components/modals/NewProjectModal'
import { TaskDrawer } from './components/TaskDrawer'

export default function DashboardApp() {
  const { workspaceUrl } = useParams<{ workspaceUrl: string }>()

  // ─── Navigation ────────────────────────────────────────────────────────────
  const [currentPage, setCurrentPage] = useState<Page>('projects')
  const [selectedProject, setSelectedProject] = useState<ApiProject | null>(
    null
  )

  // ─── Normalized task store (single source of truth) ───────────────────────
  const {
    taskMap,
    upsertTasks,
    updateTask,
    removeTask,
    removeTasks,
    replaceTempId,
  } = useTaskStore()

  // ─── Data ──────────────────────────────────────────────────────────────────
  const {
    taskIds: myTaskIds,
    setTaskIds: setMyTaskIds,
    myTasksViewId,
    loading: myTasksLoading,
    error: myTasksError,
    fetchMyTasks,
  } = useMyTasks(upsertTasks)

  const {
    projects,
    setProjects,
    loading: projectsLoading,
    error: projectsError,
    fetchProjects,
  } = useProjects()

  const {
    taskIds: projectTaskIds,
    setTaskIds: setProjectTaskIds,
    kanbanViewId,
    loading: projectTasksLoading,
    error: projectTasksError,
    hydrateForProject,
    fetchProjectTasks,
  } = useProjectTasks(upsertTasks)

  const { members, fetchMembers } = useMembers()
  const {
    notifications,
    unreadCount,
    loading: notificationsLoading,
    error: notificationsError,
    fetchNotifications,
    markOneRead,
    markOneUnread,
    deleteOne: deleteNotification,
    markAllRead,
  } = useNotifications()
  const { user } = useUser()

  // Current user's workspace member ID (for defaulting assignee to self)
  const currentMemberId = useMemo(
    () => members.find(m => m.clerkId === user?.id)?.id,
    [members, user?.id]
  )

  // ─── Derive task arrays from normalized store ──────────────────────────────
  const myTasks = useMemo(
    () => myTaskIds.map(id => taskMap[id]).filter(Boolean) as MyTask[],
    [myTaskIds, taskMap]
  )

  const projectTasks = useMemo(
    () => projectTaskIds.map(id => taskMap[id]).filter(Boolean) as ApiTask[],
    [projectTaskIds, taskMap]
  )

  // ─── DnD setTasks wrappers (bridge Dispatch<SetStateAction<T[]>> to store) ─
  // These are passed to Board/List views which call setTasks for drag operations.
  const setMyTasksForDnD = useCallback<Dispatch<SetStateAction<MyTask[]>>>(
    action => {
      const prev = myTaskIds.map(id => taskMap[id]).filter(Boolean) as MyTask[]
      const next = typeof action === 'function' ? action(prev) : action
      const changed = next.filter(t => taskMap[t.id] !== t)
      if (changed.length > 0) upsertTasks(changed)
      setMyTaskIds(next.map(t => t.id))
    },
    [myTaskIds, taskMap, upsertTasks, setMyTaskIds]
  )

  const setProjectTasksForDnD = useCallback<
    Dispatch<SetStateAction<ApiTask[]>>
  >(
    action => {
      const prev = projectTaskIds
        .map(id => taskMap[id])
        .filter(Boolean) as ApiTask[]
      const next = typeof action === 'function' ? action(prev) : action
      const changed = next.filter(t => taskMap[t.id] !== t)
      if (changed.length > 0) upsertTasks(changed)
      setProjectTaskIds(next.map(t => t.id))
    },
    [projectTaskIds, taskMap, upsertTasks, setProjectTaskIds]
  )

  // ─── Modal state ───────────────────────────────────────────────────────────
  const [isNewTaskModalOpen, setIsNewTaskModalOpen] = useState(false)
  const [isNewProjectModalOpen, setIsNewProjectModalOpen] = useState(false)
  const [newTaskDefaultAssigneeId, setNewTaskDefaultAssigneeId] = useState<
    string | undefined
  >(undefined)
  const [newTaskDefaultStatus, setNewTaskDefaultStatus] = useState<
    ApiStatus | undefined
  >(undefined)

  // ─── Task drawer ───────────────────────────────────────────────────────────
  const [selectedTask, setSelectedTask] = useState<ApiTask | MyTask | null>(
    null
  )
  // description cache: taskId → description html (populated after first fetch)
  const descriptionCache = useRef<Map<string, string | null>>(new Map())

  const handleOpenTask = useCallback(
    (task: ApiTask | MyTask) => {
      fetchMembers()
      setSelectedTask(task)
    },
    [fetchMembers]
  )

  const handleCloseTask = useCallback(() => setSelectedTask(null), [])

  const handleUpdateTask = useCallback(
    async (
      taskId: string,
      data: Partial<{
        title: string
        status: ApiStatus
        assigneeId: string | null
        description: string | null
        projectId: string
        priority: ApiPriority
      }>
    ) => {
      // Optimistic update — single call to task map
      updateTask(taskId, data)

      // Sync ID lists if the task moves out of the current project
      if ('projectId' in data && data.projectId !== selectedProject?.id) {
        setProjectTaskIds(prev => prev.filter(id => id !== taskId))
      }

      // Sync my-tasks ID list if assignee changed
      if ('assigneeId' in data) {
        const nowMine = data.assigneeId === currentMemberId
        const wasMine = myTaskIds.includes(taskId)
        if (wasMine && !nowMine)
          setMyTaskIds(prev => prev.filter(id => id !== taskId))
        if (!wasMine && nowMine) setMyTaskIds(prev => [...prev, taskId])
      }

      try {
        const res = await fetch(API.tasks.byId(taskId), {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        })
        if (!res.ok) throw new Error('Failed to update task')
        const { task: updated } = (await res.json()) as { task: ApiTask }
        // Reconcile with server response (preserves project field via upsertTasks merge)
        upsertTasks([updated])
        // Re-check assignee after server confirms
        const nowMine = updated.assigneeId === currentMemberId
        const wasMine = myTaskIds.includes(taskId)
        if (wasMine && !nowMine)
          setMyTaskIds(prev => prev.filter(id => id !== taskId))
        if (!wasMine && nowMine) setMyTaskIds(prev => [...prev, taskId])
      } catch (err) {
        throw err
      }
    },
    [
      updateTask,
      upsertTasks,
      selectedProject?.id,
      currentMemberId,
      myTaskIds,
      setProjectTaskIds,
      setMyTaskIds,
    ]
  )

  const handleDeleteTask = useCallback(
    async (taskId: string) => {
      // Optimistic removal
      removeTask(taskId)
      setMyTaskIds(prev => prev.filter(id => id !== taskId))
      setProjectTaskIds(prev => prev.filter(id => id !== taskId))
      // Close drawer if this task is open
      setSelectedTask(prev => (prev?.id === taskId ? null : prev))

      try {
        const res = await fetch(API.tasks.byId(taskId), { method: 'DELETE' })
        if (!res.ok) throw new Error('Failed to delete task')
      } catch (err) {
        console.error(err)
      }
    },
    [removeTask, setMyTaskIds, setProjectTaskIds]
  )

  const openNewTaskModal = useCallback(
    (assigneeId?: string, status?: ApiStatus) => {
      fetchMembers()
      fetchProjects()
      setNewTaskDefaultAssigneeId(
        typeof assigneeId === 'string' ? assigneeId : undefined
      )
      setNewTaskDefaultStatus(status)
      setIsNewTaskModalOpen(true)
    },
    [fetchMembers, fetchProjects]
  )

  const openNewTaskModalForMe = useCallback(
    (status?: ApiStatus) => {
      openNewTaskModal(currentMemberId, status)
    },
    [openNewTaskModal, currentMemberId]
  )

  // ─── Dark mode (persisted to localStorage) ────────────────────────────────
  const [isDarkMode, setIsDarkMode] = useState(() => {
    if (typeof window === 'undefined') return false
    return localStorage.getItem(CACHE_KEY.darkMode) === 'true'
  })

  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDarkMode)
    localStorage.setItem(CACHE_KEY.darkMode, String(isDarkMode))
  }, [isDarkMode])

  // ─── Clear stale cache when user or workspace changes ─────────────────────
  useEffect(() => {
    if (!user?.id || !workspaceUrl) return
    const context = `${user.id}:${workspaceUrl}`
    const prev = localStorage.getItem('lumo:context')
    if (prev && prev !== context) {
      clearCache()
    }
    localStorage.setItem('lumo:context', context)
  }, [user?.id, workspaceUrl])

  // ─── Fetch notifications on mount ─────────────────────────────────────────
  useEffect(() => {
    fetchNotifications()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ─── Page-change side effects ──────────────────────────────────────────────
  useEffect(() => {
    if (currentPage === 'my-tasks') {
      fetchMyTasks()
      fetchProjects()
    }
    if (currentPage === 'projects') fetchProjects()
  }, [currentPage, fetchMyTasks, fetchProjects])

  useEffect(() => {
    if (currentPage === 'project-detail' && selectedProject) {
      hydrateForProject(selectedProject.id)
      if (!selectedProject.id.startsWith('optimistic-')) {
        fetchProjectTasks(selectedProject.id)
      }
    }
  }, [currentPage, selectedProject?.id, hydrateForProject, fetchProjectTasks])

  // ─── Navigation helpers ────────────────────────────────────────────────────
  const navigateTo = useCallback((page: Page, project?: ApiProject) => {
    setCurrentPage(page)
    if (project) setSelectedProject(project)
  }, [])

  const handleSelectProject = useCallback(
    (p: ApiProject) => navigateTo('project-detail', p),
    [navigateTo]
  )
  const handleBack = useCallback(() => navigateTo('projects'), [navigateTo])
  const openNewProject = useCallback(() => setIsNewProjectModalOpen(true), [])

  // ─── Optimistic: create project ────────────────────────────────────────────
  const handleCreateProject = useCallback(
    async ({ name, description }: NewProjectFormData) => {
      const tempId = `optimistic-${Date.now()}`
      const now = new Date().toISOString()
      const optimistic: ApiProject = {
        id: tempId,
        name,
        description: description.trim() || null,
        isIdea: false,
        createdAt: now,
        updatedAt: now,
        _count: { tasks: 0 },
        inProgressCount: 0,
      }

      setProjects(prev => [optimistic, ...prev])
      navigateTo('project-detail', optimistic)

      const res = await fetch(API.projects.list, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          description: description.trim() || undefined,
        }),
      })
      if (!res.ok) {
        const err = (await res.json()) as { error?: string }
        setProjects(prev => prev.filter(p => p.id !== tempId))
        navigateTo('projects')
        toast.error(err.error ?? 'Failed to create project')
        throw new Error(err.error ?? 'Failed to create project')
      }
      const { project } = (await res.json()) as { project: ApiProject }
      const confirmed: ApiProject = {
        ...project,
        _count: { tasks: 0 },
        inProgressCount: 0,
      }
      setProjects(prev => prev.map(p => (p.id === tempId ? confirmed : p)))
      setSelectedProject(prev => (prev?.id === tempId ? confirmed : prev))
      toast.success('Project created', {
        description: `${project.name}`,
      })
    },
    [setProjects, navigateTo]
  )

  // ─── Optimistic: create task ───────────────────────────────────────────────
  const handleCreateTask = useCallback(
    async ({
      title,
      description,
      status,
      priority,
      projectId,
      assigneeId,
    }: NewTaskFormData) => {
      const tempId = `optimistic-task-${Date.now()}`
      const now = new Date().toISOString()
      const project = projects.find(p => p.id === projectId)
      const optimistic: ApiTask = {
        id: tempId,
        title,
        status,
        priority,
        projectId,
        parentTaskId: null,
        assigneeId: assigneeId ?? null,
        updatedAt: now,
        viewOrder: null,
        number: 0,
        teamIdentifier: '',
        ...(project ? { project: { id: projectId, name: project.name } } : {}),
      }

      upsertTasks([optimistic])

      if (projectId === selectedProject?.id) {
        setProjectTaskIds(prev => [...prev, tempId])
      }

      if (assigneeId && assigneeId === currentMemberId) {
        setMyTaskIds(prev => [...prev, tempId])
      }

      const res = await fetch(API.projects.tasks(projectId), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          description: description.trim() || undefined,
          status,
          priority,
          assigneeId: assigneeId || undefined,
        }),
      })
      if (!res.ok) {
        const err = (await res.json()) as { error?: string }
        removeTask(tempId)
        setProjectTaskIds(prev => prev.filter(id => id !== tempId))
        setMyTaskIds(prev => prev.filter(id => id !== tempId))
        toast.error(err.error ?? 'Failed to create task')
        throw new Error(err.error ?? 'Failed to create task')
      }
      const { task } = (await res.json()) as { task: ApiTask }
      // Merge real task (preserving project field via replaceTempId)
      replaceTempId(tempId, {
        ...task,
        ...(project ? { project: { id: projectId, name: project.name } } : {}),
      })
      setProjectTaskIds(prev => prev.map(id => (id === tempId ? task.id : id)))
      setMyTaskIds(prev => prev.map(id => (id === tempId ? task.id : id)))
      setProjects(prev =>
        prev.map(p =>
          p.id === projectId
            ? { ...p, _count: { tasks: p._count.tasks + 1 } }
            : p
        )
      )
      toast.success('Task created', {
        description: `${task.teamIdentifier}-${task.number} - ${task.title}`,
      })
    },
    [
      selectedProject?.id,
      upsertTasks,
      replaceTempId,
      removeTask,
      setProjectTaskIds,
      setMyTaskIds,
      setProjects,
      projects,
      currentMemberId,
    ]
  )

  // ─── Delete / update project ───────────────────────────────────────────────
  const handleDeleteProject = useCallback(
    async (projectId: string) => {
      // Evict description cache for all tasks under this project
      const deletedIds = projectTaskIds.filter(
        id => taskMap[id]?.projectId === projectId
      )
      deletedIds.forEach(id => descriptionCache.current.delete(id))

      setSelectedProject(null)
      setSelectedTask(prev =>
        prev && 'projectId' in prev && prev.projectId === projectId
          ? null
          : prev
      )
      removeTasks(deletedIds)
      setProjectTaskIds([])
      setMyTaskIds(prev =>
        prev.filter(id => taskMap[id]?.projectId !== projectId)
      )
      setProjects(prev => prev.filter(p => p.id !== projectId))
      navigateTo('projects')

      const res = await fetch(API.projects.byId(projectId), {
        method: 'DELETE',
      })
      if (!res.ok) throw new Error('Failed to delete project')
    },
    [
      navigateTo,
      projectTaskIds,
      taskMap,
      descriptionCache,
      removeTasks,
      setProjectTaskIds,
      setMyTaskIds,
      setProjects,
    ]
  )

  const handleUpdateProject = useCallback(
    async (id: string, data: { name?: string; description?: string }) => {
      const res = await fetch(API.projects.byId(id), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      if (!res.ok) throw new Error('Failed to update project')
      const { project: updated } = await res.json()
      setProjects(prev =>
        prev.map(p => (p.id === id ? { ...p, ...updated } : p))
      )
      setSelectedProject(prev =>
        prev?.id === id ? { ...prev, ...updated } : prev
      )
    },
    [setProjects, setSelectedProject]
  )

  // ─── Sync inProgressCount after drag-and-drop status change ───────────────
  const handleProjectTaskStatusChanged = useCallback(
    (_taskId: string, oldStatus: string, newStatus: string) => {
      if (!selectedProject) return
      const delta =
        (newStatus === 'IN_PROGRESS' ? 1 : 0) -
        (oldStatus === 'IN_PROGRESS' ? 1 : 0)
      if (delta !== 0) {
        setProjects(prev =>
          prev.map(p =>
            p.id === selectedProject.id
              ? {
                  ...p,
                  inProgressCount: Math.max(0, p.inProgressCount + delta),
                }
              : p
          )
        )
      }
    },
    [selectedProject, setProjects]
  )

  // ─── Render current page ───────────────────────────────────────────────────
  const renderPage = () => {
    switch (currentPage) {
      case 'my-tasks':
        return (
          <MyTasksPage
            tasks={myTasks}
            setTasks={setMyTasksForDnD}
            viewId={myTasksViewId}
            loading={myTasksLoading}
            error={myTasksError}
            onRetry={fetchMyTasks}
            onTaskClick={handleOpenTask}
            onNewTask={openNewTaskModalForMe}
          />
        )

      case 'projects':
        return (
          <ProjectsPage
            projects={projects}
            loading={projectsLoading}
            error={projectsError}
            onRetry={fetchProjects}
            onSelectProject={handleSelectProject}
            onNewProject={openNewProject}
          />
        )

      case 'project-detail':
        if (!selectedProject) return null
        return (
          <ProjectDetailPage
            project={selectedProject}
            tasks={projectTasks}
            setTasks={setProjectTasksForDnD}
            viewId={kanbanViewId}
            loading={projectTasksLoading}
            error={projectTasksError}
            onRetry={() => fetchProjectTasks(selectedProject.id)}
            onBack={handleBack}
            onNewTask={status => openNewTaskModal(undefined, status)}
            onTaskClick={handleOpenTask}
            onDeleteTask={handleDeleteTask}
            onTaskStatusChanged={handleProjectTaskStatusChanged}
            onUpdateProject={handleUpdateProject}
            onDeleteProject={handleDeleteProject}
            members={members}
          />
        )

      case 'inbox':
        return (
          <InboxPage
            notifications={notifications}
            unreadCount={unreadCount}
            loading={notificationsLoading}
            error={notificationsError}
            onRetry={fetchNotifications}
            onMount={fetchNotifications}
            onMarkOneRead={markOneRead}
            onMarkOneUnread={markOneUnread}
            onDeleteOne={deleteNotification}
            onMarkAllRead={markAllRead}
            onUpdateTaskStatus={async (taskId, status) => {
              await handleUpdateTask(taskId, { status })
            }}
            members={members}
            projects={projects}
            taskMap={taskMap}
            upsertTasks={upsertTasks}
            onUpdate={handleUpdateTask}
          />
        )

      default:
        return null
    }
  }

  return (
    <SidebarProvider className='h-screen overflow-hidden font-sans'>
      <AppSidebar
        currentPage={currentPage}
        onNavigate={navigateTo}
        isDarkMode={isDarkMode}
        onToggleDarkMode={() => setIsDarkMode(d => !d)}
        unreadCount={unreadCount}
      />

      <SidebarInset className='overflow-hidden flex flex-col'>
        {/* Mobile-only top bar */}
        <div className='md:hidden flex items-center h-12 px-4 border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 shrink-0'>
          <MobileSidebar
            currentPage={currentPage}
            onNavigate={navigateTo}
            isDarkMode={isDarkMode}
            onToggleDarkMode={() => setIsDarkMode(d => !d)}
            unreadCount={unreadCount}
          />
        </div>
        <div className='flex-1 overflow-hidden flex flex-col relative'>
          <PageTransition pageKey={currentPage}>{renderPage()}</PageTransition>
        </div>
      </SidebarInset>

      <AnimatePresence>
        {selectedTask && (
          <TaskDrawer
            initialTask={selectedTask}
            {...(taskMap[selectedTask.id]
              ? { liveTask: taskMap[selectedTask.id] }
              : {})}
            cachedDescription={
              descriptionCache.current.has(selectedTask.id)
                ? descriptionCache.current.get(selectedTask.id)
                : readCache<{ desc: string | null }>(
                    CACHE_KEY.description(selectedTask.id)
                  )?.desc
            }
            onClose={handleCloseTask}
            members={members}
            projects={projects}
            onUpdate={handleUpdateTask}
            onDescriptionLoaded={(taskId, description) => {
              descriptionCache.current.set(taskId, description)
              writeCache(CACHE_KEY.description(taskId), { desc: description })
            }}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isNewTaskModalOpen && (
          <NewTaskModal
            isOpen={isNewTaskModalOpen}
            onClose={() => {
              setIsNewTaskModalOpen(false)
              setNewTaskDefaultAssigneeId(undefined)
              setNewTaskDefaultStatus(undefined)
            }}
            projects={projects}
            members={members}
            defaultProjectId={selectedProject?.id}
            defaultAssigneeId={newTaskDefaultAssigneeId}
            defaultStatus={newTaskDefaultStatus}
            onSubmit={handleCreateTask}
          />
        )}
        {isNewProjectModalOpen && (
          <NewProjectModal
            isOpen={isNewProjectModalOpen}
            onClose={() => setIsNewProjectModalOpen(false)}
            onSubmit={handleCreateProject}
          />
        )}
      </AnimatePresence>
    </SidebarProvider>
  )
}
