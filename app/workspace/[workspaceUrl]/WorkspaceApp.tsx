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
import { useQueryClient } from '@tanstack/react-query'
import { motion } from 'motion/react'
import { PageTransition } from '@/components/PageTransition'
import { useCurrentUser } from './hooks/useCurrentUser'
import { Page, ApiProject, TaskDetail } from './types'
import { pageToPath, pathToPage } from './utils'
import { clearCache } from './cache'
import { queryKeys } from '@/lib/query/keys'

// Hooks
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
import { useWorkspaceUrlSync } from './hooks/useWorkspaceUrlSync'
import { useWorkspaceModalState } from './hooks/useWorkspaceModalState'

// Components
import { AppSidebar } from './components/Sidebar'
import { WorkspaceDeletionBanner } from './components/WorkspaceDeletionBanner'
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar'
import { WorkspaceModals } from './components/WorkspaceModals'
import { WorkspacePageRouter } from './components/WorkspacePageRouter'

export default function WorkspaceApp() {
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

  // ─── My Tasks sprint filter ────────────────────────────────────────────────
  // The toggle state itself lives inside MyTasksPage (persisted via
  // useDisplayOptions). We only surface the workspace-level inputs needed
  // to do the client-side filter.
  const { sprintIds: activeSprintIds } = useMyActiveSprints()
  const { teams: myTeams } = useWorkspaceTeams()
  const anySprintEnabledTeam = myTeams.some(t => t.sprintsEnabled)

  // ─── Data hooks ────────────────────────────────────────────────────────────
  const queryClient = useQueryClient()
  const {
    tasks: myTasks,
    setTasks: setMyTasks,
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

  const { members, agentActors } = useMembers()
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

  // Current user's workspace member info
  const currentMember = useMemo(
    () => members.find(m => m.clerkId === user?.id),
    [members, user?.id]
  )
  const currentMemberId = currentMember?.id
  const currentActorId = currentMember?.actorId ?? null
  const isOwner = currentMember?.role === 'OWNER'

  // ─── Drafts ────────────────────────────────────────────────────────────────
  const { drafts, draftCount, fetchDrafts, saveDraft, deleteDraft } =
    useDrafts()

  // ─── Extracted handler hooks ───────────────────────────────────────────────
  const taskHandlers = useWorkspaceTaskHandlers({
    myTasks,
    setMyTasks,
    projectTasks,
    setProjectTasks,
    members,
    currentMemberId,
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
    setSelectedTask: (() => {}) as Dispatch<SetStateAction<unknown>>,
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

  // ─── Modal state (drawer, new-task, new-project, dialogs, drafts) ─────────
  const modalState = useWorkspaceModalState({
    onOpenTaskSideEffect: taskHandlers.handleOpenTask,
    onOpenNewTaskModal: taskHandlers.openNewTaskModal,
    currentActorId,
    saveDraft,
    deleteDraft,
  })

  // Re-wire `projectHandlers` to clear the task drawer when it deletes a
  // project (the setter lives inside `modalState`, but the handler hook is
  // built before `modalState` so we couldn't pass it in directly above).
  // Mutating the field after construction is intentional and matches the
  // pre-refactor behaviour.
  ;(
    projectHandlers as unknown as {
      setSelectedTask: (v: unknown) => void
    }
  ).setSelectedTask = modalState.setSelectedTask as unknown as (
    v: unknown
  ) => void

  // ─── Real-time board updates ──────────────────────────────────────────────
  // Pusher patches flow directly into the TanStack per-task cache + list
  // caches; list views derive from query data, no separate normalized store.
  usePusherEvent<{
    taskId: string
    fields: string[]
    patch?: Record<string, unknown>
  }>(
    selectedProject ? `project-${selectedProject.id}` : null,
    'project-update',
    useCallback(
      event => {
        if (!event.patch) return
        const patch = event.patch as Record<string, unknown>
        queryClient.setQueryData<TaskDetail>(
          queryKeys.tasks.detail(event.taskId),
          prev => (prev ? ({ ...prev, ...patch } as TaskDetail) : prev)
        )
        setMyTasks(prev =>
          prev.map(t =>
            t.id === event.taskId
              ? ({ ...t, ...patch } as (typeof prev)[number])
              : t
          )
        )
        setProjectTasks(prev =>
          prev.map(t =>
            t.id === event.taskId
              ? ({ ...t, ...patch } as (typeof prev)[number])
              : t
          )
        )
      },
      [queryClient, setMyTasks, setProjectTasks]
    )
  )

  // ─── URL ↔ in-memory state sync ───────────────────────────────────────────
  useWorkspaceUrlSync({
    workspaceUrl,
    pathname,
    projects,
    selectedProject,
    setCurrentPage,
    setSelectedProject,
    setSelectedDocumentId,
  })

  // ─── Initial draft fetch ──────────────────────────────────────────────────
  useEffect(() => {
    fetchDrafts()
  }, [fetchDrafts])

  // ─── Clear stale cache when user/workspace context changes ────────────────
  useEffect(() => {
    if (!user?.id || !workspaceUrl) return
    const context = `${user.id}:${workspaceUrl}`
    const prev = localStorage.getItem('lumo:context')
    if (prev && prev !== context) {
      clearCache()
    }
    localStorage.setItem('lumo:context', context)
  }, [user?.id, workspaceUrl])

  // ─── Members ────────────────────────────────────────────────────────────────
  // Members are shared workspace data consumed by nearly every page (my-tasks
  // assignee column, project task tables, task detail panels, modals). The
  // useMembers query is now a shared workspace-global cache (enabled, staleTime
  // 5min): mounting useMembers above auto-fetches once and every other consumer
  // reads that cache, so no page needs to fetch members itself.

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
  }, [
    currentPage,
    fetchMyTasks,
    fetchProjects,
    fetchDocuments,
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

  // ─── Global keyboard shortcut: Cmd+K → Quick Dispatch ──────────────────────
  useEffect(() => {
    function handleGlobalKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        modalState.setIsQuickDispatchOpen(true)
      }
    }
    window.addEventListener('keydown', handleGlobalKeyDown)
    return () => window.removeEventListener('keydown', handleGlobalKeyDown)
  }, [modalState.setIsQuickDispatchOpen])

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
          onOpenAskLumo={() => modalState.setIsQuickDispatchOpen(true)}
          onNewProject={() => modalState.setIsNewProjectModalOpen(true)}
        />

        <SidebarInset className='overflow-hidden flex flex-col'>
          <WorkspaceDeletionBanner />
          <div className='flex-1 overflow-hidden flex flex-col relative'>
            <PageTransition pageKey={currentPage}>
              <WorkspacePageRouter
                currentPage={currentPage}
                workspaceUrl={workspaceUrl}
                userId={user?.id ?? ''}
                currentActorId={currentActorId}
                currentMemberId={currentMemberId}
                isOwner={isOwner}
                members={members}
                myTasks={myTasks}
                myTasksViewId={myTasksViewId}
                myTasksLoading={myTasksLoading}
                myTasksError={myTasksError}
                fetchMyTasks={fetchMyTasks}
                anySprintEnabledTeam={anySprintEnabledTeam}
                activeSprintIds={activeSprintIds}
                projects={projects}
                projectsLoading={projectsLoading}
                projectsError={projectsError}
                fetchProjects={fetchProjects}
                selectedProject={selectedProject}
                setSelectedProject={setSelectedProject}
                projectTasks={projectTasks}
                kanbanViewId={kanbanViewId}
                projectTasksLoading={projectTasksLoading}
                projectTasksError={projectTasksError}
                fetchProjectTasks={fetchProjectTasks}
                documents={documents}
                documentsLoading={documentsLoading}
                documentsError={documentsError}
                fetchDocuments={fetchDocuments}
                selectedDocumentId={selectedDocumentId}
                docTree={docTree}
                docTreeCollapsed={docTreeCollapsed}
                toggleDocTreeCollapsed={toggleDocTreeCollapsed}
                setTreeRenameDoc={modalState.setTreeRenameDoc}
                setTreeRenameValue={modalState.setTreeRenameValue}
                setTreeDeleteDoc={modalState.setTreeDeleteDoc}
                drafts={drafts}
                handleRestoreTaskDraft={modalState.handleRestoreTaskDraft}
                handleRestoreProjectDraft={modalState.handleRestoreProjectDraft}
                handleDeleteDraft={modalState.handleDeleteDraft}
                notifications={{
                  notifications,
                  unreadCount,
                  loading: notificationsLoading,
                  error: notificationsError,
                  fetchNotifications,
                  markOneRead,
                  markOneUnread,
                  deleteNotification,
                  markAllRead,
                }}
                taskHandlers={taskHandlers}
                projectHandlers={projectHandlers}
                documentHandlers={documentHandlers}
                openNewTaskModal={modalState.openNewTaskModal}
                openNewTaskModalForMe={modalState.openNewTaskModalForMe}
                openNewTaskForSprint={modalState.openNewTaskForSprint}
                handleOpenTask={modalState.handleOpenTask}
                setIsNewProjectModalOpen={modalState.setIsNewProjectModalOpen}
                setSlackDialogOpen={modalState.setSlackDialogOpen}
                navigateTo={navigateTo}
              />
            </PageTransition>
          </div>
        </SidebarInset>

        <WorkspaceModals
          selectedTask={modalState.selectedTask}
          myTasks={myTasks}
          projectTasks={projectTasks}
          descriptionCache={taskHandlers.descriptionCache}
          members={members}
          agentActors={agentActors}
          projects={projects}
          currentPage={currentPage}
          selectedProject={selectedProject}
          onCloseTask={modalState.handleCloseTask}
          onUpdateTask={taskHandlers.handleUpdateTask}
          isNewTaskModalOpen={modalState.isNewTaskModalOpen}
          setIsNewTaskModalOpen={modalState.setIsNewTaskModalOpen}
          newTaskDefaultAssigneeId={modalState.newTaskDefaultAssigneeId}
          setNewTaskDefaultAssigneeId={modalState.setNewTaskDefaultAssigneeId}
          newTaskDefaultStatus={modalState.newTaskDefaultStatus}
          setNewTaskDefaultStatus={modalState.setNewTaskDefaultStatus}
          newTaskDefaultSprintId={modalState.newTaskDefaultSprintId}
          setNewTaskDefaultSprintId={modalState.setNewTaskDefaultSprintId}
          newTaskSprintTeamId={modalState.newTaskSprintTeamId}
          setNewTaskSprintTeamId={modalState.setNewTaskSprintTeamId}
          newTaskPreFill={modalState.newTaskPreFill}
          setNewTaskPreFill={modalState.setNewTaskPreFill}
          onCreateTask={taskHandlers.handleCreateTask}
          restoringDraftId={modalState.restoringDraftId}
          setRestoringDraftId={modalState.setRestoringDraftId}
          isQuickDispatchOpen={modalState.isQuickDispatchOpen}
          setIsQuickDispatchOpen={modalState.setIsQuickDispatchOpen}
          isNewProjectModalOpen={modalState.isNewProjectModalOpen}
          setIsNewProjectModalOpen={modalState.setIsNewProjectModalOpen}
          onCreateProject={projectHandlers.handleCreateProject}
          projectDraftPreFill={modalState.projectDraftPreFill}
          setProjectDraftPreFill={modalState.setProjectDraftPreFill}
          projectDraftId={modalState.projectDraftId}
          setProjectDraftId={modalState.setProjectDraftId}
          onSaveDraft={modalState.handleSaveDraft}
          onDeleteDraft={modalState.handleDeleteDraft}
          slackDialogOpen={modalState.slackDialogOpen}
          setSlackDialogOpen={modalState.setSlackDialogOpen}
          workspaceUrl={workspaceUrl}
          treeRenameDoc={modalState.treeRenameDoc}
          setTreeRenameDoc={modalState.setTreeRenameDoc}
          treeRenameValue={modalState.treeRenameValue}
          setTreeRenameValue={modalState.setTreeRenameValue}
          treeDeleteDoc={modalState.treeDeleteDoc}
          setTreeDeleteDoc={modalState.setTreeDeleteDoc}
          docTree={docTree}
          selectedDocumentId={selectedDocumentId}
          setCurrentPage={setCurrentPage as Dispatch<SetStateAction<string>>}
          onDeleteDocument={documentHandlers.handleDeleteDocument}
        />
      </SidebarProvider>
    </motion.div>
  )
}
