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
import { AnimatePresence, motion } from 'motion/react'
import { PageTransition } from '@/components/PageTransition'
import { toast } from 'sonner'
import { useCurrentUser } from './hooks/useCurrentUser'
import {
  Page,
  ApiProject,
  ApiTask,
  MyTask,
  ApiStatus,
  ApiPriority,
} from './types'
import { API, CACHE_KEY } from './constants'
import { slugifyProjectName, apiFetch } from './utils'
import { clearCache, readCache, writeCache } from './cache'

// Hooks
import { useTaskStore } from './hooks/useTaskStore'
import { useMyTasks } from './hooks/useMyTasks'
import { useProjects } from './hooks/useProjects'
import { useProjectTasks } from './hooks/useProjectTasks'
import { useMembers } from './hooks/useMembers'
import { useRealtimeNotifications } from './hooks/useRealtimeNotifications'
import { usePusherEvent } from './hooks/usePusher'
import { useDocuments } from './hooks/useDocuments'

// Components
import { AppSidebar } from './components/Sidebar'
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar'
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
import { ProjectSlackDialog } from './components/ProjectSlackDialog'
import { DocumentsPage } from './components/pages/DocumentsPage'
import { DocumentEditorPage } from './components/pages/DocumentEditorPage'

// ─── URL ↔ Page mapping ──────────────────────────────────────────────────────

function pageToPath(
  workspaceUrl: string,
  page: Page,
  project?: ApiProject | null
): string {
  const base = `/workspace/${workspaceUrl}`
  switch (page) {
    case 'my-tasks':
      return `${base}/my-tasks`
    case 'inbox':
      return `${base}/inbox`
    case 'projects':
      return `${base}/projects`
    case 'project-detail':
      return project
        ? `${base}/projects/${slugifyProjectName(project.name)}`
        : `${base}/projects`
    case 'documents':
      return `${base}/documents`
    case 'document-editor':
      return `${base}/documents/${project?.id ?? ''}`
    default:
      return `${base}/my-tasks`
  }
}

function pathToPage(
  pathname: string,
  workspaceUrl: string
): { page: Page; projectSlug?: string | undefined } {
  const base = `/workspace/${workspaceUrl}`
  const rest = pathname.startsWith(base) ? pathname.slice(base.length) : ''

  if (rest.startsWith('/documents/')) {
    const docId = rest.slice('/documents/'.length).split('/')[0]
    return { page: 'document-editor', projectSlug: docId }
  }
  if (rest.startsWith('/documents')) return { page: 'documents' }
  if (rest.startsWith('/inbox')) return { page: 'inbox' }
  if (rest.startsWith('/projects/')) {
    const projectSlug = rest.slice('/projects/'.length).split('/')[0]
    return { page: 'project-detail', projectSlug }
  }
  if (rest.startsWith('/projects')) return { page: 'projects' }
  // Default: /my-tasks or bare /workspace/[slug]
  return { page: 'my-tasks' }
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function DashboardApp() {
  const { workspaceUrl } = useParams<{ workspaceUrl: string }>()

  // ─── Navigation ────────────────────────────────────────────────────────────
  // Initialise currentPage from the current URL
  const [currentPage, setCurrentPage] = useState<Page>(() => {
    if (typeof window === 'undefined') return 'my-tasks'
    return pathToPage(window.location.pathname, workspaceUrl).page
  })
  const [selectedProject, setSelectedProject] = useState<ApiProject | null>(
    null
  )
  // Track the initial project slug from the URL so we can resolve it after projects load
  const [pendingProjectSlug] = useState<string | undefined>(() => {
    if (typeof window === 'undefined') return undefined
    return pathToPage(window.location.pathname, workspaceUrl).projectSlug
  })

  // ─── Documents ─────────────────────────────────────────────────────────────
  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(
    () => {
      if (typeof window === 'undefined') return null
      const { page, projectSlug } = pathToPage(
        window.location.pathname,
        workspaceUrl
      )
      return page === 'document-editor' && projectSlug ? projectSlug : null
    }
  )

  // ─── Slack ─────────────────────────────────────────────────────────────────
  const [slackDialogOpen, setSlackDialogOpen] = useState(false)

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

  const { members, fetchMembers, agentActors } = useMembers()
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
    respondToNotification,
  } = useRealtimeNotifications()
  const {
    documents,
    setDocuments,
    loading: documentsLoading,
    error: documentsError,
    fetchDocuments,
  } = useDocuments()

  const { user } = useCurrentUser()

  // Current user's workspace member info
  const currentMember = useMemo(
    () => members.find(m => m.clerkId === user?.id),
    [members, user?.id]
  )
  const currentMemberId = currentMember?.id
  const currentActorId = currentMember?.actorId ?? null
  const isOwner = currentMember?.role === 'OWNER'

  // ─── Derive task arrays from normalized store ──────────────────────────────
  const myTasks = useMemo(
    () => myTaskIds.map(id => taskMap[id]).filter(Boolean) as MyTask[],
    [myTaskIds, taskMap]
  )

  const projectTasks = useMemo(
    () => projectTaskIds.map(id => taskMap[id]).filter(Boolean) as ApiTask[],
    [projectTaskIds, taskMap]
  )

  // ─── Real-time board updates via project channel ──────────────────────────
  usePusherEvent<{
    taskId: string
    fields: string[]
    patch?: Record<string, unknown>
  }>(
    selectedProject ? `project-${selectedProject.id}` : null,
    'project-update',
    useCallback(
      event => {
        if (event.patch) {
          updateTask(event.taskId, event.patch)
        }
      },
      [updateTask]
    )
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
        assigneeActorId: string | null
        reviewerActorId: string | null
        description: string | null
        projectId: string
        priority: ApiPriority
        dueDate: string | null
      }>
    ) => {
      // Optimistic update — single call to task map
      updateTask(taskId, data)

      // Sync ID lists if the task moves out of the current project
      if ('projectId' in data && data.projectId !== selectedProject?.id) {
        setProjectTaskIds(prev => prev.filter(id => id !== taskId))
      }

      // Sync my-tasks ID list if assignee changed
      // currentMemberId is a WorkspaceMember.id; we compare against task.assigneeActorId
      // by looking up the member's actorId
      const currentMemberActorId = members.find(
        m => m.id === currentMemberId
      )?.actorId
      if ('assigneeActorId' in data && currentMemberActorId) {
        const nowMine = data.assigneeActorId === currentMemberActorId
        const wasMine = myTaskIds.includes(taskId)
        if (wasMine && !nowMine)
          setMyTaskIds(prev => prev.filter(id => id !== taskId))
        if (!wasMine && nowMine) setMyTaskIds(prev => [...prev, taskId])
      }

      try {
        const res = await apiFetch(API.tasks.byId(taskId), {
          method: 'PATCH',
          body: data,
        })
        if (!res.ok) throw new Error('Failed to update task')
        const { task: updated } = (await res.json()) as { task: ApiTask }
        // Reconcile with server response (preserves project field via upsertTasks merge)
        upsertTasks([updated])
        // Re-check assignee after server confirms
        if (currentMemberActorId) {
          const nowMine = updated.assigneeActorId === currentMemberActorId
          const wasMine = myTaskIds.includes(taskId)
          if (wasMine && !nowMine)
            setMyTaskIds(prev => prev.filter(id => id !== taskId))
          if (!wasMine && nowMine) setMyTaskIds(prev => [...prev, taskId])
        }
      } catch (err) {
        throw err
      }
    },
    [
      updateTask,
      upsertTasks,
      selectedProject?.id,
      currentMemberId,
      members,
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

  // (notifications mount + pusher handled by useRealtimeNotifications)

  // ─── Page-change side effects ──────────────────────────────────────────────
  useEffect(() => {
    if (currentPage === 'my-tasks') {
      fetchMyTasks()
      fetchProjects()
    }
    if (currentPage === 'projects' || currentPage === 'project-detail')
      fetchProjects()
    if (currentPage === 'documents') fetchDocuments()
  }, [currentPage, fetchMyTasks, fetchProjects, fetchDocuments])

  useEffect(() => {
    if (currentPage === 'project-detail' && selectedProject) {
      hydrateForProject(selectedProject.id)
      if (!selectedProject.id.startsWith('optimistic-')) {
        fetchProjectTasks(selectedProject.id)
      }
    }
  }, [currentPage, selectedProject?.id, hydrateForProject, fetchProjectTasks])

  // ─── URL sync: push URL when navigating, listen for back/forward ─────────
  const navigateTo = useCallback(
    (page: Page, project?: ApiProject) => {
      setCurrentPage(page)
      if (project) setSelectedProject(project)
      const path = pageToPath(workspaceUrl, page, project)
      window.history.pushState(null, '', path)
    },
    [workspaceUrl]
  )

  // Browser back/forward → sync currentPage from URL
  useEffect(() => {
    const onPopState = () => {
      const { page, projectSlug } = pathToPage(
        window.location.pathname,
        workspaceUrl
      )
      setCurrentPage(page)
      if (page === 'project-detail' && projectSlug) {
        const match = projects.find(
          p => slugifyProjectName(p.name) === projectSlug
        )
        if (match) setSelectedProject(match)
      }
      if (page === 'document-editor' && projectSlug) {
        setSelectedDocumentId(projectSlug)
      } else if (page !== 'document-editor') {
        setSelectedDocumentId(null)
      }
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [workspaceUrl, projects])

  // Replace bare /workspace/[slug] URL with /workspace/[slug]/my-tasks
  useEffect(() => {
    const base = `/workspace/${workspaceUrl}`
    if (
      window.location.pathname === base ||
      window.location.pathname === `${base}/`
    ) {
      window.history.replaceState(null, '', `${base}/my-tasks`)
    }
  }, [workspaceUrl])

  // Resolve pending project slug once projects have loaded
  useEffect(() => {
    if (
      pendingProjectSlug &&
      currentPage === 'project-detail' &&
      !selectedProject &&
      projects.length > 0
    ) {
      const match = projects.find(
        p => slugifyProjectName(p.name) === pendingProjectSlug
      )
      if (match) setSelectedProject(match)
    }
  }, [pendingProjectSlug, currentPage, selectedProject, projects])

  const handleSelectProject = useCallback(
    (p: ApiProject) => {
      navigateTo('project-detail', p)
    },
    [navigateTo]
  )
  const handleBack = useCallback(() => {
    navigateTo('projects')
  }, [navigateTo])
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
        defaultReviewerId: null,
        createdAt: now,
        updatedAt: now,
        _count: { tasks: 0 },
        inProgressCount: 0,
      }

      setProjects(prev => [optimistic, ...prev])
      navigateTo('project-detail', optimistic)

      const res = await apiFetch(API.projects.list, {
        method: 'POST',
        body: {
          name,
          description: description.trim() || undefined,
        },
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
      repositoryId,
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
        assigneeActorId: assigneeId ?? null,
        reviewerActorId: null,
        repositoryId: repositoryId ?? null,
        createdAt: now,
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

      const res = await apiFetch(API.projects.tasks(projectId), {
        method: 'POST',
        body: {
          title,
          description: description.trim() || undefined,
          status,
          priority,
          assigneeActorId: assigneeId || undefined,
          repositoryId: repositoryId ?? undefined,
        },
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

  // ─── Document handlers ─────────────────────────────────────────────────────
  const handleNewDocument = useCallback(async () => {
    try {
      const res = await fetch(API.documents.list, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      if (res.ok) {
        const data = await res.json()
        setDocuments(prev => [data.document, ...prev])
        setCurrentPage('document-editor')
        setSelectedDocumentId(data.document.id)
        window.history.pushState(
          null,
          '',
          `/workspace/${workspaceUrl}/documents/${data.document.id}`
        )
      }
    } catch {}
  }, [workspaceUrl, setDocuments])

  const handleDeleteDocument = useCallback(
    async (id: string) => {
      try {
        await fetch(API.documents.byId(id), { method: 'DELETE' })
        setDocuments(prev => prev.filter(d => d.id !== id))
      } catch {}
    },
    [setDocuments]
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
            userId={user?.id ?? ''}
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
            currentActorId={currentActorId}
            isOwner={isOwner}
            onSlack={() => setSlackDialogOpen(true)}
            workspaceUrl={workspaceUrl}
          />
        )

      case 'documents':
        return (
          <DocumentsPage
            documents={documents}
            loading={documentsLoading}
            error={documentsError}
            onRetry={fetchDocuments}
            onNewDocument={handleNewDocument}
            onSelectDocument={doc => {
              setCurrentPage('document-editor')
              setSelectedDocumentId(doc.id)
              window.history.pushState(
                null,
                '',
                `/workspace/${workspaceUrl}/documents/${doc.id}`
              )
            }}
            onDeleteDocument={handleDeleteDocument}
          />
        )

      case 'document-editor':
        return selectedDocumentId ? (
          <DocumentEditorPage
            documentId={selectedDocumentId}
            onNavigateToDocument={id => {
              setSelectedDocumentId(id)
              window.history.pushState(
                null,
                '',
                `/workspace/${workspaceUrl}/documents/${id}`
              )
            }}
            onNavigateToDocuments={() => {
              setCurrentPage('documents')
              window.history.pushState(
                null,
                '',
                `/workspace/${workspaceUrl}/documents`
              )
            }}
            onCreateChildDocument={parentId => {
              // Optimistic: generate temp ID, cache, and navigate instantly
              const tempId = `temp-${crypto.randomUUID()}`
              const now = new Date().toISOString()
              const optimisticDoc = {
                id: tempId,
                title: '',
                emoji: null,
                parentId,
                projectId: null,
                project: null,
                workspaceId: '',
                createdById: '',
                createdBy: { id: '', name: '', imageUrl: null },
                visibility: 'PRIVATE' as const,
                sortOrder: 0,
                createdAt: now,
                updatedAt: now,
                content: null,
                children: [],
                shares: [],
                ancestors: [],
              }
              writeCache(CACHE_KEY.documentDetail(tempId), optimisticDoc)
              setSelectedDocumentId(tempId)
              window.history.pushState(
                null,
                '',
                `/workspace/${workspaceUrl}/documents/${tempId}`
              )

              // Background sync: create on server, then replace temp ID
              fetch(API.documents.list, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ parentId }),
              })
                .then(res => (res.ok ? res.json() : null))
                .then(data => {
                  if (!data) return
                  const realId = data.document.id as string
                  // Update cache: write real doc, remove temp
                  writeCache(CACHE_KEY.documentDetail(realId), {
                    ...optimisticDoc,
                    ...data.document,
                    ancestors: data.ancestors ?? [],
                  })
                  try {
                    localStorage.removeItem(CACHE_KEY.documentDetail(tempId))
                  } catch {
                    /* ignore */
                  }
                  // Swap to real ID if user is still on the temp doc
                  setSelectedDocumentId(prev => {
                    if (prev === tempId) {
                      window.history.replaceState(
                        null,
                        '',
                        `/workspace/${workspaceUrl}/documents/${realId}`
                      )
                      return realId
                    }
                    return prev
                  })
                })
            }}
          />
        ) : null

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
            onRespondToNotification={respondToNotification}
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
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.15 }}
      className='h-screen overflow-hidden'
    >
      <SidebarProvider className='h-full font-sans'>
        <AppSidebar
          currentPage={currentPage}
          onNavigate={navigateTo}
          unreadCount={unreadCount}
        />

        <SidebarInset className='overflow-hidden flex flex-col'>
          <div className='flex-1 overflow-hidden flex flex-col relative'>
            <PageTransition pageKey={currentPage}>
              {renderPage()}
            </PageTransition>
          </div>
        </SidebarInset>

        <AnimatePresence>
          {selectedTask && (
            <>
              {(() => {
                const drawerSource: 'my-tasks' | `project-${string}` =
                  currentPage === 'my-tasks'
                    ? 'my-tasks'
                    : selectedProject
                      ? `project-${selectedProject.id}`
                      : 'my-tasks'
                return (
                  <TaskDrawer
                    initialTask={selectedTask}
                    source={drawerSource}
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
                    agentActors={agentActors}
                    projects={projects}
                    tasks={Object.values(taskMap)}
                    onUpdate={handleUpdateTask}
                    onDescriptionLoaded={(taskId, description) => {
                      descriptionCache.current.set(taskId, description)
                      writeCache(CACHE_KEY.description(taskId), {
                        desc: description,
                      })
                    }}
                    onTasksChanged={() => {
                      if (currentPage === 'my-tasks') {
                        fetchMyTasks()
                      } else if (selectedProject) {
                        fetchProjectTasks(selectedProject.id)
                      }
                    }}
                  />
                )
              })()}
            </>
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
              tasks={Object.values(taskMap) as ApiTask[]}
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
        {selectedProject && (
          <ProjectSlackDialog
            isOpen={slackDialogOpen}
            onClose={() => setSlackDialogOpen(false)}
            projectId={selectedProject.id}
            projectName={selectedProject.name}
            workspaceUrl={workspaceUrl}
          />
        )}
      </SidebarProvider>
    </motion.div>
  )
}
