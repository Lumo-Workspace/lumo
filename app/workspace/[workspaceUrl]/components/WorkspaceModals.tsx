'use client'

import { Dispatch, MutableRefObject, SetStateAction } from 'react'
import { AnimatePresence } from 'motion/react'
import { useIntl } from 'react-intl'
import type {
  ApiTask,
  ApiProject,
  ApiStatus,
  MyTask,
  WorkspaceMemberInfo,
  TaskPreFillFields,
} from '../types'
import type { AgentActor } from '../hooks/useMembers'
import { CACHE_KEY } from '../constants'
import { readCache, writeCache } from '../cache'
import { documentsClient } from '@/lib/api-client'
import type { NewTaskFormData } from './modals/NewTaskModal'

import { TaskDrawer } from './TaskDrawer'
import { NewTaskModal } from './modals/NewTaskModal'
import { QuickDispatchModal } from './modals/QuickDispatchModal'
import { NewProjectModal, NewProjectFormData } from './modals/NewProjectModal'
import { ProjectSlackDialog } from './ProjectSlackDialog'
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

// ── Types ───────────────────────────────────────────────────────────────────

interface DocTreeActions {
  renameNode: (id: string, title: string) => void
  removeNode: (id: string) => void
}

interface WorkspaceModalsProps {
  // Task drawer
  selectedTask: ApiTask | MyTask | null
  taskMap: Record<string, ApiTask>
  descriptionCache: MutableRefObject<Map<string, string | null>>
  members: WorkspaceMemberInfo[]
  agentActors: AgentActor[]
  projects: ApiProject[]
  currentPage: string
  selectedProject: ApiProject | null
  onCloseTask: () => void
  onUpdateTask: (taskId: string, data: Record<string, unknown>) => Promise<void>
  onTasksChanged: () => void

  // New task modal
  isNewTaskModalOpen: boolean
  setIsNewTaskModalOpen: Dispatch<SetStateAction<boolean>>
  newTaskDefaultAssigneeId: string | undefined
  setNewTaskDefaultAssigneeId: Dispatch<SetStateAction<string | undefined>>
  newTaskDefaultStatus: ApiStatus | undefined
  setNewTaskDefaultStatus: Dispatch<SetStateAction<ApiStatus | undefined>>
  newTaskPreFill: TaskPreFillFields | undefined
  setNewTaskPreFill: Dispatch<SetStateAction<TaskPreFillFields | undefined>>
  onCreateTask: (data: NewTaskFormData) => Promise<void>
  restoringDraftId: string | undefined
  setRestoringDraftId: Dispatch<SetStateAction<string | undefined>>

  // Quick dispatch
  isQuickDispatchOpen: boolean
  setIsQuickDispatchOpen: Dispatch<SetStateAction<boolean>>
  myTasks: MyTask[]

  // New project modal
  isNewProjectModalOpen: boolean
  setIsNewProjectModalOpen: Dispatch<SetStateAction<boolean>>
  onCreateProject: (data: NewProjectFormData) => Promise<void>
  projectDraftPreFill: { name: string; description: string } | undefined
  setProjectDraftPreFill: Dispatch<
    SetStateAction<{ name: string; description: string } | undefined>
  >
  projectDraftId: string | undefined
  setProjectDraftId: Dispatch<SetStateAction<string | undefined>>

  // Draft handlers
  onSaveDraft: (
    type: 'TASK' | 'PROJECT',
    data: Record<string, unknown>
  ) => Promise<void>
  onDeleteDraft: (id: string) => Promise<void>

  // Slack dialog
  slackDialogOpen: boolean
  setSlackDialogOpen: Dispatch<SetStateAction<boolean>>
  workspaceUrl: string

  // Tree rename/delete dialogs
  treeRenameDoc: { id: string; title: string } | null
  setTreeRenameDoc: Dispatch<
    SetStateAction<{ id: string; title: string } | null>
  >
  treeRenameValue: string
  setTreeRenameValue: Dispatch<SetStateAction<string>>
  treeDeleteDoc: { id: string; title: string } | null
  setTreeDeleteDoc: Dispatch<
    SetStateAction<{ id: string; title: string } | null>
  >
  docTree: DocTreeActions
  selectedDocumentId: string | null
  setCurrentPage: Dispatch<SetStateAction<string>>
}

// ── Component ───────────────────────────────────────────────────────────────

export function WorkspaceModals({
  selectedTask,
  taskMap,
  descriptionCache,
  members,
  agentActors,
  projects,
  currentPage,
  selectedProject,
  onCloseTask,
  onUpdateTask,
  onTasksChanged,
  isNewTaskModalOpen,
  setIsNewTaskModalOpen,
  newTaskDefaultAssigneeId,
  setNewTaskDefaultAssigneeId,
  newTaskDefaultStatus,
  setNewTaskDefaultStatus,
  newTaskPreFill,
  setNewTaskPreFill,
  onCreateTask,
  restoringDraftId,
  setRestoringDraftId,
  isQuickDispatchOpen,
  setIsQuickDispatchOpen,
  myTasks,
  isNewProjectModalOpen,
  setIsNewProjectModalOpen,
  onCreateProject,
  projectDraftPreFill,
  setProjectDraftPreFill,
  projectDraftId,
  setProjectDraftId,
  onSaveDraft,
  onDeleteDraft,
  slackDialogOpen,
  setSlackDialogOpen,
  workspaceUrl,
  treeRenameDoc,
  setTreeRenameDoc,
  treeRenameValue,
  setTreeRenameValue,
  treeDeleteDoc,
  setTreeDeleteDoc,
  docTree,
  selectedDocumentId,
  setCurrentPage,
}: WorkspaceModalsProps) {
  const intl = useIntl()

  return (
    <>
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
                  onClose={onCloseTask}
                  members={members}
                  agentActors={agentActors}
                  projects={projects}
                  tasks={Object.values(taskMap)}
                  onUpdate={onUpdateTask}
                  onDescriptionLoaded={(taskId, description) => {
                    descriptionCache.current.set(taskId, description)
                    writeCache(CACHE_KEY.description(taskId), {
                      desc: description,
                    })
                  }}
                  onTasksChanged={onTasksChanged}
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
            defaultProjectId={newTaskPreFill?.projectId || selectedProject?.id}
            defaultAssigneeId={newTaskDefaultAssigneeId}
            defaultStatus={newTaskDefaultStatus}
            preFill={newTaskPreFill}
            onSubmit={onCreateTask}
            tasks={Object.values(taskMap) as ApiTask[]}
            draftId={restoringDraftId}
            onSaveDraft={onSaveDraft}
            onDeleteDraft={onDeleteDraft}
          />
        )}
        {isQuickDispatchOpen && (
          <QuickDispatchModal
            isOpen={isQuickDispatchOpen}
            onClose={() => setIsQuickDispatchOpen(false)}
            members={members}
            projects={projects}
            myTasks={myTasks}
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
            onSubmit={onCreateProject}
            preFill={projectDraftPreFill}
            draftId={projectDraftId}
            onSaveDraft={onSaveDraft}
            onDeleteDraft={onDeleteDraft}
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
              documentsClient.update(renamedId, { title: treeRenameValue })
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
                documentsClient.delete(deletedId)
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
    </>
  )
}
