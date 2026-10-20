'use client'

import { useCallback, useState } from 'react'
import type {
  ApiDraft,
  ApiPriority,
  ApiStatus,
  ApiTask,
  MyTask,
  TaskPreFillFields,
} from '../types'

interface Options {
  /** Caller-provided task-handler side effect run on top of `setSelectedTask`
   * (typically hydrates the task description on first open). */
  onOpenTaskSideEffect: (task: ApiTask | MyTask) => void
  /** Caller-provided base "open new task modal" side effect. */
  onOpenNewTaskModal: (assigneeId?: string, status?: ApiStatus) => void
  /** The viewer's actor id. Task assignees (the picker and the task API) are
   * actor ids, never WorkspaceMember ids (LUM-1045). Null until the member
   * has an actor. */
  currentActorId: string | null
  /** Draft service hooks — invoked from the restore/save/delete callbacks. */
  saveDraft: (
    type: 'TASK' | 'PROJECT',
    data: Record<string, unknown>
  ) => Promise<unknown>
  deleteDraft: (id: string) => Promise<unknown>
}

/**
 * Co-locates every modal/dialog/drawer state slice the workspace shell
 * carries plus the opener callbacks that fan out across pages. Returning a
 * single big object is unusual but the alternative — splitting into 5 micro-
 * hooks — fragments related state and makes the call site verbose. Caller
 * (`WorkspaceApp`) destructures only the fields it needs in any given JSX
 * subtree.
 *
 * Slices owned here:
 *   - Task drawer (`selectedTask`)
 *   - New-task modal (open flag + 5 defaults + prefill + restoring-draft id)
 *   - New-project modal (open flag + draft prefill + draft id)
 *   - Quick dispatch (Cmd+K) panel
 *   - Slack connection dialog
 *   - Doc-tree rename / delete dialogs
 *   - Draft restore + save + delete callbacks
 */
export function useWorkspaceModalState({
  onOpenTaskSideEffect,
  onOpenNewTaskModal,
  currentActorId,
  saveDraft,
  deleteDraft,
}: Options) {
  // ─── Task drawer ─────────────────────────────────────────────────────────
  const [selectedTask, setSelectedTask] = useState<ApiTask | MyTask | null>(
    null
  )

  // ─── New-task modal ──────────────────────────────────────────────────────
  const [isNewTaskModalOpen, setIsNewTaskModalOpen] = useState(false)
  const [newTaskDefaultAssigneeId, setNewTaskDefaultAssigneeId] = useState<
    string | undefined
  >(undefined)
  const [newTaskDefaultStatus, setNewTaskDefaultStatus] = useState<
    ApiStatus | undefined
  >(undefined)
  const [newTaskDefaultSprintId, setNewTaskDefaultSprintId] = useState<
    string | null | undefined
  >(undefined)
  const [newTaskSprintTeamId, setNewTaskSprintTeamId] = useState<
    string | null | undefined
  >(undefined)
  const [newTaskPreFill, setNewTaskPreFill] = useState<
    TaskPreFillFields | undefined
  >(undefined)
  const [restoringDraftId, setRestoringDraftId] = useState<string | undefined>()

  // ─── New-project modal ───────────────────────────────────────────────────
  const [isNewProjectModalOpen, setIsNewProjectModalOpen] = useState(false)
  const [projectDraftPreFill, setProjectDraftPreFill] = useState<
    { name: string; description: string } | undefined
  >()
  const [projectDraftId, setProjectDraftId] = useState<string | undefined>()

  // ─── Quick dispatch / Slack ──────────────────────────────────────────────
  const [isQuickDispatchOpen, setIsQuickDispatchOpen] = useState(false)
  const [slackDialogOpen, setSlackDialogOpen] = useState(false)

  // ─── Doc-tree rename / delete dialogs ────────────────────────────────────
  const [treeRenameDoc, setTreeRenameDoc] = useState<{
    id: string
    title: string
  } | null>(null)
  const [treeRenameValue, setTreeRenameValue] = useState('')
  const [treeDeleteDoc, setTreeDeleteDoc] = useState<{
    id: string
    title: string
  } | null>(null)

  // ─── Task drawer handlers ────────────────────────────────────────────────
  const handleOpenTask = useCallback(
    (task: ApiTask | MyTask) => {
      onOpenTaskSideEffect(task)
      setSelectedTask(task)
    },
    [onOpenTaskSideEffect]
  )

  const handleCloseTask = useCallback(() => setSelectedTask(null), [])

  // ─── New-task modal openers ──────────────────────────────────────────────
  const openNewTaskModal = useCallback(
    (assigneeId?: string, status?: ApiStatus) => {
      onOpenNewTaskModal(assigneeId, status)
      setNewTaskDefaultAssigneeId(
        typeof assigneeId === 'string' ? assigneeId : undefined
      )
      setNewTaskDefaultStatus(status)
      setNewTaskPreFill(undefined)
      setIsNewTaskModalOpen(true)
    },
    [onOpenNewTaskModal]
  )

  const openNewTaskModalForMe = useCallback(
    (status?: ApiStatus) => {
      openNewTaskModal(currentActorId ?? undefined, status)
    },
    [openNewTaskModal, currentActorId]
  )

  const openNewTaskForSprint = useCallback(
    (sprintId: string, teamId: string, status?: ApiStatus) => {
      onOpenNewTaskModal(undefined, status)
      setNewTaskDefaultAssigneeId(undefined)
      setNewTaskDefaultStatus(status)
      setNewTaskDefaultSprintId(sprintId)
      setNewTaskSprintTeamId(teamId)
      setNewTaskPreFill(undefined)
      setIsNewTaskModalOpen(true)
    },
    [onOpenNewTaskModal]
  )

  // ─── Draft restore + save + delete ───────────────────────────────────────
  const handleRestoreTaskDraft = useCallback((draft: ApiDraft) => {
    const data = draft.data as Record<string, unknown>
    setNewTaskPreFill({
      title: (data.title as string) ?? '',
      description: (data.description as string) ?? '',
      status: (data.status as ApiStatus) ?? 'TODO',
      priority: (data.priority as ApiPriority) ?? 'NONE',
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

  return {
    // Task drawer
    selectedTask,
    setSelectedTask,
    handleOpenTask,
    handleCloseTask,

    // New-task modal
    isNewTaskModalOpen,
    setIsNewTaskModalOpen,
    newTaskDefaultAssigneeId,
    setNewTaskDefaultAssigneeId,
    newTaskDefaultStatus,
    setNewTaskDefaultStatus,
    newTaskDefaultSprintId,
    setNewTaskDefaultSprintId,
    newTaskSprintTeamId,
    setNewTaskSprintTeamId,
    newTaskPreFill,
    setNewTaskPreFill,
    restoringDraftId,
    setRestoringDraftId,
    openNewTaskModal,
    openNewTaskModalForMe,
    openNewTaskForSprint,

    // New-project modal
    isNewProjectModalOpen,
    setIsNewProjectModalOpen,
    projectDraftPreFill,
    setProjectDraftPreFill,
    projectDraftId,
    setProjectDraftId,

    // Quick dispatch / Slack
    isQuickDispatchOpen,
    setIsQuickDispatchOpen,
    slackDialogOpen,
    setSlackDialogOpen,

    // Doc-tree dialogs
    treeRenameDoc,
    setTreeRenameDoc,
    treeRenameValue,
    setTreeRenameValue,
    treeDeleteDoc,
    setTreeDeleteDoc,

    // Drafts
    handleRestoreTaskDraft,
    handleRestoreProjectDraft,
    handleSaveDraft,
    handleDeleteDraft,
  }
}
