'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useIntl } from 'react-intl'
import {
  Send,
  Pencil,
  Trash2,
  Reply,
  Link as LinkIcon,
  GitPullRequest,
  GitBranch,
} from 'lucide-react'
import { useParams, useRouter } from 'next/navigation'
import { formatTimestamp, slugifyProjectName } from '../utils'
import { apiFetch, tasksClient } from '@/lib/api-client'
import { copyLink } from '../utils/copyLink'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import {
  TaskDetail,
  ApiTask,
  MyTask,
  ApiStatus,
  ApiPriority,
  WorkspaceMemberInfo,
  ApiProject,
} from '../types'
import { DescriptionEditor } from './DescriptionEditor'
import { AiDescriptionPrompt } from './AiDescriptionPrompt'
import { TypographyH3 } from '@/components/ui/typography'
import {
  StatusSelect,
  AssigneeSelect,
  ReviewerSelect,
  ProjectSelect,
  PrioritySelect,
  DueDatePicker,
  SeparatorDot,
  FIELD_TRIGGER_CLS,
} from './TaskFieldSelects'
import { cn } from '@/lib/utils'
import { Spinner } from '@/components/ui/spinner'
import { AgentPanel } from '@/components/task/AgentPanel'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
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
import { CACHE_KEY } from '../constants'
import { readCache, writeCache } from '../cache'
import { useCurrentUser } from '../hooks/useCurrentUser'
import { CreateBranchDialog } from './CreateBranchDialog'
import { PrStateBadge, CiIcon } from './pr-helpers'
import { CommentAvatar } from './CommentAvatar'
import { resolveCommentAuthor } from './comment-utils'
import { usePusherEvent } from '../hooks/usePusher'
import type { TaskEvent } from '@/lib/pusher/server'
import { SubtasksSection } from './SubtasksSection'
import { useTaskComments } from '../hooks/useTaskComments'
import { useTaskMutation } from '../hooks/useTaskMutation'
import { useTaskDescription } from '../hooks/useTaskDescription'

// ─── Comment editor (key-based clear + Cmd/Ctrl+Enter submit) ────────────────

function CommentEditor({
  onCommit,
  onSubmit,
  clearRef,
  members,
  tasks,
  agentActors,
}: {
  onCommit: (html: string | null) => void
  onSubmit: () => void
  clearRef: React.MutableRefObject<(() => void) | null>
  members?: WorkspaceMemberInfo[]
  tasks?: ApiTask[]
  agentActors?: { actorId: string; name: string; avatarColor: string }[]
}) {
  const intl = useIntl()
  const [key, setKey] = useState(0)

  useEffect(() => {
    clearRef.current = () => setKey(k => k + 1)
  })

  return (
    <div
      className='px-3 pt-2 pb-1 text-sm'
      onKeyDown={e => {
        const isMac = /Mac|iPhone|iPad/i.test(navigator.platform)
        if ((isMac ? e.metaKey : e.ctrlKey) && e.key === 'Enter') {
          e.preventDefault()
          onSubmit()
        }
      }}
    >
      <DescriptionEditor
        key={key}
        value={null}
        onCommit={onCommit}
        onChange={onCommit}
        placeholder={intl.formatMessage({ id: 'task.commentPlaceholder' })}
        {...(members ? { members } : {})}
        {...(tasks ? { tasks } : {})}
        {...(agentActors ? { agentActors } : {})}
      />
    </div>
  )
}

// ─── TaskDetailPanel ──────────────────────────────────────────────────────────

export interface TaskDetailPanelProps {
  initialTask: ApiTask | MyTask
  /** Live task from the normalized store — used to sync external updates (drag, etc.) */
  liveTask?: ApiTask
  cachedDescription?: string | null | undefined
  members: WorkspaceMemberInfo[]
  agentActors?:
    | { actorId: string; name: string; avatarColor: string }[]
    | undefined
  projects: ApiProject[]
  onUpdate: (
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
  ) => Promise<void>
  onDescriptionLoaded?:
    | ((taskId: string, description: string | null) => void)
    | undefined
  onTasksChanged?: (() => void) | undefined
  tasks?: ApiTask[]
}

export function TaskDetailPanel({
  initialTask,
  liveTask,
  cachedDescription,
  members,
  agentActors,
  projects,
  onUpdate,
  onDescriptionLoaded,
  onTasksChanged,
  tasks = [],
}: TaskDetailPanelProps) {
  const [task, setTask] = useState<TaskDetail>(() => ({
    id: initialTask.id,
    title: initialTask.title,
    status: initialTask.status,
    priority: initialTask.priority,
    projectId: initialTask.projectId,
    project:
      'project' in initialTask && initialTask.project
        ? initialTask.project
        : { id: initialTask.projectId, name: '' },
    parentTaskId: initialTask.parentTaskId,
    assigneeActorId: initialTask.assigneeActorId,
    reviewerActorId: initialTask.reviewerActorId,
    assignee: initialTask.assignee ?? null,
    reviewer: null,
    description: cachedDescription ?? null,
    dueDate: initialTask.dueDate ?? null,
    updatedAt: initialTask.updatedAt,
    number: initialTask.number,
    teamIdentifier: initialTask.teamIdentifier,
    repositoryId:
      'repositoryId' in initialTask ? (initialTask.repositoryId ?? null) : null,
    parent: 'parent' in initialTask ? (initialTask.parent ?? null) : null,
  }))
  const intl = useIntl()
  const { user } = useCurrentUser()
  const router = useRouter()
  const { workspaceUrl } = useParams<{ workspaceUrl: string }>()
  const navigateToParent = useCallback(() => {
    const parent = task.parent
    if (!parent) return
    const parentIdentifier = `${parent.teamIdentifier}-${parent.number}`
    const projectSlug = slugifyProjectName(task.project.name)
    router.push(
      `/workspace/${workspaceUrl}/project/${projectSlug}/tasks/${parentIdentifier}`
    )
  }, [task.parent, task.project.name, workspaceUrl, router])

  const mentionableMembers = members.filter(m => m.clerkId !== user?.id)

  // Members with actorId (non-null only) for AssigneeSelect / ReviewerSelect
  const membersWithActorId = useMemo(
    () =>
      members.filter(
        (m): m is WorkspaceMemberInfo & { actorId: string } =>
          m.actorId !== null
      ),
    [members]
  )

  // Derive current member for author comparisons
  const currentMember = useMemo(
    () => members.find(m => m.clerkId === user?.id),
    [members, user?.id]
  )

  // ─── Extracted hooks ────────────────────────────────────────────────────────
  const tc = useTaskComments({
    taskId: task.id,
    currentActorId: currentMember?.actorId ?? null,
  })

  const { handlePatch } = useTaskMutation({
    task,
    setTask,
    projects,
    onExternalUpdate: onUpdate,
  })

  const desc = useTaskDescription({
    taskId: initialTask.id,
    cachedDescription,
    onDescriptionLoaded,
  })

  const [createBranchOpen, setCreateBranchOpen] = useState(false)
  const [relatedDocs, setRelatedDocs] = useState<
    { id: string; title: string; emoji: string | null; updatedAt: string }[]
  >([])

  // ─── Sync external updates (e.g. drag-and-drop status change) ───────────────
  useEffect(() => {
    if (!liveTask) return
    setTask(prev => {
      if (
        prev.title === liveTask.title &&
        prev.status === liveTask.status &&
        prev.priority === liveTask.priority &&
        prev.assigneeActorId === liveTask.assigneeActorId &&
        prev.reviewerActorId === liveTask.reviewerActorId &&
        prev.projectId === liveTask.projectId &&
        prev.dueDate === (liveTask.dueDate ?? null)
      )
        return prev
      return {
        ...prev,
        title: liveTask.title,
        status: liveTask.status,
        priority: liveTask.priority,
        assigneeActorId: liveTask.assigneeActorId,
        reviewerActorId: liveTask.reviewerActorId,
        projectId: liveTask.projectId,
        dueDate: liveTask.dueDate ?? null,
      }
    })
  }, [liveTask])

  // Fetch full task detail on mount
  useEffect(() => {
    tasksClient
      .getById<{ task: TaskDetail | null }>(initialTask.id)
      .then(taskData => {
        if (taskData.task) {
          const t = taskData.task as TaskDetail
          setTask(prev => ({
            ...prev,
            description: t.description,
            project: t.project,
            reviewerActorId: t.reviewerActorId,
            assignee: t.assignee,
            reviewer: t.reviewer,
            number: t.number,
            teamIdentifier: t.teamIdentifier,
            pullRequests: t.pullRequests ?? [],
            branches: t.branches ?? [],
            children: t.children ?? [],
            parent: t.parent ?? null,
            dueDate: t.dueDate ?? null,
          }))
          desc.setDescriptionFromFetch(t.description ?? null)
          // Sync task to cache
          const taskMap =
            readCache<Record<string, ApiTask>>(CACHE_KEY.tasks) ?? {}
          writeCache(CACHE_KEY.tasks, { ...taskMap, [t.id]: t })
        }
      })
      .catch(() => {})
      .finally(() => {
        desc.finishLoading()
      })

    tc.fetchComments()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialTask.id])

  // ── Related documents ────────────────────────────────────────────────────
  useEffect(() => {
    if (!task?.id) return
    apiFetch<{
      documents?: {
        id: string
        title: string
        emoji: string | null
        updatedAt: string
      }[]
    }>(`/api/tasks/${task.id}/documents`)
      .then(data => setRelatedDocs(data.documents ?? []))
      .catch(() => {})
  }, [task?.id])

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
      tasksClient
        .getById<{ task: TaskDetail }>(initialTask.id)
        .then(data => {
          if (data?.task) {
            const t = data.task
            setTask(prev => ({
              ...prev,
              description: t.description,
              project: t.project,
              reviewerActorId: t.reviewerActorId,
              assignee: t.assignee,
              reviewer: t.reviewer,
              pullRequests: t.pullRequests ?? [],
              branches: t.branches ?? [],
            }))
            desc.setDescriptionFromFetch(t.description ?? null)
            // Sync task to cache
            const taskMap =
              readCache<Record<string, ApiTask>>(CACHE_KEY.tasks) ?? {}
            writeCache(CACHE_KEY.tasks, { ...taskMap, [t.id]: t })
          }
        })
        .catch(() => {})
    }
  })

  // Re-fetch task detail (used after subtask creation)
  const refreshDetail = useCallback(async () => {
    try {
      const data = await tasksClient.getById<{ task: TaskDetail }>(
        initialTask.id
      )
      if (data?.task) {
        const t = data.task as TaskDetail
        setTask(prev => ({
          ...prev,
          description: t.description,
          project: t.project,
          reviewerActorId: t.reviewerActorId,
          assignee: t.assignee,
          reviewer: t.reviewer,
          number: t.number,
          teamIdentifier: t.teamIdentifier,
          pullRequests: t.pullRequests ?? [],
          branches: t.branches ?? [],
          children: t.children ?? [],
          parent: t.parent ?? null,
        }))
        // Notify parent to refresh the task list so new subtasks appear
        onTasksChanged?.()
      }
    } catch {
      // Network error — silently ignore, user can refresh manually
    }
  }, [initialTask.id, onTasksChanged])

  const commitDescription = useCallback(
    (html: string | null) => {
      const next = html?.trim() || null
      if (next === (task.description ?? null)) return
      handlePatch({ description: next })
      desc.setDescriptionFromFetch(next)
    },
    [task.description, handlePatch, desc]
  )

  return (
    <div className='flex-1 overflow-y-auto px-5 py-4'>
      <div className='space-y-1'>
        {/* Parent breadcrumb */}
        {task.parent && (
          <button
            onClick={navigateToParent}
            className='flex items-center gap-1 text-xs text-blue-500 hover:text-blue-600 dark:text-blue-400 dark:hover:text-blue-300 mb-1 transition-colors'
          >
            <span>↑</span>
            <span>
              {task.parent.teamIdentifier}-{task.parent.number}{' '}
              {task.parent.title}
            </span>
          </button>
        )}
        {/* Title */}
        <TypographyH3
          key={task.id}
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
          className='mb-0 cursor-text outline-none focus:outline-none'
        >
          {task.title}
        </TypographyH3>

        {/* Status · Assignee · Reviewer · Project · Priority */}
        <div className='flex items-center gap-1 flex-wrap -ml-2 mb-1'>
          <StatusSelect
            value={task.status}
            onChange={v => handlePatch({ status: v })}
            triggerClassName={FIELD_TRIGGER_CLS}
          />
          <SeparatorDot />
          <AssigneeSelect
            value={task.assigneeActorId ?? null}
            onChange={v => handlePatch({ assigneeActorId: v })}
            members={membersWithActorId}
            agentActors={agentActors ?? []}
            assignee={task.assignee}
            triggerClassName={FIELD_TRIGGER_CLS}
          />
          <SeparatorDot />
          <ReviewerSelect
            value={task.reviewerActorId ?? null}
            onChange={v => handlePatch({ reviewerActorId: v })}
            members={membersWithActorId}
            inheritedId={task.project.defaultReviewerId ?? null}
            triggerClassName={FIELD_TRIGGER_CLS}
          />
          <SeparatorDot />
          <ProjectSelect
            value={task.projectId}
            onChange={v => handlePatch({ projectId: v })}
            projects={projects}
            triggerClassName={FIELD_TRIGGER_CLS}
          />
          <SeparatorDot />
          <PrioritySelect
            value={task.priority}
            onChange={v => handlePatch({ priority: v })}
            triggerClassName={FIELD_TRIGGER_CLS}
          />
          <SeparatorDot />
          <DueDatePicker
            value={task.dueDate ?? null}
            onChange={v => handlePatch({ dueDate: v })}
            triggerClassName={FIELD_TRIGGER_CLS}
          />
          {task.parent && (
            <>
              <SeparatorDot />
              <button
                onClick={navigateToParent}
                className={cn(FIELD_TRIGGER_CLS, 'gap-1')}
              >
                <span className='text-muted-foreground text-xs'>Parent</span>
                <span className='text-xs'>
                  {task.parent.teamIdentifier}-{task.parent.number}
                </span>
              </button>
            </>
          )}
        </div>

        <div className='pt-3 border-t border-zinc-100 dark:border-zinc-800'>
          <div className='flex items-center justify-between mb-2'>
            <p className='text-xs font-medium text-zinc-400 dark:text-zinc-500 uppercase tracking-wider flex items-center gap-1.5'>
              <GitPullRequest size={12} />
              Pull Requests
            </p>
            <button
              onClick={() => setCreateBranchOpen(true)}
              className='flex items-center gap-1 text-[11px] text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 transition-colors'
            >
              <GitBranch size={11} />
              Branch
            </button>
          </div>
          {task.pullRequests && task.pullRequests.length > 0 && (
            <ul className='space-y-2'>
              {task.pullRequests.map(pr => (
                <li key={pr.id} className='flex items-start gap-2'>
                  <CiIcon status={pr.ciStatus} />
                  <div className='min-w-0 flex-1'>
                    <a
                      href={pr.url}
                      target='_blank'
                      rel='noopener noreferrer'
                      className='text-xs text-zinc-700 dark:text-zinc-300 hover:underline font-medium truncate block'
                    >
                      #{pr.number} {pr.title}
                    </a>
                    <div className='flex items-center gap-1.5 mt-0.5'>
                      <PrStateBadge state={pr.state} />
                      <span className='text-[10px] text-zinc-400 dark:text-zinc-500 font-mono truncate'>
                        {pr.headBranch}
                      </span>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {task.branches && task.branches.length > 0 && (
            <ul className='space-y-2 mt-2'>
              {task.branches.map(branch => (
                <li key={branch.id} className='flex items-start gap-2'>
                  <GitBranch
                    size={12}
                    className='text-zinc-400 shrink-0 mt-0.5'
                  />
                  <div className='min-w-0'>
                    <a
                      href={`https://github.com/${branch.repo}/tree/${branch.branchName}`}
                      target='_blank'
                      rel='noopener noreferrer'
                      className='text-xs font-mono text-zinc-600 dark:text-zinc-400 hover:underline block truncate'
                    >
                      {branch.branchName}
                    </a>
                    {branch.lastCommitMessage && (
                      <a
                        href={
                          branch.lastCommitSha
                            ? `https://github.com/${branch.repo}/commit/${branch.lastCommitSha}`
                            : undefined
                        }
                        target='_blank'
                        rel='noopener noreferrer'
                        className='text-[10px] text-zinc-400 dark:text-zinc-500 truncate block hover:underline mt-0.5'
                        title={branch.lastCommitMessage}
                      >
                        {branch.lastCommitAuthor && (
                          <span className='font-medium'>
                            {branch.lastCommitAuthor}:{' '}
                          </span>
                        )}
                        {branch.lastCommitMessage}
                      </a>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {task.assignee?.type === 'AGENT' && (
          <div className='pt-3 border-t border-zinc-100 dark:border-zinc-800'>
            <AgentPanel
              task={task}
              onTaskUpdate={updates =>
                setTask(prev => ({ ...prev, ...updates }) as TaskDetail)
              }
            />
          </div>
        )}

        <CreateBranchDialog
          isOpen={createBranchOpen}
          onClose={() => setCreateBranchOpen(false)}
          taskId={task.id}
          identifier={`${task.teamIdentifier}-${task.number}`}
          title={task.title}
          projectId={task.projectId}
          defaultRepo={
            task.project.repositories?.find(r => r.isDefault)?.fullName ??
            task.project.repositories?.[0]?.fullName ??
            null
          }
          workspaceUrl={workspaceUrl}
          onBranchCreated={branch =>
            setTask(prev => ({
              ...prev,
              branches: [...(prev.branches ?? []), branch],
            }))
          }
        />

        {/* Description */}
        <div className='pt-4'>
          {desc.descriptionLoading ? (
            <Spinner className='size-4 text-zinc-300 dark:text-zinc-600' />
          ) : (
            <>
              {!task.description && (
                <div className='mb-2'>
                  <AiDescriptionPrompt
                    title={task.title}
                    projectId={task.projectId}
                    workspaceUrl={workspaceUrl}
                    existingDescription={null}
                    onAccept={html => {
                      handlePatch({ description: html })
                      desc.setDescriptionFromFetch(html)
                    }}
                  />
                </div>
              )}
              <DescriptionEditor
                value={desc.descriptionValue}
                onCommit={commitDescription}
                members={mentionableMembers}
                tasks={tasks}
              />
              {task.description && (
                <div className='mt-1 flex justify-end'>
                  <AiDescriptionPrompt
                    title={task.title}
                    projectId={task.projectId}
                    workspaceUrl={workspaceUrl}
                    existingDescription={task.description}
                    onAccept={html => {
                      handlePatch({ description: html })
                      desc.setDescriptionFromFetch(html)
                    }}
                  />
                </div>
              )}
            </>
          )}
        </div>

        {/* Subtasks */}
        <SubtasksSection task={task} onSubtasksCreated={refreshDetail} />

        {/* Related Documents */}
        {relatedDocs.length > 0 && (
          <div className='mt-4 pt-4 border-t'>
            <div className='text-xs font-medium text-muted-foreground mb-2'>
              Related Documents
            </div>
            <div className='space-y-1'>
              {relatedDocs.map(doc => (
                <button
                  key={doc.id}
                  type='button'
                  className='flex items-center gap-2 w-full text-left text-xs py-1 px-2 rounded hover:bg-muted transition-colors'
                  onClick={() => {
                    window.location.href = `/workspace/${workspaceUrl}/documents/${doc.id}`
                  }}
                >
                  <span>{doc.emoji ?? '📄'}</span>
                  <span className='truncate'>{doc.title}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── Comments ─────────────────────────────────────────────────────────── */}
      <div className='mt-8 pt-6'>
        <p className='text-xs font-semibold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider mb-4'>
          Comments
        </p>

        {tc.commentsLoading && tc.comments.length === 0 ? (
          <div className='space-y-3'>
            {[1, 2].map(i => (
              <div key={i} className='flex gap-2.5'>
                <div className='size-7 rounded-full bg-zinc-100 dark:bg-zinc-800 animate-pulse shrink-0' />
                <div className='flex-1 space-y-1.5 pt-0.5'>
                  <div className='h-2.5 bg-zinc-100 dark:bg-zinc-800 rounded animate-pulse w-1/3' />
                  <div className='h-2.5 bg-zinc-100 dark:bg-zinc-800 rounded animate-pulse w-2/3' />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className='space-y-5'>
            {tc.comments.map(comment => {
              const ca = resolveCommentAuthor(
                comment,
                members,
                agentActors ?? []
              )
              const isAuthor =
                !ca.isAgent && comment.authorActorId === currentMember?.actorId
              const isEditing = tc.editingCommentId === comment.id
              const isDeleting = tc.deletingCommentId === comment.id
              const wasEdited =
                new Date(comment.updatedAt).getTime() -
                  new Date(comment.createdAt).getTime() >
                1000
              const isReplying = tc.replyingToId === comment.id

              return (
                <div key={comment.id}>
                  {/* ── Top-level comment ── */}
                  <div
                    id={`comment-${comment.id}`}
                    className={`group flex gap-2.5 rounded-md transition-colors duration-300 ${tc.highlightedCommentId === comment.id ? 'bg-amber-50 dark:bg-amber-950/30' : ''}`}
                  >
                    <CommentAvatar
                      isAgent={ca.isAgent}
                      imageUrl={ca.imageUrl}
                      initials={ca.initials}
                    />
                    <div className='flex-1 min-w-0'>
                      <div className='flex items-baseline gap-2 mb-1 flex-wrap'>
                        <span className='text-xs font-semibold text-zinc-800 dark:text-zinc-200'>
                          {ca.name}
                        </span>
                        <span className='text-[11px] text-zinc-400 dark:text-zinc-500'>
                          {formatTimestamp(comment.createdAt)}
                          {wasEdited && ' · edited'}
                        </span>
                      </div>

                      {isEditing ? (
                        <div className='border border-zinc-200 dark:border-zinc-800 rounded-lg overflow-hidden focus-within:ring-1 focus-within:ring-zinc-400 transition-all'>
                          <div
                            className='px-3 pt-2 pb-1 text-sm'
                            onKeyDown={e => {
                              const isMac = /Mac|iPhone|iPad/i.test(
                                navigator.platform
                              )
                              if (
                                (isMac ? e.metaKey : e.ctrlKey) &&
                                e.key === 'Enter'
                              ) {
                                e.preventDefault()
                                tc.saveEditComment(comment.id)
                              }
                              if (e.key === 'Escape') {
                                tc.cancelEditing()
                              }
                            }}
                          >
                            <DescriptionEditor
                              key={`edit-${comment.id}`}
                              value={comment.body}
                              onCommit={html => tc.setEditCommentBody(html)}
                              onChange={html => tc.setEditCommentBody(html)}
                              placeholder={intl.formatMessage({
                                id: 'task.editCommentPlaceholder',
                              })}
                              members={mentionableMembers}
                              tasks={tasks}
                              agentActors={agentActors ?? []}
                            />
                          </div>
                          <div className='flex justify-end gap-2 px-2 pb-2'>
                            <Button
                              size='sm'
                              variant='ghost'
                              className='h-7 text-xs'
                              onClick={() => tc.cancelEditing()}
                            >
                              {intl.formatMessage({ id: 'common.cancel' })}
                            </Button>
                            <Button
                              size='sm'
                              className='h-7 text-xs'
                              disabled={
                                !tc.editCommentBody?.trim() || tc.savingComment
                              }
                              onClick={() => tc.saveEditComment(comment.id)}
                            >
                              Save
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <div
                          className='prose prose-sm dark:prose-invert max-w-none text-zinc-700 dark:text-zinc-300'
                          dangerouslySetInnerHTML={{ __html: comment.body }}
                        />
                      )}
                    </div>

                    {/* Actions — visible on hover */}
                    {!isEditing && (
                      <div className='flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0 pt-0.5'>
                        {/* Copy link button */}
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              className='size-6 flex items-center justify-center rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300 transition-colors'
                              onClick={() =>
                                copyLink(
                                  `${window.location.origin}/workspace/${workspaceUrl}/project/${slugifyProjectName(task.project.name)}/tasks/${task.teamIdentifier}-${task.number}#comment-${comment.id}`
                                )
                              }
                            >
                              <LinkIcon size={12} />
                            </button>
                          </TooltipTrigger>
                          <TooltipContent>Copy link</TooltipContent>
                        </Tooltip>
                        {/* Reply button — anyone can reply */}
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              className='size-6 flex items-center justify-center rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300 transition-colors'
                              onClick={() => {
                                if (isReplying) {
                                  tc.cancelReply()
                                } else {
                                  tc.startReply(comment, ca.name)
                                }
                              }}
                            >
                              <Reply size={12} />
                            </button>
                          </TooltipTrigger>
                          <TooltipContent>Reply</TooltipContent>
                        </Tooltip>
                        {/* Edit / delete — author only */}
                        {isAuthor && (
                          <>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <button
                                  className='size-6 flex items-center justify-center rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300 transition-colors'
                                  onClick={() => {
                                    tc.startEditing(comment)
                                  }}
                                >
                                  <Pencil size={12} />
                                </button>
                              </TooltipTrigger>
                              <TooltipContent>
                                {intl.formatMessage({ id: 'common.edit' })}
                              </TooltipContent>
                            </Tooltip>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <button
                                  className='size-6 flex items-center justify-center rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-400 hover:text-red-500 transition-colors disabled:opacity-40'
                                  disabled={isDeleting}
                                  onClick={() =>
                                    tc.setConfirmDeleteId(comment.id)
                                  }
                                >
                                  {isDeleting ? (
                                    <Spinner className='size-3 text-zinc-400' />
                                  ) : (
                                    <Trash2 size={12} />
                                  )}
                                </button>
                              </TooltipTrigger>
                              <TooltipContent>
                                {intl.formatMessage({ id: 'common.delete' })}
                              </TooltipContent>
                            </Tooltip>
                          </>
                        )}
                      </div>
                    )}
                  </div>

                  {/* ── Replies ── */}
                  {(comment.replies?.length ?? 0) > 0 && (
                    <div className='ml-9 mt-3 space-y-3 border-l-2 border-zinc-100 dark:border-zinc-800 pl-3'>
                      {comment.replies!.map(reply => {
                        const ra = resolveCommentAuthor(
                          reply,
                          members,
                          agentActors ?? []
                        )
                        const rIsAuthor =
                          !ra.isAgent &&
                          reply.authorActorId === currentMember?.actorId
                        const rIsEditing = tc.editingCommentId === reply.id
                        const rIsDeleting = tc.deletingCommentId === reply.id
                        const rWasEdited =
                          new Date(reply.updatedAt).getTime() -
                            new Date(reply.createdAt).getTime() >
                          1000
                        return (
                          <div
                            key={reply.id}
                            id={`comment-${reply.id}`}
                            className={`group flex gap-2 rounded-md transition-colors duration-300 ${tc.highlightedCommentId === reply.id ? 'bg-amber-50 dark:bg-amber-950/30' : ''}`}
                          >
                            <CommentAvatar
                              isAgent={ra.isAgent}
                              imageUrl={ra.imageUrl}
                              initials={ra.initials}
                              size='sm'
                            />
                            <div className='flex-1 min-w-0'>
                              <div className='flex items-baseline gap-1.5 mb-0.5 flex-wrap'>
                                <span className='text-xs font-semibold text-zinc-800 dark:text-zinc-200'>
                                  {ra.name}
                                </span>
                                <span className='text-[11px] text-zinc-400 dark:text-zinc-500'>
                                  {formatTimestamp(reply.createdAt)}
                                  {rWasEdited && ' · edited'}
                                </span>
                              </div>
                              {rIsEditing ? (
                                <div className='border border-zinc-200 dark:border-zinc-800 rounded-lg overflow-hidden focus-within:ring-1 focus-within:ring-zinc-400 transition-all'>
                                  <div
                                    className='px-3 pt-2 pb-1 text-sm'
                                    onKeyDown={e => {
                                      const isMac = /Mac|iPhone|iPad/i.test(
                                        navigator.platform
                                      )
                                      if (
                                        (isMac ? e.metaKey : e.ctrlKey) &&
                                        e.key === 'Enter'
                                      ) {
                                        e.preventDefault()
                                        tc.saveEditComment(reply.id)
                                      }
                                      if (e.key === 'Escape') {
                                        tc.cancelEditing()
                                      }
                                    }}
                                  >
                                    <DescriptionEditor
                                      key={`edit-reply-${reply.id}`}
                                      value={reply.body}
                                      onCommit={html =>
                                        tc.setEditCommentBody(html)
                                      }
                                      onChange={html =>
                                        tc.setEditCommentBody(html)
                                      }
                                      placeholder={intl.formatMessage({
                                        id: 'task.editReplyPlaceholder',
                                      })}
                                      members={mentionableMembers}
                                      tasks={tasks}
                                      agentActors={agentActors ?? []}
                                    />
                                  </div>
                                  <div className='flex justify-end gap-2 px-2 pb-2'>
                                    <Button
                                      size='sm'
                                      variant='ghost'
                                      className='h-7 text-xs'
                                      onClick={() => tc.cancelEditing()}
                                    >
                                      {intl.formatMessage({
                                        id: 'common.cancel',
                                      })}
                                    </Button>
                                    <Button
                                      size='sm'
                                      className='h-7 text-xs'
                                      disabled={
                                        !tc.editCommentBody?.trim() ||
                                        tc.savingComment
                                      }
                                      onClick={() =>
                                        tc.saveEditComment(reply.id)
                                      }
                                    >
                                      Save
                                    </Button>
                                  </div>
                                </div>
                              ) : (
                                <>
                                  {/* Quote block — shown when this reply references a specific comment */}
                                  {reply.quotedCommentId &&
                                    (() => {
                                      // Resolve quoted comment from the loaded tree
                                      const allComments = [
                                        comment,
                                        ...(comment.replies ?? []),
                                      ]
                                      const quoted = allComments.find(
                                        c => c.id === reply.quotedCommentId
                                      )
                                      if (!quoted) return null
                                      const qAuthor = members.find(
                                        m => m.actorId === quoted.authorActorId
                                      )
                                      const qName = qAuthor?.name ?? 'Unknown'
                                      const qText = (() => {
                                        if (typeof document !== 'undefined') {
                                          const d =
                                            document.createElement('div')
                                          d.innerHTML = quoted.body
                                          return (
                                            (d.textContent ?? d.innerText ?? '')
                                              .trim()
                                              .slice(0, 120) || '…'
                                          )
                                        }
                                        return quoted.body
                                          .replace(/<[^>]+>/g, '')
                                          .slice(0, 120)
                                      })()
                                      return (
                                        <button
                                          type='button'
                                          onClick={() =>
                                            tc.scrollToComment(
                                              reply.quotedCommentId!
                                            )
                                          }
                                          className='mb-1.5 w-full text-left border-l-2 border-zinc-300 dark:border-zinc-600 pl-2.5 py-0.5 hover:border-zinc-400 dark:hover:border-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 rounded-r transition-colors'
                                        >
                                          <p className='text-[11px] font-semibold text-zinc-500 dark:text-zinc-400 mb-0.5'>
                                            {qName}
                                          </p>
                                          <p className='text-[11px] text-zinc-400 dark:text-zinc-500 line-clamp-2 leading-relaxed'>
                                            {qText}
                                          </p>
                                        </button>
                                      )
                                    })()}
                                  <div
                                    className='prose prose-sm dark:prose-invert max-w-none text-zinc-700 dark:text-zinc-300'
                                    dangerouslySetInnerHTML={{
                                      __html: reply.body,
                                    }}
                                  />
                                </>
                              )}
                            </div>
                            {!rIsEditing && (
                              <div className='flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0 pt-0.5'>
                                {/* Copy link button */}
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <button
                                      className='size-6 flex items-center justify-center rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300 transition-colors'
                                      onClick={() =>
                                        copyLink(
                                          `${window.location.origin}/workspace/${workspaceUrl}/project/${slugifyProjectName(task.project.name)}/tasks/${task.teamIdentifier}-${task.number}#comment-${reply.id}`
                                        )
                                      }
                                    >
                                      <LinkIcon size={12} />
                                    </button>
                                  </TooltipTrigger>
                                  <TooltipContent>Copy link</TooltipContent>
                                </Tooltip>
                                {/* Reply in the same thread */}
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <button
                                      className='size-6 flex items-center justify-center rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300 transition-colors'
                                      onClick={() => {
                                        if (tc.replyingToId === comment.id) {
                                          tc.cancelReply()
                                        } else {
                                          tc.startReply(reply, ra.name)
                                        }
                                      }}
                                    >
                                      <Reply size={12} />
                                    </button>
                                  </TooltipTrigger>
                                  <TooltipContent>Reply</TooltipContent>
                                </Tooltip>
                                {/* Edit / delete — author only */}
                                {rIsAuthor && (
                                  <>
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <button
                                          className='size-6 flex items-center justify-center rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300 transition-colors'
                                          onClick={() => {
                                            tc.startEditing(reply)
                                          }}
                                        >
                                          <Pencil size={12} />
                                        </button>
                                      </TooltipTrigger>
                                      <TooltipContent>
                                        {intl.formatMessage({
                                          id: 'common.edit',
                                        })}
                                      </TooltipContent>
                                    </Tooltip>
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <button
                                          className='size-6 flex items-center justify-center rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-400 hover:text-red-500 transition-colors disabled:opacity-40'
                                          disabled={rIsDeleting}
                                          onClick={() =>
                                            tc.setConfirmDeleteId(reply.id)
                                          }
                                        >
                                          {rIsDeleting ? (
                                            <Spinner className='size-3 text-zinc-400' />
                                          ) : (
                                            <Trash2 size={12} />
                                          )}
                                        </button>
                                      </TooltipTrigger>
                                      <TooltipContent>
                                        {intl.formatMessage({
                                          id: 'common.delete',
                                        })}
                                      </TooltipContent>
                                    </Tooltip>
                                  </>
                                )}
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}

                  {/* ── Inline reply input ── */}
                  {isReplying && (
                    <div className='ml-9 mt-3 flex gap-2'>
                      <Avatar className='size-5 shrink-0 mt-0.5'>
                        <AvatarImage src={user?.imageUrl} />
                        <AvatarFallback className='text-[9px]'>
                          {user?.initials ?? '?'}
                        </AvatarFallback>
                      </Avatar>
                      <div className='flex-1 min-w-0 border border-zinc-200 dark:border-zinc-800 rounded-lg overflow-hidden focus-within:ring-1 focus-within:ring-zinc-400 transition-all'>
                        {/* Quote block */}
                        {tc.replyingToComment && (
                          <button
                            type='button'
                            onClick={() =>
                              tc.scrollToComment(tc.replyingToComment!.id)
                            }
                            className='mx-3 mt-2.5 mb-1 w-[calc(100%-1.5rem)] text-left border-l-2 border-zinc-300 dark:border-zinc-600 pl-2.5 py-0.5 hover:border-zinc-400 dark:hover:border-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 rounded-r transition-colors'
                          >
                            <p className='text-[11px] font-semibold text-zinc-500 dark:text-zinc-400 mb-0.5'>
                              {tc.replyingToComment.authorName}
                            </p>
                            <p className='text-[11px] text-zinc-400 dark:text-zinc-500 line-clamp-2 leading-relaxed'>
                              {typeof document !== 'undefined'
                                ? (() => {
                                    const d = document.createElement('div')
                                    d.innerHTML = tc.replyingToComment.body
                                    return (
                                      (d.textContent ?? d.innerText ?? '')
                                        .trim()
                                        .slice(0, 120) || '…'
                                    )
                                  })()
                                : tc.replyingToComment.body
                                    .replace(/<[^>]+>/g, '')
                                    .slice(0, 120)}
                            </p>
                          </button>
                        )}
                        <CommentEditor
                          onCommit={html => tc.setReplyBody(html)}
                          onSubmit={() => tc.submitReply(comment.id)}
                          clearRef={tc.clearReplyRef}
                          members={mentionableMembers}
                          tasks={tasks}
                          agentActors={agentActors ?? []}
                        />
                        <div className='flex items-center justify-between px-2 pb-2'>
                          <button
                            className='text-[11px] text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors'
                            onClick={() => {
                              tc.cancelReply()
                            }}
                          >
                            {intl.formatMessage({ id: 'common.cancel' })}
                          </button>
                          <Button
                            size='sm'
                            className='h-7 text-xs gap-1.5'
                            disabled={
                              !tc.replyBody?.trim() || tc.submittingReply
                            }
                            onClick={() => tc.submitReply(comment.id)}
                          >
                            <Send size={12} />
                            Reply
                            <kbd className='ml-0.5 text-[10px] opacity-60 font-sans'>
                              {typeof navigator !== 'undefined' &&
                              /Mac|iPhone|iPad/i.test(navigator.platform)
                                ? '⌘↵'
                                : 'Ctrl+↵'}
                            </kbd>
                          </Button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {/* New comment input */}
        <div className='mt-5 flex gap-2.5'>
          <Avatar className='size-7 shrink-0 mt-0.5'>
            <AvatarImage src={user?.imageUrl} />
            <AvatarFallback className='text-[10px]'>
              {user?.initials ?? '?'}
            </AvatarFallback>
          </Avatar>
          <div className='flex-1 min-w-0 border border-zinc-200 dark:border-zinc-800 rounded-lg overflow-hidden focus-within:ring-1 focus-within:ring-zinc-400 transition-all'>
            <CommentEditor
              onCommit={html => tc.setCommentBody(html)}
              onSubmit={tc.submitComment}
              clearRef={tc.clearCommentRef}
              members={mentionableMembers}
              tasks={tasks}
              agentActors={agentActors ?? []}
            />
            <div className='flex justify-end px-2 pb-2'>
              <Button
                size='sm'
                className='h-7 text-xs gap-1.5'
                disabled={!tc.commentBody?.trim() || tc.submitting}
                onClick={tc.submitComment}
              >
                <Send size={12} />
                Comment
                <kbd className='ml-0.5 text-[10px] opacity-60 font-sans'>
                  {typeof navigator !== 'undefined' &&
                  /Mac|iPhone|iPad/i.test(navigator.platform)
                    ? '⌘↵'
                    : 'Ctrl+↵'}
                </kbd>
              </Button>
            </div>
          </div>
        </div>
      </div>

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
    </div>
  )
}
