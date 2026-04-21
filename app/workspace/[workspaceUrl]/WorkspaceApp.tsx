'use client'

import {
  useState,
  useEffect,
  useCallback,
  useMemo,
  Dispatch,
  SetStateAction,
} from 'react'
import { useParams, usePathname } from 'next/navigation'
import { motion } from 'motion/react'
import { PageTransition } from '@/components/PageTransition'
import { useCurrentUser } from './hooks/useCurrentUser'
import {
  Page,
  ApiProject,
  ApiTask,
  ApiDraft,
  MyTask,
  ApiStatus,
  ApiPriority,
  TaskPreFillFields,
} from './types'
import { pageToPath as pageToPathUtil } from './utils'
import { slugify } from '@/lib/utils/slugify'
import { clearCache } from './cache'

// Hooks
import { useTaskStore } from './hooks/useTaskStore'
import { useMyTasks } from './hooks/useMyTasks'
import { useMyActiveSprints } from './hooks/useMyActiveSprints'
import { useWorkspaceTeams } from './hooks/useWorkspaceTeams'
import { useProjects } from './hooks/useProjects'
import { useProjectTasks } from './hooks/useProjectTasks'
import { useMembers } from './hooks/useMembers'
import { useRealtimeNotifications } from './hooks/useRealtimeNotifications'
import { usePusherEvent } from './hooks/usePusher'
import { useDocuments } from './hooks/useDocuments'
import { useDocumentTree } from './hooks/useDocumentTree'
import { useDrafts } from './hooks/useDrafts'
import { useWorkspaceTaskHandlers } from './hooks/useWorkspaceTaskHandlers'
import { useWorkspaceProjectHandlers } from './hooks/useWorkspaceProjectHandlers'
import { useWorkspaceDocumentHandlers } from './hooks/useWorkspaceDocumentHandlers'
import { useDocTreeCollapsed } from './hooks/useDocTreeCollapsed'

// Components
import { AppSidebar } from './components/Sidebar'
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar'
import { ProjectsPage } from './components/pages/ProjectsPage'
import { ProjectDetailPage } from './components/pages/ProjectDetailPage'
import { MyTasksPage } from './components/pages/MyTasksPage'
import { InboxPage } from './components/pages/InboxPage'
import { DocumentsPage } from './components/pages/DocumentsPage'
import { DocumentEditorPage } from './components/pages/DocumentEditorPage'
import { DraftsPage } from './components/DraftsPage'
import { DashboardPage } from './components/pages/DashboardPage'
import { SprintsLandingClient } from './sprints/components/SprintsLandingClient'
import { SprintDetailClient } from './sprints/[sprintId]/SprintDetailClient'
import {
  GlobalDocTree,
  CollapsedDocTreeRail,
} from './components/document/GlobalDocTree'
import { WorkspaceModals } from './components/WorkspaceModals'

// ─── URL ↔ Page mapping ──────────────────────────────────────────────────────

// Re-export from utils for backward compat within this file
const pageToPath = pageToPathUtil

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
  if (rest.startsWith('/sprints/')) {
    const sprintId = rest.slice('/sprints/'.length).split('/')[0]
    return { page: 'sprint-detail', projectSlug: sprintId }
  }
  if (rest.startsWith('/sprints')) return { page: 'sprints' }
  return { page: 'my-tasks' }
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function DashboardApp() {
  const { workspaceUrl } = useParams<{ workspaceUrl: string }>()
  const pathname = usePathname()

  // ─── Navigation ────────────────────────────────────────────────────────────
  const [currentPage, setCurrentPage] = useState<Page>(() => {
    if (typeof window === 'undefined') return 'my-tasks'
    return pathToPage(window.location.pathname, workspaceUrl).page
  })
  const [selectedProject, setSelectedProject] = useState<ApiProject | null>(
    null
  )

  // Sync currentPage when Next.js route changes (component reused across routes)
  useEffect(() => {
    const { page } = pathToPage(pathname, workspaceUrl)
    setCurrentPage(page)
  }, [pathname, workspaceUrl])
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

  // ─── My Tasks sprint filter ────────────────────────────────────────────────
  // The toggle state itself lives inside MyTasksPage (persisted via
  // useDisplayOptions). We only surface the workspace-level inputs needed
  // to do the client-side filter.
  const { sprintIds: activeSprintIds } = useMyActiveSprints()
  const { teams: myTeams } = useWorkspaceTeams()
  const anySprintEnabledTeam = myTeams.some(t => t.sprintsEnabled)

  // ─── Normalized task store ─────────────────────────────────────────────────
  const {
    taskMap,
    upsertTasks,
    updateTask,
    removeTask,
    removeTasks,
    replaceTempId,
  } = useTaskStore()

  // ─── Data hooks ────────────────────────────────────────────────────────────
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

  // ─── Document tree ──────────────────────────────────────────────────────────
  const docTree = useDocumentTree(selectedDocumentId)
  const { collapsed: docTreeCollapsed, toggle: toggleDocTreeCollapsed } =
    useDocTreeCollapsed()

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

  // Current user's workspace member info
  const currentMember = useMemo(
    () => members.find(m => m.clerkId === user?.id),
    [members, user?.id]
  )
  const currentMemberId = currentMember?.id
  const currentActorId = currentMember?.actorId ?? null
  const isOwner = currentMember?.role === 'OWNER'

  // ─── Task drawer ───────────────────────────────────────────────────────────
  const [selectedTask, setSelectedTask] = useState<ApiTask | MyTask | null>(
    null
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
    TaskPreFillFields | undefined
  >(undefined)

  // ─── Drafts ────────────────────────────────────────────────────────────────
  const { drafts, draftCount, fetchDrafts, saveDraft, deleteDraft } =
    useDrafts()

  const [restoringDraftId, setRestoringDraftId] = useState<string | undefined>()
  const [projectDraftPreFill, setProjectDraftPreFill] = useState<
    { name: string; description: string } | undefined
  >()
  const [projectDraftId, setProjectDraftId] = useState<string | undefined>()

  // ─── Extracted handler hooks ───────────────────────────────────────────────
  const taskHandlers = useWorkspaceTaskHandlers({
    taskMap,
    upsertTasks,
    updateTask,
    removeTask,
    removeTasks,
    replaceTempId,
    myTaskIds,
    setMyTaskIds,
    projectTaskIds,
    setProjectTaskIds,
    members,
    currentMemberId,
    fetchMembers,
    projects,
    setProjects,
    selectedProject,
    fetchProjects,
  })

  // ─── Navigation ────────────────────────────────────────────────────────────
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

  const projectHandlers = useWorkspaceProjectHandlers({
    setProjects,
    setSelectedProject,
    navigateTo,
    onDeleteProjectTasks: taskHandlers.handleDeleteProjectTasks,
    setSelectedTask: setSelectedTask as Dispatch<SetStateAction<unknown>>,
    fetchProjects,
  })

  const documentHandlers = useWorkspaceDocumentHandlers({
    workspaceUrl,
    setDocuments,
    setCurrentPage: setCurrentPage as Dispatch<SetStateAction<string>>,
    setSelectedDocumentId,
    docTree,
    currentUser: user,
  })

  // ─── Derived task arrays ──────────────────────────────────────────────────
  const myTasks = useMemo(
    () => myTaskIds.map(id => taskMap[id]).filter(Boolean) as MyTask[],
    [myTaskIds, taskMap]
  )

  const projectTasks = useMemo(
    () => projectTaskIds.map(id => taskMap[id]).filter(Boolean) as ApiTask[],
    [projectTaskIds, taskMap]
  )

  // ─── Real-time board updates ──────────────────────────────────────────────
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

  // ─── Task drawer handlers ────────────────────────────────────────────────
  const handleOpenTask = useCallback(
    (task: ApiTask | MyTask) => {
      taskHandlers.handleOpenTask(task)
      setSelectedTask(task)
    },
    [taskHandlers]
  )

  const handleCloseTask = useCallback(() => setSelectedTask(null), [])

  // ─── Modal openers ────────────────────────────────────────────────────────
  const openNewTaskModal = useCallback(
    (assigneeId?: string, status?: ApiStatus) => {
      taskHandlers.openNewTaskModal(assigneeId, status)
      setNewTaskDefaultAssigneeId(
        typeof assigneeId === 'string' ? assigneeId : undefined
      )
      setNewTaskDefaultStatus(status)
      setNewTaskPreFill(undefined)
      setIsNewTaskModalOpen(true)
    },
    [taskHandlers]
  )

  const openNewTaskModalForMe = useCallback(
    (status?: ApiStatus) => {
      openNewTaskModal(currentMemberId, status)
    },
    [openNewTaskModal, currentMemberId]
  )

  // ─── Draft handlers ─────────────────────────────────────────────────────
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

  // ─── Clear stale cache ────────────────────────────────────────────────────
  useEffect(() => {
    if (!user?.id || !workspaceUrl) return
    const context = `${user.id}:${workspaceUrl}`
    const prev = localStorage.getItem('lumo:context')
    if (prev && prev !== context) {
      clearCache()
    }
    localStorage.setItem('lumo:context', context)
  }, [user?.id, workspaceUrl])

  // ─── Page-change side effects ──────────────────────────────────────────────
  useEffect(() => {
    if (currentPage === 'my-tasks') {
      fetchMyTasks()
      fetchProjects()
    }
    if (currentPage === 'projects' || currentPage === 'project-detail')
      fetchProjects()
    if (currentPage === 'documents') {
      fetchDocuments()
      // Keep the sidebar tree in sync with the home page list. Without this,
      // the tree only refreshes on mount + window focus, so it can lag behind
      // the home page (which re-fetches on every navigation).
      docTree.refresh()
    }
    if (currentPage === 'document-editor') fetchMembers()
  }, [
    currentPage,
    fetchMyTasks,
    fetchProjects,
    fetchDocuments,
    fetchMembers,
    docTree.refresh,
  ])

  useEffect(() => {
    if (currentPage === 'project-detail' && selectedProject) {
      hydrateForProject(selectedProject.id)
      if (!selectedProject.id.startsWith('optimistic-')) {
        fetchProjectTasks(selectedProject.id)
      }
    }
  }, [currentPage, selectedProject?.id, hydrateForProject, fetchProjectTasks])

  // ─── URL sync ──────────────────────────────────────────────────────────────
  useEffect(() => {
    const onPopState = () => {
      const { page, projectSlug } = pathToPage(
        window.location.pathname,
        workspaceUrl
      )
      setCurrentPage(page)
      if (page === 'project-detail' && projectSlug) {
        const match = projects.find(p => slugify(p.name) === projectSlug)
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

  useEffect(() => {
    const base = `/workspace/${workspaceUrl}`
    if (
      window.location.pathname === base ||
      window.location.pathname === `${base}/`
    ) {
      window.history.replaceState(null, '', `${base}/my-tasks`)
    }
  }, [workspaceUrl])

  useEffect(() => {
    if (
      pendingProjectSlug &&
      currentPage === 'project-detail' &&
      !selectedProject &&
      projects.length > 0
    ) {
      const match = projects.find(p => slugify(p.name) === pendingProjectSlug)
      if (match) setSelectedProject(match)
    }
  }, [pendingProjectSlug, currentPage, selectedProject, projects])

  // ─── Global keyboard shortcut: Cmd+K → Quick Dispatch ──────────────────────
  useEffect(() => {
    function handleGlobalKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setIsQuickDispatchOpen(true)
      }
    }
    window.addEventListener('keydown', handleGlobalKeyDown)
    return () => window.removeEventListener('keydown', handleGlobalKeyDown)
  }, [])

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
            setTasks={taskHandlers.setMyTasksForDnD}
            viewId={myTasksViewId}
            userId={user?.id ?? ''}
            loading={myTasksLoading}
            error={myTasksError}
            onRetry={fetchMyTasks}
            onTaskClick={handleOpenTask}
            onNewTask={openNewTaskModalForMe}
            members={members}
            projects={projects}
            sprintsAvailable={anySprintEnabledTeam}
            activeSprintIds={activeSprintIds}
          />
        )

      case 'projects':
        return (
          <ProjectsPage
            projects={projects}
            loading={projectsLoading}
            error={projectsError}
            onRetry={fetchProjects}
            onSelectProject={projectHandlers.handleSelectProject}
            onNewProject={() => setIsNewProjectModalOpen(true)}
            onBulkDelete={projectHandlers.handleBulkDeleteProjects}
          />
        )

      case 'project-detail':
        if (!selectedProject) return null
        return (
          <ProjectDetailPage
            project={selectedProject}
            tasks={projectTasks}
            setTasks={taskHandlers.setProjectTasksForDnD}
            viewId={kanbanViewId}
            loading={projectTasksLoading}
            error={projectTasksError}
            onRetry={() => fetchProjectTasks(selectedProject.id)}
            onBack={projectHandlers.handleBack}
            onNewTask={status => openNewTaskModal(undefined, status)}
            onTaskClick={handleOpenTask}
            onDeleteTask={taskHandlers.handleDeleteTask}
            onTaskStatusChanged={taskHandlers.handleProjectTaskStatusChanged}
            onUpdateProject={projectHandlers.handleUpdateProject}
            onDeleteProject={projectHandlers.handleDeleteProject}
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
            {docTreeCollapsed ? (
              <CollapsedDocTreeRail onExpand={toggleDocTreeCollapsed} />
            ) : (
              <GlobalDocTree
                roots={docTree.roots}
                expandedIds={docTree.expandedIds}
                currentDocId={null}
                onNavigate={documentHandlers.navigateToDocument}
                onExpandNode={docTree.expandNode}
                onAddChild={documentHandlers.handleTreeCreateChild}
                onRenameDoc={doc => {
                  setTreeRenameValue(doc.title)
                  setTreeRenameDoc(doc)
                }}
                onDeleteDoc={doc => setTreeDeleteDoc(doc)}
                onMoveNode={docTree.moveNode}
                onCollapse={toggleDocTreeCollapsed}
                onNavigateHome={documentHandlers.navigateToDocuments}
              />
            )}
            <DocumentsPage
              documents={documents}
              loading={documentsLoading}
              error={documentsError}
              onRetry={fetchDocuments}
              onNewDocument={documentHandlers.handleNewDocument}
              onSelectDocument={doc =>
                documentHandlers.navigateToDocument(doc.id)
              }
              onDeleteDocument={documentHandlers.handleDeleteDocument}
            />
          </div>
        )

      case 'document-editor':
        return (
          <div className='flex-1 flex overflow-hidden'>
            {docTreeCollapsed ? (
              <CollapsedDocTreeRail onExpand={toggleDocTreeCollapsed} />
            ) : (
              <GlobalDocTree
                roots={docTree.roots}
                expandedIds={docTree.expandedIds}
                currentDocId={selectedDocumentId}
                onNavigate={documentHandlers.navigateToDocument}
                onExpandNode={docTree.expandNode}
                onAddChild={documentHandlers.handleTreeCreateChild}
                onRenameDoc={doc => {
                  setTreeRenameValue(doc.title)
                  setTreeRenameDoc(doc)
                }}
                onDeleteDoc={doc => setTreeDeleteDoc(doc)}
                onMoveNode={docTree.moveNode}
                onCollapse={toggleDocTreeCollapsed}
                onNavigateHome={documentHandlers.navigateToDocuments}
              />
            )}
            {selectedDocumentId ? (
              <DocumentEditorPage
                documentId={selectedDocumentId}
                onNavigateToDocument={documentHandlers.navigateToDocument}
                members={members}
                currentMemberId={currentMemberId}
                onNavigateToDocuments={documentHandlers.navigateToDocuments}
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

      case 'sprints':
        return <SprintsLandingClient />

      case 'sprint-detail':
        return <SprintDetailClient />

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
              await taskHandlers.handleUpdateTask(taskId, { status })
            }}
            members={members}
            projects={projects}
            taskMap={taskMap}
            upsertTasks={upsertTasks}
            onUpdate={taskHandlers.handleUpdateTask}
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
          onOpenAskLumo={() => setIsQuickDispatchOpen(true)}
        />

        <SidebarInset className='overflow-hidden flex flex-col'>
          <div className='flex-1 overflow-hidden flex flex-col relative'>
            <PageTransition pageKey={currentPage}>
              {renderPage()}
            </PageTransition>
          </div>
        </SidebarInset>

        <WorkspaceModals
          selectedTask={selectedTask}
          taskMap={taskMap}
          descriptionCache={taskHandlers.descriptionCache}
          members={members}
          agentActors={agentActors}
          projects={projects}
          currentPage={currentPage}
          selectedProject={selectedProject}
          onCloseTask={handleCloseTask}
          onUpdateTask={taskHandlers.handleUpdateTask}
          onTasksChanged={() => {
            if (currentPage === 'my-tasks') {
              fetchMyTasks()
            } else if (selectedProject) {
              fetchProjectTasks(selectedProject.id)
            }
          }}
          isNewTaskModalOpen={isNewTaskModalOpen}
          setIsNewTaskModalOpen={setIsNewTaskModalOpen}
          newTaskDefaultAssigneeId={newTaskDefaultAssigneeId}
          setNewTaskDefaultAssigneeId={setNewTaskDefaultAssigneeId}
          newTaskDefaultStatus={newTaskDefaultStatus}
          setNewTaskDefaultStatus={setNewTaskDefaultStatus}
          newTaskPreFill={newTaskPreFill}
          setNewTaskPreFill={setNewTaskPreFill}
          onCreateTask={taskHandlers.handleCreateTask}
          restoringDraftId={restoringDraftId}
          setRestoringDraftId={setRestoringDraftId}
          isQuickDispatchOpen={isQuickDispatchOpen}
          setIsQuickDispatchOpen={setIsQuickDispatchOpen}
          myTasks={myTasks}
          isNewProjectModalOpen={isNewProjectModalOpen}
          setIsNewProjectModalOpen={setIsNewProjectModalOpen}
          onCreateProject={projectHandlers.handleCreateProject}
          projectDraftPreFill={projectDraftPreFill}
          setProjectDraftPreFill={setProjectDraftPreFill}
          projectDraftId={projectDraftId}
          setProjectDraftId={setProjectDraftId}
          onSaveDraft={handleSaveDraft}
          onDeleteDraft={handleDeleteDraft}
          slackDialogOpen={slackDialogOpen}
          setSlackDialogOpen={setSlackDialogOpen}
          workspaceUrl={workspaceUrl}
          treeRenameDoc={treeRenameDoc}
          setTreeRenameDoc={setTreeRenameDoc}
          treeRenameValue={treeRenameValue}
          setTreeRenameValue={setTreeRenameValue}
          treeDeleteDoc={treeDeleteDoc}
          setTreeDeleteDoc={setTreeDeleteDoc}
          docTree={docTree}
          selectedDocumentId={selectedDocumentId}
          setCurrentPage={setCurrentPage as Dispatch<SetStateAction<string>>}
          onDeleteDocument={documentHandlers.handleDeleteDocument}
        />
      </SidebarProvider>
    </motion.div>
  )
}
