'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { AnimatePresence } from 'motion/react'
import { useUser } from '@clerk/nextjs'
import { Page, ApiProject, ApiTask, MyTask, ApiStatus } from './types'

// Hooks
import { useMyTasks } from './hooks/useMyTasks'
import { useProjects } from './hooks/useProjects'
import { useProjectTasks } from './hooks/useProjectTasks'
import { useMembers } from './hooks/useMembers'

// Components
import { AppSidebar } from './components/Sidebar'
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar'
import { ProjectsPage } from './components/pages/ProjectsPage'
import { ProjectDetailPage } from './components/pages/ProjectDetailPage'
import { MyTasksPage } from './components/pages/MyTasksPage'
import { NewTaskModal, NewTaskFormData } from './components/modals/NewTaskModal'
import {
  NewProjectModal,
  NewProjectFormData,
} from './components/modals/NewProjectModal'
import { TaskDrawer } from './components/TaskDrawer'

export default function DashboardApp() {
  // ─── Navigation ────────────────────────────────────────────────────────────
  const [currentPage, setCurrentPage] = useState<Page>('projects')
  const [selectedProject, setSelectedProject] = useState<ApiProject | null>(
    null
  )

  // ─── Data ──────────────────────────────────────────────────────────────────
  const {
    myTasks,
    setMyTasks,
    myTasksViewId,
    loading: myTasksLoading,
    error: myTasksError,
    fetchMyTasks,
  } = useMyTasks()

  const {
    projects,
    setProjects,
    loading: projectsLoading,
    error: projectsError,
    fetchProjects,
  } = useProjects()

  const {
    tasks: projectTasks,
    setTasks: setProjectTasks,
    kanbanViewId,
    loading: projectTasksLoading,
    error: projectTasksError,
    hydrateForProject,
    fetchProjectTasks,
  } = useProjectTasks()

  const { members, fetchMembers } = useMembers()
  const { user } = useUser()

  // Current user's workspace member ID (for defaulting assignee to self)
  const currentMemberId = useMemo(
    () => members.find(m => m.clerkId === user?.id)?.id,
    [members, user?.id]
  )

  // ─── Modal state ───────────────────────────────────────────────────────────
  const [isNewTaskModalOpen, setIsNewTaskModalOpen] = useState(false)
  const [isNewProjectModalOpen, setIsNewProjectModalOpen] = useState(false)
  const [newTaskDefaultAssigneeId, setNewTaskDefaultAssigneeId] = useState<
    string | undefined
  >(undefined)

  // ─── Task drawer ───────────────────────────────────────────────────────────
  const [selectedTask, setSelectedTask] = useState<ApiTask | MyTask | null>(
    null
  )

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
      }>
    ) => {
      // Optimistic update — apply immediately to both lists
      const patch = (t: ApiTask) => (t.id === taskId ? { ...t, ...data } : t)
      setProjectTasks(prev => prev.map(patch))

      // If assignee changed, check whether this task still belongs in My Tasks
      if ('assigneeId' in data) {
        const stillMine = data.assigneeId === currentMemberId
        setMyTasks(prev =>
          stillMine
            ? prev.map(t => (t.id === taskId ? { ...t, ...data } : t))
            : prev.filter(t => t.id !== taskId)
        )
      } else {
        setMyTasks(prev =>
          prev.map(t => (t.id === taskId ? { ...t, ...data } : t))
        )
      }

      try {
        const res = await fetch(`/api/tasks/${taskId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        })
        if (!res.ok) throw new Error('Failed to update task')
        const { task: updated } = (await res.json()) as { task: ApiTask }
        // Reconcile with server response
        setProjectTasks(prev =>
          prev.map(t => (t.id === taskId ? { ...t, ...updated } : t))
        )
        setMyTasks(prev =>
          updated.assigneeId === currentMemberId
            ? prev.map(t => (t.id === taskId ? { ...t, ...updated } : t))
            : prev.filter(t => t.id !== taskId)
        )
      } catch (err) {
        throw err
      }
    },
    [setProjectTasks, setMyTasks, currentMemberId]
  )

  const openNewTaskModal = useCallback(
    (assigneeId?: string) => {
      fetchMembers()
      setNewTaskDefaultAssigneeId(assigneeId)
      setIsNewTaskModalOpen(true)
    },
    [fetchMembers]
  )

  const openNewTaskModalForMe = useCallback(() => {
    openNewTaskModal(currentMemberId)
  }, [openNewTaskModal, currentMemberId])

  // ─── Dark mode (persisted to localStorage) ────────────────────────────────
  const [isDarkMode, setIsDarkMode] = useState(() => {
    if (typeof window === 'undefined') return false
    return localStorage.getItem('lumo:darkMode') === 'true'
  })

  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDarkMode)
    localStorage.setItem('lumo:darkMode', String(isDarkMode))
  }, [isDarkMode])

  // ─── Page-change side effects ──────────────────────────────────────────────
  useEffect(() => {
    if (currentPage === 'my-tasks') fetchMyTasks()
    if (currentPage === 'projects') fetchProjects()
  }, [currentPage, fetchMyTasks, fetchProjects])

  useEffect(() => {
    if (currentPage === 'project-detail' && selectedProject) {
      hydrateForProject(selectedProject.id)
      fetchProjectTasks(selectedProject.id)
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

      const res = await fetch('/api/projects', {
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
    },
    [setProjects, navigateTo]
  )

  // ─── Optimistic: create task ───────────────────────────────────────────────
  const handleCreateTask = useCallback(
    async ({
      title,
      description,
      status,
      projectId,
      assigneeId,
    }: NewTaskFormData) => {
      const tempId = `optimistic-task-${Date.now()}`
      const now = new Date().toISOString()
      const optimistic: ApiTask = {
        id: tempId,
        title,
        status,
        priority: 'MEDIUM',
        projectId,
        parentTaskId: null,
        assigneeId: assigneeId ?? null,
        updatedAt: now,
        viewOrder: null,
      }

      if (projectId === selectedProject?.id) {
        setProjectTasks(prev => [...prev, optimistic])
      }

      const res = await fetch(`/api/projects/${projectId}/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          description: description.trim() || undefined,
          status,
          assigneeId: assigneeId || undefined,
        }),
      })
      if (!res.ok) {
        const err = (await res.json()) as { error?: string }
        setProjectTasks(prev => prev.filter(t => t.id !== tempId))
        throw new Error(err.error ?? 'Failed to create task')
      }
      const { task } = (await res.json()) as { task: ApiTask }
      setProjectTasks(prev => prev.map(t => (t.id === tempId ? task : t)))
      setProjects(prev =>
        prev.map(p =>
          p.id === projectId
            ? { ...p, _count: { tasks: p._count.tasks + 1 } }
            : p
        )
      )
    },
    [selectedProject?.id, setProjectTasks, setProjects]
  )

  // ─── Update project name / description ────────────────────────────────────
  const handleUpdateProject = useCallback(
    async (id: string, data: { name?: string; description?: string }) => {
      const res = await fetch(`/api/projects/${id}`, {
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
            setTasks={setMyTasks}
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
            setTasks={setProjectTasks}
            viewId={kanbanViewId}
            loading={projectTasksLoading}
            error={projectTasksError}
            onRetry={() => fetchProjectTasks(selectedProject.id)}
            onBack={handleBack}
            onNewTask={openNewTaskModal}
            onTaskClick={handleOpenTask}
            onTaskStatusChanged={handleProjectTaskStatusChanged}
            onUpdateProject={handleUpdateProject}
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
      />

      <SidebarInset className='overflow-hidden'>{renderPage()}</SidebarInset>

      <AnimatePresence>
        {selectedTask && (
          <TaskDrawer
            initialTask={selectedTask}
            onClose={handleCloseTask}
            members={members}
            projects={projects}
            onUpdate={handleUpdateTask}
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
            }}
            projects={projects}
            members={members}
            defaultProjectId={selectedProject?.id}
            defaultAssigneeId={newTaskDefaultAssigneeId}
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
