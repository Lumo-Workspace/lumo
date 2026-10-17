'use client'

import { Dispatch, SetStateAction, useState, useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import type {
  ApiDraft,
  ApiProject,
  ApiStatus,
  ApiTask,
  MyTask,
  Page,
} from '../types'
import type { useRealtimeNotifications } from '../hooks/useRealtimeNotifications'
import type { useWorkspaceTaskHandlers } from '../hooks/useWorkspaceTaskHandlers'
import type { useWorkspaceProjectHandlers } from '../hooks/useWorkspaceProjectHandlers'
import type { useWorkspaceDocumentHandlers } from '../hooks/useWorkspaceDocumentHandlers'
import type { useDocumentTree } from '../hooks/useDocumentTree'
import { ProjectsPage } from './pages/ProjectsPage'
import { ProjectDetailPage } from './pages/ProjectDetailPage'
import { MilestoneDetailPage } from './pages/MilestoneDetailPage'
import { MyTasksPage } from './pages/MyTasksPage'
import { InboxPage } from './pages/InboxPage'
import { DocumentsPage } from './pages/DocumentsPage'
import { DocumentEditorPage } from './pages/DocumentEditorPage'
import { DraftsPage } from './DraftsPage'
import { SprintsLandingClient } from '../sprints/components/SprintsLandingClient'
import { SprintDetailClient } from '../sprints/[sprintId]/SprintDetailClient'
import { GlobalDocTree, CollapsedDocTreeRail } from './document/GlobalDocTree'
import {
  DocumentTemplatePicker,
  type PickerTemplate,
} from './document/DocumentTemplatePicker'
import { documentTemplatesClient } from '@/lib/api-client'

type NotificationsBundle = Omit<
  ReturnType<typeof useRealtimeNotifications>,
  'deleteOne'
> & {
  /** Renamed in the workspace shell to disambiguate from task deletion. */
  deleteNotification: ReturnType<typeof useRealtimeNotifications>['deleteOne']
}

interface Props {
  // ─── Active page ───────────────────────────────────────────────────────
  currentPage: Page
  workspaceUrl: string
  userId: string
  currentActorId: string | null
  currentMemberId: string | undefined
  isOwner: boolean
  members: ReturnType<
    typeof import('../hooks/useMembers').useMembers
  >['members']

  // ─── My Tasks ───────────────────────────────────────────────────────────
  myTasks: MyTask[]
  myTasksViewId: string | null
  myTasksLoading: boolean
  myTasksError: string | null
  fetchMyTasks: () => Promise<unknown>
  anySprintEnabledTeam: boolean
  activeSprintIds: string[]

  // ─── Projects ───────────────────────────────────────────────────────────
  projects: ApiProject[]
  projectsLoading: boolean
  projectsError: string | null
  fetchProjects: () => Promise<unknown>
  selectedProject: ApiProject | null
  setSelectedProject: Dispatch<SetStateAction<ApiProject | null>>

  // ─── Project tasks (project-detail page) ───────────────────────────────
  projectTasks: ApiTask[]
  kanbanViewId: string | null
  projectTasksLoading: boolean
  projectTasksError: string | null
  fetchProjectTasks: (id: string) => Promise<unknown>

  // ─── Documents ──────────────────────────────────────────────────────────
  documents: ReturnType<
    typeof import('../hooks/useDocuments').useDocuments
  >['documents']
  documentsLoading: boolean
  documentsError: string | null
  fetchDocuments: () => Promise<unknown>
  selectedDocumentId: string | null
  docTree: ReturnType<typeof useDocumentTree>
  docTreeCollapsed: boolean
  toggleDocTreeCollapsed: () => void
  setTreeRenameDoc: (d: { id: string; title: string } | null) => void
  setTreeRenameValue: (v: string) => void
  setTreeDeleteDoc: (d: { id: string; title: string } | null) => void

  // ─── Drafts ─────────────────────────────────────────────────────────────
  drafts: ApiDraft[]
  handleRestoreTaskDraft: (d: ApiDraft) => void
  handleRestoreProjectDraft: (d: ApiDraft) => void
  handleDeleteDraft: (id: string) => Promise<unknown>

  // ─── Inbox / notifications ──────────────────────────────────────────────
  notifications: NotificationsBundle

  // ─── Handler bundles (extracted hooks) ──────────────────────────────────
  taskHandlers: ReturnType<typeof useWorkspaceTaskHandlers>
  projectHandlers: ReturnType<typeof useWorkspaceProjectHandlers>
  documentHandlers: ReturnType<typeof useWorkspaceDocumentHandlers>

  // ─── Modal openers (from useWorkspaceModalState) ───────────────────────
  openNewTaskModal: (assigneeId?: string, status?: ApiStatus) => void
  openNewTaskModalForMe: (status?: ApiStatus) => void
  openNewTaskForSprint: (
    sprintId: string,
    teamId: string,
    status?: ApiStatus
  ) => void
  handleOpenTask: (task: ApiTask | MyTask) => void
  setIsNewProjectModalOpen: (open: boolean) => void
  setSlackDialogOpen: (open: boolean) => void
  navigateTo: (page: Page, project?: ApiProject) => void
}

/**
 * Renders the active workspace page based on `currentPage`. Everything below
 * the `SidebarInset` content slot lives here — extracted so `WorkspaceApp`
 * doesn't have to carry the 200-line switch statement next to its 40-prop
 * `WorkspaceModals`.
 *
 * Pages and dropped routes:
 *   my-tasks / projects / project-detail / documents /
 *   document-editor / drafts / sprints / sprint-detail / inbox.
 */
export function WorkspacePageRouter(props: Props) {
  const {
    currentPage,
    workspaceUrl,
    userId,
    currentActorId,
    currentMemberId,
    isOwner,
    members,
    myTasks,
    myTasksViewId,
    myTasksLoading,
    myTasksError,
    fetchMyTasks,
    anySprintEnabledTeam,
    activeSprintIds,
    projects,
    projectsLoading,
    projectsError,
    fetchProjects,
    selectedProject,
    setSelectedProject,
    projectTasks,
    kanbanViewId,
    projectTasksLoading,
    projectTasksError,
    fetchProjectTasks,
    documents,
    documentsLoading,
    documentsError,
    fetchDocuments,
    selectedDocumentId,
    docTree,
    docTreeCollapsed,
    toggleDocTreeCollapsed,
    setTreeRenameDoc,
    setTreeRenameValue,
    setTreeDeleteDoc,
    drafts,
    handleRestoreTaskDraft,
    handleRestoreProjectDraft,
    handleDeleteDraft,
    notifications,
    taskHandlers,
    projectHandlers,
    documentHandlers,
    openNewTaskModal,
    openNewTaskModalForMe,
    openNewTaskForSprint,
    handleOpenTask,
    setIsNewProjectModalOpen,
    setSlackDialogOpen,
    navigateTo,
  } = props

  // ─── Document template picker ─────────────────────────────────────────────
  // Intercepts the "new document" entry points: opening the picker lets the
  // user start from a template (or blank) before the optimistic create fires.
  const [templatePickerParentId, setTemplatePickerParentId] = useState<
    string | null
  >(null)
  const [templatePickerOpen, setTemplatePickerOpen] = useState(false)

  const { data: templateData, isLoading: templatesLoading } = useQuery({
    queryKey: ['document-templates'],
    queryFn: () =>
      documentTemplatesClient.list<{ templates: PickerTemplate[] }>(),
  })

  const openTemplatePicker = useCallback((parentId: string | null) => {
    setTemplatePickerParentId(parentId)
    setTemplatePickerOpen(true)
  }, [])

  const handleTemplateSelected = useCallback(
    (template: PickerTemplate | null) => {
      setTemplatePickerOpen(false)
      documentHandlers.handleTreeCreateChild(
        templatePickerParentId,
        template
          ? {
              id: template.id,
              content: template.content,
              emoji: template.emoji,
            }
          : undefined
      )
    },
    [documentHandlers, templatePickerParentId]
  )

  const templatePicker = (
    <DocumentTemplatePicker
      open={templatePickerOpen}
      onOpenChange={setTemplatePickerOpen}
      templates={templateData?.templates ?? []}
      loading={templatesLoading}
      onSelect={handleTemplateSelected}
    />
  )

  switch (currentPage) {
    case 'my-tasks':
      return (
        <MyTasksPage
          tasks={myTasks}
          setTasks={taskHandlers.setMyTasksForDnD}
          viewId={myTasksViewId}
          userId={userId}
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
              onAddChild={openTemplatePicker}
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
            onNewDocument={() => openTemplatePicker(null)}
            onSelectDocument={doc =>
              documentHandlers.navigateToDocument(doc.slug)
            }
            onDeleteDocument={documentHandlers.handleDeleteDocument}
          />
          {templatePicker}
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
              onAddChild={openTemplatePicker}
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
              onEmojiChanged={(id, emoji) => docTree.updateNodeEmoji(id, emoji)}
            />
          ) : null}
          {templatePicker}
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
      return (
        <SprintDetailClient
          onNewTask={openNewTaskForSprint}
          onOpenTask={handleOpenTask}
        />
      )

    case 'milestone-detail':
      return <MilestoneDetailPage onOpenTask={handleOpenTask} />

    case 'inbox':
      return (
        <InboxPage
          notifications={notifications.notifications}
          unreadCount={notifications.unreadCount}
          loading={notifications.loading}
          error={notifications.error}
          onRetry={notifications.fetchNotifications}
          onMount={notifications.fetchNotifications}
          onMarkOneRead={notifications.markOneRead}
          onMarkOneUnread={notifications.markOneUnread}
          onDeleteOne={notifications.deleteNotification}
          onMarkAllRead={notifications.markAllRead}
          onUpdateTaskStatus={async (taskId, status) => {
            await taskHandlers.handleUpdateTask(taskId, { status })
          }}
          members={members}
          projects={projects}
          onUpdate={taskHandlers.handleUpdateTask}
        />
      )

    default:
      return null
  }
}
