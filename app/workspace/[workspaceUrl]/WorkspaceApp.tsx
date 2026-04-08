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
import { useIntl } from 'react-intl'
import {
  Page,
  ApiProject,
  ApiTask,
  ApiDraft,
  MyTask,
  ApiStatus,
  ApiPriority,
  TreeNode,
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
import { useDocumentTree } from './hooks/useDocumentTree'
import { useDrafts } from './hooks/useDrafts'

// Components
import { AppSidebar } from './components/Sidebar'
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar'
import { ProjectsPage } from './components/pages/ProjectsPage'
import { ProjectDetailPage } from './components/pages/ProjectDetailPage'
import { MyTasksPage } from './components/pages/MyTasksPage'
import { InboxPage } from './components/pages/InboxPage'
import { NewTaskModal, NewTaskFormData } from './components/modals/NewTaskModal'
import {
  QuickDispatchModal,
  QuickDispatchParsedFields,
} from './components/modals/QuickDispatchModal'
import {
  NewProjectModal,
  NewProjectFormData,
} from './components/modals/NewProjectModal'
import { TaskDrawer } from './components/TaskDrawer'
import { ProjectSlackDialog } from './components/ProjectSlackDialog'
import { DocumentsPage } from './components/pages/DocumentsPage'
import { DocumentEditorPage } from './components/pages/DocumentEditorPage'
import { DraftsPage } from './components/DraftsPage'
import { DashboardPage } from './components/pages/DashboardPage'
import { GlobalDocTree } from './components/document/GlobalDocTree'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'

// ─── URL ↔ Page mapping ──────────────────────────────────────────────────────

function pageToPath(
  workspaceUrl: string,
  page: Page,
  project?: ApiProject | null
): string {
  const base = `/workspace/${workspaceUrl}`
  switch (page) {
    case 'dashboard':
      return `${base}/dashboard`
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
    case 'drafts':
      return `${base}/drafts`
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
  if (rest.startsWith('/dashboard')) return { page: 'dashboard' }
  if (rest.startsWith('/inbox')) return { page: 'inbox' }
  if (rest.startsWith('/projects/')) {
    const projectSlug = rest.slice('/projects/'.length).split('/')[0]
    return { page: 'project-detail', projectSlug }
  }
  if (rest.startsWith('/projects')) return { page: 'projects' }
  if (rest.startsWith('/drafts')) return { page: 'drafts' }
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
  const intl = useIntl()

  // ─── Document tree ──────────────────────────────────────────────────────────
  const docTree = useDocumentTree(selectedDocumentId)

  // Tree rename/delete dialog state
  const [treeRenameDoc, setTreeRenameDoc] = useState<{
    id: string
    title: string
  } | null>(null)
  const [treeRenameValue, setTreeRenameValue] = useState('')
  const [treeDeleteDoc, setTreeDeleteDoc] = useState<{
    id: string
    title: string
  } | null>(null)

  // Navigate to a document (used by tree and other places)
  const navigateToDocument = useCallback(
    (id: string) => {
      setSelectedDocumentId(id)
      setCurrentPage('document-editor')
      docTree.expandPathTo(id)
      window.history.pushState(
        null,
        '',
        `/workspace/${workspaceUrl}/documents/${id}`
      )
    },
    [workspaceUrl, docTree]
  )

  // Create a child document via tree (optimistic)
  const handleTreeCreateChild = useCallback(
    (parentId: string | null) => {
      const tempId = `temp-${crypto.randomUUID()}`
      const node: TreeNode = {
        id: tempId,
        title: '',
        emoji: null,
        parentId,
        sortOrder: Date.now(),
        childCount: 0,
      }
      docTree.addNode(parentId, node)
      // Navigate to new doc
      setSelectedDocumentId(tempId)
      setCurrentPage('document-editor')
      window.history.pushState(
        null,
        '',
        `/workspace/${workspaceUrl}/documents/${tempId}`
      )
      // Write optimistic cache for DocumentEditorPage
      writeCache(CACHE_KEY.documentDetail(tempId), {
        id: tempId,
        title: '',
        emoji: null,
        parentId,
        content: null,
        children: [],
        shares: [],
        ancestors: [],
        visibility: 'PRIVATE',
        sortOrder: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        projectId: null,
        project: null,
        workspaceId: '',
        createdById: '',
        createdBy: { id: '', name: '', imageUrl: null },
      })
      // Background sync
      fetch(API.documents.list, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parentId }),
      })
        .then(res => (res.ok ? res.json() : null))
        .then(data => {
          if (!data) return
          const realId = data.document.id as string
          docTree.replaceNodeId(tempId, realId)
          writeCache(CACHE_KEY.documentDetail(realId), {
            ...data.document,
            ancestors: data.ancestors ?? [],
          })
          try {
            localStorage.removeItem(CACHE_KEY.documentDetail(tempId))
          } catch {
            /* */
          }
          setSelectedDocumentId(prev => {
            if (prev === tempId) return realId
            return prev
          })
          if (window.location.pathname.includes(tempId)) {
            window.history.replaceState(
              null,
              '',
              `/workspace/${workspaceUrl}/documents/${realId}`
            )
          }
        })
    },
    [workspaceUrl, docTree]
  )

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
  const [isQuickDispatchOpen, setIsQuickDispatchOpen] = useState(false)
  const [isNewProjectModalOpen, setIsNewProjectModalOpen] = useState(false)
  const [newTaskDefaultAssigneeId, setNewTaskDefaultAssigneeId] = useState<
    string | undefined
  >(undefined)
  const [newTaskDefaultStatus, setNewTaskDefaultStatus] = useState<
    ApiStatus | undefined
  >(undefined)
  const [newTaskPreFill, setNewTaskPreFill] = useState<
    QuickDispatchParsedFields | undefined
  >(undefined)

  // ─── Drafts ────────────────────────────────────────────────────────────────
  const { drafts, draftCount, fetchDrafts, saveDraft, deleteDraft } =
    useDrafts()

  const [restoringDraftId, setRestoringDraftId] = useState<string | undefined>()
  const [projectDraftPreFill, setProjectDraftPreFill] = useState<
    { name: string; description: string } | undefined
  >()
  const [projectDraftId, setProjectDraftId] = useState<string | undefined>()

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
      setNewTaskPreFill(undefined)
      setIsQuickDispatchOpen(true)
    },
    [fetchMembers, fetchProjects]
  )

  const handleQuickDispatchEdit = useCallback(
    (fields: QuickDispatchParsedFields) => {
      setNewTaskPreFill(fields)
      setNewTaskDefaultAssigneeId(fields.assigneeId || undefined)
      setNewTaskDefaultStatus(fields.status)
      setIsNewTaskModalOpen(true)
    },
    []
  )

  // ─── Draft handlers ─────────────────────────────────────────────────────
  // Fetch drafts on mount for sidebar badge
  useEffect(() => {
    fetchDrafts()
  }, [fetchDrafts])

  const handleRestoreTaskDraft = useCallback((draft: ApiDraft) => {
    const data = draft.data as Record<string, unknown>
    setNewTaskPreFill({
      title: (data.title as string) ?? '',
      description: (data.description as string) ?? '',
      status: (data.status as ApiStatus) ?? 'TODO',
      priority: (data.priority as ApiPriority) ?? 'MEDIUM',
      projectId: (data.projectId as string) ?? '',
      assigneeId: (data.assigneeId as string) ?? '',
      dueDate: (data.dueDate as string) ?? null,
    })
    setRestoringDraftId(draft.id)
    setNewTaskDefaultAssigneeId((data.assigneeId as string) ?? undefined)
    setNewTaskDefaultStatus((data.status as ApiStatus) ?? undefined)
    setIsNewTaskModalOpen(true)
  }, [])

  const handleRestoreProjectDraft = useCallback((draft: ApiDraft) => {
    const data = draft.data as Record<string, unknown>
    setProjectDraftPreFill({
      name: (data.name as string) ?? '',
      description: (data.description as string) ?? '',
    })
    setProjectDraftId(draft.id)
    setIsNewProjectModalOpen(true)
  }, [])

  const handleSaveDraft = useCallback(
    async (type: 'TASK' | 'PROJECT', data: Record<string, unknown>) => {
      await saveDraft(type, data)
    },
    [saveDraft]
  )

  const handleDeleteDraft = useCallback(
    async (id: string) => {
      await deleteDraft(id)
    },
    [deleteDraft]
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
    if (currentPage === 'document-editor') fetchMembers()
  }, [currentPage, fetchMyTasks, fetchProjects, fetchDocuments, fetchMembers])

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
      if (page === 'drafts') fetchDrafts()
      const path = pageToPath(workspaceUrl, page, project)
      window.history.pushState(null, '', path)
    },
    [workspaceUrl, fetchDrafts]
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

  // ─── Global keyboard shortcut: Cmd+K → Quick Dispatch ──────────────────────
  useEffect(() => {
    function handleGlobalKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        openNewTaskModal()
      }
    }
    window.addEventListener('keydown', handleGlobalKeyDown)
    return () => window.removeEventListener('keydown', handleGlobalKeyDown)
  }, [openNewTaskModal])

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
        toast.error(
          err.error ?? intl.formatMessage({ id: 'task.projectCreateFailed' })
        )
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
      toast.success(intl.formatMessage({ id: 'task.projectCreateSuccess' }), {
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
      aiSuggestedPriority,
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
        toast.error(
          err.error ?? intl.formatMessage({ id: 'task.createFailed' })
        )
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
      toast.success(intl.formatMessage({ id: 'task.createSuccess' }), {
        description: `${task.teamIdentifier}-${task.number} - ${task.title}`,
      })

      // Record AI priority override if user changed the suggestion
      if (aiSuggestedPriority && aiSuggestedPriority !== priority) {
        apiFetch('/api/tasks/priority-override', {
          method: 'POST',
          body: {
            taskId: task.id,
            projectId,
            aiSuggested: aiSuggestedPriority,
            userChosen: priority,
            taskTitle: title,
            taskDescription: description || undefined,
          },
        }).catch(() => {
          // Silent failure — override recording is non-critical
        })
      }
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
      case 'dashboard':
        return (
          <DashboardPage
            onNavigateToProject={projectId => {
              const project = projects.find(p => p.id === projectId)
              if (project) {
                navigateTo('project-detail', project)
              }
            }}
          />
        )

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
          <div className='flex-1 flex overflow-hidden'>
            <GlobalDocTree
              roots={docTree.roots}
              expandedIds={docTree.expandedIds}
              currentDocId={null}
              onNavigate={navigateToDocument}
              onExpandNode={docTree.expandNode}
              onAddChild={handleTreeCreateChild}
              onRenameDoc={doc => {
                setTreeRenameValue(doc.title)
                setTreeRenameDoc(doc)
              }}
              onDeleteDoc={doc => setTreeDeleteDoc(doc)}
              onMoveNode={docTree.moveNode}
            />
            <DocumentsPage
              documents={documents}
              loading={documentsLoading}
              error={documentsError}
              onRetry={fetchDocuments}
              onNewDocument={handleNewDocument}
              onSelectDocument={doc => navigateToDocument(doc.id)}
              onDeleteDocument={handleDeleteDocument}
            />
          </div>
        )

      case 'document-editor':
        return (
          <div className='flex-1 flex overflow-hidden'>
            <GlobalDocTree
              roots={docTree.roots}
              expandedIds={docTree.expandedIds}
              currentDocId={selectedDocumentId}
              onNavigate={navigateToDocument}
              onExpandNode={docTree.expandNode}
              onAddChild={handleTreeCreateChild}
              onRenameDoc={doc => {
                setTreeRenameValue(doc.title)
                setTreeRenameDoc(doc)
              }}
              onDeleteDoc={doc => setTreeDeleteDoc(doc)}
              onMoveNode={docTree.moveNode}
            />
            {selectedDocumentId ? (
              <DocumentEditorPage
                documentId={selectedDocumentId}
                onNavigateToDocument={navigateToDocument}
                members={members}
                currentMemberId={currentMemberId}
                onNavigateToDocuments={() => {
                  setCurrentPage('documents')
                  window.history.pushState(
                    null,
                    '',
                    `/workspace/${workspaceUrl}/documents`
                  )
                }}
                onTitleChanged={(id, title) => docTree.renameNode(id, title)}
                onEmojiChanged={(id, emoji) =>
                  docTree.updateNodeEmoji(id, emoji)
                }
              />
            ) : null}
          </div>
        )

      case 'drafts':
        return (
          <DraftsPage
            drafts={drafts}
            ideaProjects={projects.filter(p => p.isIdea)}
            onRestoreTaskDraft={handleRestoreTaskDraft}
            onRestoreProjectDraft={handleRestoreProjectDraft}
            onOpenIdeaProject={project => {
              setSelectedProject(project)
              navigateTo('project-detail', project)
            }}
            onDeleteDraft={handleDeleteDraft}
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
          draftCount={draftCount}
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
                setNewTaskPreFill(undefined)
                setRestoringDraftId(undefined)
              }}
              projects={projects}
              members={members}
              defaultProjectId={
                newTaskPreFill?.projectId || selectedProject?.id
              }
              defaultAssigneeId={newTaskDefaultAssigneeId}
              defaultStatus={newTaskDefaultStatus}
              preFill={newTaskPreFill}
              onSubmit={handleCreateTask}
              tasks={Object.values(taskMap) as ApiTask[]}
              draftId={restoringDraftId}
              onSaveDraft={handleSaveDraft}
              onDeleteDraft={handleDeleteDraft}
            />
          )}
          {isQuickDispatchOpen && (
            <QuickDispatchModal
              isOpen={isQuickDispatchOpen}
              onClose={() => setIsQuickDispatchOpen(false)}
              members={members}
              onSubmit={handleCreateTask}
              onEdit={handleQuickDispatchEdit}
              onSaveDraft={handleSaveDraft}
            />
          )}
          {isNewProjectModalOpen && (
            <NewProjectModal
              isOpen={isNewProjectModalOpen}
              onClose={() => {
                setIsNewProjectModalOpen(false)
                setProjectDraftPreFill(undefined)
                setProjectDraftId(undefined)
              }}
              onSubmit={handleCreateProject}
              preFill={projectDraftPreFill}
              draftId={projectDraftId}
              onSaveDraft={handleSaveDraft}
              onDeleteDraft={handleDeleteDraft}
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

        {/* Tree Rename Dialog */}
        <Dialog
          open={treeRenameDoc !== null}
          onOpenChange={open => {
            if (!open) setTreeRenameDoc(null)
          }}
        >
          <DialogContent className='sm:max-w-md'>
            <DialogHeader>
              <DialogTitle>
                {intl.formatMessage({
                  id: 'documentToc.rename',
                  defaultMessage: 'Rename',
                })}
              </DialogTitle>
            </DialogHeader>
            <form
              onSubmit={e => {
                e.preventDefault()
                if (!treeRenameDoc || treeRenameValue === treeRenameDoc.title) {
                  setTreeRenameDoc(null)
                  return
                }
                const renamedId = treeRenameDoc.id
                docTree.renameNode(renamedId, treeRenameValue)
                fetch(API.documents.byId(renamedId), {
                  method: 'PATCH',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ title: treeRenameValue }),
                })
                setTreeRenameDoc(null)
              }}
            >
              <Input
                value={treeRenameValue}
                onChange={e => setTreeRenameValue(e.target.value)}
                autoFocus
                placeholder={intl.formatMessage({
                  id: 'documents.untitled',
                  defaultMessage: 'Untitled',
                })}
              />
              <DialogFooter className='mt-4'>
                <Button
                  type='button'
                  variant='outline'
                  onClick={() => setTreeRenameDoc(null)}
                >
                  {intl.formatMessage({
                    id: 'common.cancel',
                    defaultMessage: 'Cancel',
                  })}
                </Button>
                <Button type='submit'>
                  {intl.formatMessage({
                    id: 'common.save',
                    defaultMessage: 'Save',
                  })}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>

        {/* Tree Delete Confirm Dialog */}
        <AlertDialog
          open={treeDeleteDoc !== null}
          onOpenChange={open => {
            if (!open) setTreeDeleteDoc(null)
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {intl.formatMessage({
                  id: 'documentToc.deleteConfirmTitle',
                  defaultMessage: 'Delete document',
                })}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {intl.formatMessage(
                  {
                    id: 'documentToc.deleteConfirmDesc',
                    defaultMessage:
                      'Are you sure you want to delete "{title}"? This action cannot be undone.',
                  },
                  { title: treeDeleteDoc?.title || 'Untitled' }
                )}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>
                {intl.formatMessage({
                  id: 'common.cancel',
                  defaultMessage: 'Cancel',
                })}
              </AlertDialogCancel>
              <AlertDialogAction
                className='bg-destructive text-destructive-foreground hover:bg-destructive/90'
                onClick={() => {
                  if (!treeDeleteDoc) return
                  const deletedId = treeDeleteDoc.id
                  setTreeDeleteDoc(null)
                  docTree.removeNode(deletedId)
                  if (selectedDocumentId === deletedId) {
                    setCurrentPage('documents')
                    window.history.pushState(
                      null,
                      '',
                      `/workspace/${workspaceUrl}/documents`
                    )
                  }
                  fetch(API.documents.byId(deletedId), { method: 'DELETE' })
                }}
              >
                {intl.formatMessage({
                  id: 'documentToc.delete',
                  defaultMessage: 'Delete',
                })}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </SidebarProvider>
    </motion.div>
  )
}
