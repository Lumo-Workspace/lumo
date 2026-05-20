'use client'

import { useCallback, useEffect, useRef, useMemo } from 'react'
import { useIntl } from 'react-intl'
import { useRouter } from 'next/navigation'
import { useCurrentUser } from '../../hooks/useCurrentUser'
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar'
import { AppSidebar } from '../Sidebar'
import { Spinner } from '@/components/ui/spinner'
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
import { TaskDetail, ApiTask, WorkspaceMemberInfo, Page } from '../../types'
import { CACHE_KEY } from '../../constants'
import { readCache, writeCache } from '../../cache'
import { pageToPath } from '../../utils'
import { slugify } from '@/lib/utils/slugify'
import { tasksClient, workspacesClient } from '@/lib/api-client'
import { useRealtimeNotifications } from '../../hooks/useRealtimeNotifications'
import { usePusherEvent } from '../../hooks/usePusher'
import type { TaskEvent } from '@/lib/integrations/pusher'
import { DescriptionEditor } from '../DescriptionEditor'
// AgentPanel hidden — agent features disabled for now
import { useTaskComments } from '../../hooks/useTaskComments'
import { useTaskMutation } from '../../hooks/useTaskMutation'
import { useTaskDescription } from '../../hooks/useTaskDescription'
import { useTaskDetailState } from '../../hooks/useTaskDetailState'
import { useTaskDetailActions } from '../../hooks/useTaskDetailActions'
import { useTags } from '../../hooks/useTags'
import { useProjects } from '../../hooks/useProjects'
import { TaskDetailHeader } from '../TaskDetailHeader'
import { TimelineTabs } from '../TaskDetailTimeline/TimelineTabs'
import { TaskDetailSidebar } from '../TaskDetailSidebar'

interface TaskDetailPageProps {
  initialTask: TaskDetail & {
    children?: { id: string; title: string; number: number; status: string }[]
  }
  workspaceUrl: string
  /** Pre-set source for breadcrumb (e.g. 'my-tasks'). Falls back to sessionStorage. */
  source?: string | undefined
  /** Whether this workspace has a connected Slack integration. */
  slackConnected: boolean
}

export function TaskDetailPage({
  initialTask,
  workspaceUrl,
  source: sourceProp,
  slackConnected,
}: TaskDetailPageProps) {
  // ── Hooks ──────────────────────────────────────────────────────────────────
  const intl = useIntl()
  const router = useRouter()
  const { user } = useCurrentUser()
  const { unreadCount } = useRealtimeNotifications()

  // ── State (extracted) ──────────────────────────────────────────────────────
  const state = useTaskDetailState({ initialTask, workspaceUrl, sourceProp })
  const {
    from,
    sourceLabel,
    task,
    setTask,
    taskIdentifier,
    taskFullUrl,
    deleteOpen,
    setDeleteOpen,
    createBranchOpen,
    setCreateBranchOpen,
    copiedBranchId,
    setCopiedBranchId,
    members,
    setMembers,
    agentActors,
    setAgentActors,
  } = state

  // Read projects from the shared Provider instead of a local cached copy.
  // `ProjectsProvider` is the sole owner of the projects list + cache; a
  // per-page fetch here used to write stale data back to the cache after a
  // concurrent delete.
  const { projects } = useProjects()

  // ── Extracted hooks ────────────────────────────────────────────────────────
  const currentMember = members.find(m => m.clerkId === user?.id)

  const tc = useTaskComments({
    taskId: task.id,
    currentActorId: currentMember?.actorId ?? null,
  })

  const { handlePatch: rawHandlePatch } = useTaskMutation({
    task,
    setTask,
    projects,
  })

  // Track in-flight local mutations so the Pusher refetch below doesn't
  // clobber an optimistic value with a stale server snapshot.
  const pendingMutationsRef = useRef(0)
  const handlePatch = useCallback(
    async (data: Parameters<typeof rawHandlePatch>[0]) => {
      pendingMutationsRef.current++
      try {
        await rawHandlePatch(data)
      } finally {
        pendingMutationsRef.current = Math.max(
          0,
          pendingMutationsRef.current - 1
        )
      }
    },
    [rawHandlePatch]
  )
  const { tags: allTags, createTag } = useTags()

  const desc = useTaskDescription({
    taskId: initialTask.id,
    initialDescription: initialTask.description,
  })

  // ── Actions (extracted) ────────────────────────────────────────────────────
  const actions = useTaskDetailActions({
    task,
    taskFullUrl,
    setCopiedBranchId,
    handlePatch,
  })

  const mentionableMembers = useMemo(
    () => members.filter(m => m.clerkId !== user?.id),
    [members, user?.id]
  )

  // ── Anchor scroll ──────────────────────────────────────────────────────────
  const hasScrolled = useRef(false)
  useEffect(() => {
    if (hasScrolled.current) return
    if (!tc.comments.length) return
    const hash = window.location.hash
    if (!hash.startsWith('#comment-')) return
    const commentId = hash.slice('#comment-'.length)
    hasScrolled.current = true
    tc.scrollToComment(commentId)
  }, [tc.comments, tc.scrollToComment])

  // ── Parallel fetch on mount ────────────────────────────────────────────────
  //
  // Projects are intentionally NOT fetched here — `ProjectsProvider` is the
  // sole owner of the projects list + cache. A stale `projectsClient.list()`
  // resolving after a concurrent delete from another page used to repopulate
  // the cache with the deleted project.
  useEffect(() => {
    Promise.all([
      tasksClient
        .getById<{ task: TaskDetail | null }>(initialTask.id)
        .catch(() => ({ task: null })),
      workspacesClient
        .listMembers<{
          members: WorkspaceMemberInfo[]
          agentActors?: { actorId: string; name: string; avatarColor: string }[]
        }>()
        .catch(() => ({
          members: [] as WorkspaceMemberInfo[],
          agentActors: undefined,
        })),
      tc.fetchComments(),
    ])
      .then(([taskData, membersData]) => {
        if (taskData.task) {
          const t = taskData.task as TaskDetail
          setTask(prev => ({ ...prev, ...t }))
          desc.setDescriptionFromFetch(t.description ?? null)
          const taskMap =
            readCache<Record<string, ApiTask>>(CACHE_KEY.tasks) ?? {}
          writeCache(CACHE_KEY.tasks, { ...taskMap, [t.id]: t })
        }
        const freshMembers: WorkspaceMemberInfo[] = membersData.members ?? []
        if (freshMembers.length > 0) {
          setMembers(freshMembers)
          writeCache(CACHE_KEY.members, freshMembers)
        }
        if (membersData.agentActors) {
          setAgentActors(membersData.agentActors)
          writeCache(CACHE_KEY.agentActors, membersData.agentActors)
        }
      })
      .catch(() => {})
      .finally(() => {
        desc.finishLoading()
      })
  }, [initialTask.id])

  // ── Pusher: real-time task & comment updates ──────────────────────────────
  usePusherEvent<TaskEvent>(`task-${initialTask.id}`, 'task-update', event => {
    if (
      event.type === 'comment:created' ||
      event.type === 'comment:updated' ||
      event.type === 'comment:deleted'
    ) {
      tc.fetchComments()
    }
    if (event.type === 'task:updated') {
      // Skip the refetch while a local mutation is in flight: the server
      // snapshot may not yet reflect that mutation, and merging it would
      // briefly revert the optimistic value. The next Pusher event after
      // the local mutations settle will reconcile.
      if (pendingMutationsRef.current > 0) return
      tasksClient
        .getById<{ task: TaskDetail }>(initialTask.id)
        .then(data => {
          if (data?.task) {
            const t = data.task as TaskDetail
            setTask(prev => ({ ...prev, ...t }))
            desc.setDescriptionFromFetch(t.description ?? null)
            const taskMap =
              readCache<Record<string, ApiTask>>(CACHE_KEY.tasks) ?? {}
            writeCache(CACHE_KEY.tasks, { ...taskMap, [t.id]: t })
          }
        })
        .catch(() => {})
    }
  })

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <SidebarProvider className='h-screen font-sans'>
      <AppSidebar
        currentPage={'task-detail' as Page}
        onNavigate={(page: Page) => router.push(pageToPath(workspaceUrl, page))}
        unreadCount={unreadCount}
        draftCount={0}
      />
      <SidebarInset className='overflow-hidden flex flex-col'>
        <TaskDetailHeader
          workspaceUrl={workspaceUrl}
          from={from}
          sourceLabel={sourceLabel}
          taskTitle={task.title}
          taskIdentifier={taskIdentifier}
          projectName={task.project.name}
          deleteOpen={deleteOpen}
          setDeleteOpen={setDeleteOpen}
          onDeleteTask={actions.handleDeleteTask}
          taskLinkCopied={actions.taskLinkCopied}
          onCopyTaskLink={actions.handleCopyTaskLink}
        />

        {/* Two-column body */}
        <div className='flex flex-1 overflow-hidden'>
          {/* Left column */}
          <div className='flex-1 overflow-y-auto px-8 py-6'>
            {/* Editable title */}
            <h1
              contentEditable
              suppressContentEditableWarning
              onBlur={e => {
                const trimmed = e.currentTarget.textContent?.trim() ?? ''
                if (!trimmed || trimmed === task.title) {
                  e.currentTarget.textContent = task.title
                  return
                }
                handlePatch({ title: trimmed })
              }}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  e.currentTarget.blur()
                }
                if (e.key === 'Escape') {
                  e.currentTarget.textContent = task.title
                  e.currentTarget.blur()
                }
              }}
              className='text-2xl font-bold text-zinc-900 dark:text-zinc-100 outline-none cursor-text mb-6 leading-tight'
            >
              {task.title}
            </h1>

            {/* Description */}
            {desc.descriptionLoading ? (
              <Spinner className='size-4 text-zinc-300 dark:text-zinc-600' />
            ) : (
              <DescriptionEditor
                value={desc.descriptionValue}
                onCommit={actions.commitDescription}
                members={mentionableMembers}
              />
            )}

            {/* Spec — hidden: agent features disabled for now */}

            {/* Sub-tasks */}
            {(initialTask.children?.length ?? 0) > 0 && (
              <div className='mt-8'>
                <p className='text-xs font-semibold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider mb-3'>
                  {intl.formatMessage({ id: 'task.subtasks' })}
                </p>
                <div className='space-y-1'>
                  {initialTask.children!.map(child => {
                    const childIdentifier = `${task.teamIdentifier}-${child.number}`
                    const projectSlug = slugify(task.project.name)
                    const isDone = child.status === 'DONE'
                    return (
                      <button
                        key={child.id}
                        type='button'
                        onClick={() =>
                          router.push(
                            `/workspace/${workspaceUrl}/project/${projectSlug}/tasks/${childIdentifier}`
                          )
                        }
                        className={`w-full text-left text-sm py-1.5 px-2 rounded hover:bg-zinc-50 dark:hover:bg-zinc-900 cursor-pointer transition-colors ${isDone ? 'line-through text-zinc-400 dark:text-zinc-500' : 'text-zinc-600 dark:text-zinc-400'}`}
                      >
                        {childIdentifier} · {child.title}
                      </button>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Agent Panel — hidden: agent features disabled for now */}

            {/* Activity / Comments Timeline */}
            <TimelineTabs
              taskId={task.id}
              commentsProps={{
                workspaceUrl,
                projectName: task.project.name,
                teamIdentifier: task.teamIdentifier,
                taskNumber: task.number,
                members,
                agentActors,
                mentionableMembers,
                currentActorId: currentMember?.actorId,
                user,
                tc,
              }}
              slackConnected={slackConnected}
            />
          </div>

          {/* Right column */}
          <TaskDetailSidebar
            task={task}
            members={members}
            agentActors={agentActors}
            projects={projects}
            copiedBranchId={copiedBranchId}
            createBranchOpen={createBranchOpen}
            setCreateBranchOpen={setCreateBranchOpen}
            workspaceUrl={workspaceUrl}
            workspaceId={task.project.workspaceId ?? ''}
            onPatch={handlePatch}
            onCopyBranch={actions.handleCopyBranch}
            onUnlinkPr={async (prId: string) => {
              await tasksClient.unlinkPr(task.id, prId)
              const data = await tasksClient.getById<{ task: TaskDetail }>(
                task.id
              )
              if (data?.task) setTask(prev => ({ ...prev, ...data.task }))
            }}
            onLinkPr={async () => {
              const data = await tasksClient.getById<{ task: TaskDetail }>(
                task.id
              )
              if (data?.task) setTask(prev => ({ ...prev, ...data.task }))
            }}
            allTags={allTags}
            onTagsChange={tags => {
              setTask(prev => ({ ...prev, tags }))
              handlePatch({ tagIds: tags.map(t => t.id) })
            }}
            onCreateTag={createTag}
            onBranchCreated={branch =>
              setTask(prev => ({
                ...prev,
                branches: [...(prev.branches ?? []), branch],
              }))
            }
            onUnlinkBranch={branchId =>
              setTask(prev => ({
                ...prev,
                branches: (prev.branches ?? []).filter(b => b.id !== branchId),
              }))
            }
          />
        </div>
      </SidebarInset>

      {/* Delete-comment confirmation dialog */}
      <AlertDialog
        open={tc.confirmDeleteId !== null}
        onOpenChange={open => {
          if (!open) tc.setConfirmDeleteId(null)
        }}
      >
        <AlertDialogContent
          className='max-w-xs'
          onKeyDown={e => {
            if (e.key === 'Enter') {
              e.preventDefault()
              if (tc.confirmDeleteId) tc.deleteComment(tc.confirmDeleteId)
              tc.setConfirmDeleteId(null)
            }
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>
              {intl.formatMessage({ id: 'task.deleteCommentTitle' })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {intl.formatMessage({ id: 'task.deleteCommentDesc' })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              {intl.formatMessage({ id: 'common.cancel' })}
            </AlertDialogCancel>
            <AlertDialogAction
              className='bg-red-600 hover:bg-red-700 focus:ring-red-600'
              onClick={() => {
                if (tc.confirmDeleteId) tc.deleteComment(tc.confirmDeleteId)
                tc.setConfirmDeleteId(null)
              }}
            >
              {intl.formatMessage({ id: 'common.delete' })}
              <kbd className='ml-1.5 text-[10px] opacity-60 font-sans'>↵</kbd>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SidebarProvider>
  )
}
