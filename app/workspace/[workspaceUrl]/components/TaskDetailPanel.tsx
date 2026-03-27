'use client'

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import {
  Send,
  Pencil,
  Trash2,
  Reply,
  Link as LinkIcon,
  CheckCircle2,
  XCircle,
  GitPullRequest,
  Loader2,
} from 'lucide-react'
import { useParams } from 'next/navigation'
import { formatTimestamp } from '../utils'
import { copyLink } from '../utils/copyLink'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import {
  TaskDetail,
  ApiTask,
  ApiComment,
  MyTask,
  ApiStatus,
  ApiPriority,
  WorkspaceMemberInfo,
  ApiProject,
  ApiPullRequest,
} from '../types'
import { DescriptionEditor } from './DescriptionEditor'
import { TypographyH3 } from '@/components/ui/typography'
import {
  StatusSelect,
  AssigneeSelect,
  ReviewerSelect,
  ProjectSelect,
  PrioritySelect,
  SeparatorDot,
  FIELD_TRIGGER_CLS,
} from './TaskFieldSelects'
import { Spinner } from '@/components/ui/spinner'
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
import { API, CACHE_KEY } from '../constants'
import { readCache, writeCache } from '../cache'
import { useUser } from '@clerk/nextjs'

// ─── PR helpers ──────────────────────────────────────────────────────────────

function PrStateBadge({ state }: { state: string }) {
  if (state === 'merged') {
    return (
      <span className='inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300'>
        Merged
      </span>
    )
  }
  if (state === 'closed') {
    return (
      <span className='inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400'>
        Closed
      </span>
    )
  }
  return (
    <span className='inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'>
      Open
    </span>
  )
}

function CiIcon({ status }: { status: string | null }) {
  if (status === 'success')
    return <CheckCircle2 size={13} className='text-emerald-500 shrink-0' />
  if (status === 'failure')
    return <XCircle size={13} className='text-red-500 shrink-0' />
  if (status === 'pending')
    return <Loader2 size={13} className='text-zinc-400 shrink-0 animate-spin' />
  return null
}

// ─── Comment editor (key-based clear + Cmd/Ctrl+Enter submit) ────────────────

function CommentEditor({
  onCommit,
  onSubmit,
  clearRef,
  members,
  tasks,
}: {
  onCommit: (html: string | null) => void
  onSubmit: () => void
  clearRef: React.MutableRefObject<(() => void) | null>
  members?: WorkspaceMemberInfo[]
  tasks?: ApiTask[]
}) {
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
        placeholder='Add a comment…'
        {...(members ? { members } : {})}
        {...(tasks ? { tasks } : {})}
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
  projects: ApiProject[]
  onUpdate: (
    taskId: string,
    data: Partial<{
      title: string
      status: ApiStatus
      assigneeId: string | null
      reviewerId: string | null
      description: string | null
      projectId: string
      priority: ApiPriority
    }>
  ) => Promise<void>
  onDescriptionLoaded?:
    | ((taskId: string, description: string | null) => void)
    | undefined
  tasks?: ApiTask[]
}

export function TaskDetailPanel({
  initialTask,
  liveTask,
  cachedDescription,
  members,
  projects,
  onUpdate,
  onDescriptionLoaded,
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
    assigneeId: initialTask.assigneeId,
    reviewerId: initialTask.reviewerId,
    assignee: null,
    description: cachedDescription ?? null,
    updatedAt: initialTask.updatedAt,
    number: initialTask.number,
    teamIdentifier: initialTask.teamIdentifier,
  }))
  const { user } = useUser()
  const { workspaceUrl } = useParams<{ workspaceUrl: string }>()
  const mentionableMembers = members.filter(m => m.clerkId !== user?.id)

  // ─── Sync external updates (e.g. drag-and-drop status change) ───────────────
  useEffect(() => {
    if (!liveTask) return
    setTask(prev => {
      if (
        prev.title === liveTask.title &&
        prev.status === liveTask.status &&
        prev.priority === liveTask.priority &&
        prev.assigneeId === liveTask.assigneeId &&
        prev.reviewerId === liveTask.reviewerId &&
        prev.projectId === liveTask.projectId
      )
        return prev
      return {
        ...prev,
        title: liveTask.title,
        status: liveTask.status,
        priority: liveTask.priority,
        assigneeId: liveTask.assigneeId,
        reviewerId: liveTask.reviewerId,
        projectId: liveTask.projectId,
      }
    })
  }, [liveTask])

  // ─── Comments (stale-while-revalidate from localStorage) ─────────────────────
  const cachedComments = useMemo(
    () => readCache<ApiComment[]>(CACHE_KEY.comments(initialTask.id)) ?? null,

    [initialTask.id]
  )
  const [comments, setComments] = useState<ApiComment[]>(cachedComments ?? [])
  const [commentsLoading, setCommentsLoading] = useState(
    cachedComments === null
  )
  const [commentBody, setCommentBody] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const clearCommentRef = useRef<(() => void) | null>(null)
  // ─── Comment edit / delete ─────────────────────────────────────────────────
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null)
  const [editCommentBody, setEditCommentBody] = useState<string | null>(null)
  const [savingComment, setSavingComment] = useState(false)
  const [deletingCommentId, setDeletingCommentId] = useState<string | null>(
    null
  )
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  // ─── Comment threads (replies) ──────────────────────────────────────────────
  const [highlightedCommentId, setHighlightedCommentId] = useState<
    string | null
  >(null)
  const [replyingToId, setReplyingToId] = useState<string | null>(null)
  /** The specific comment being quoted — id + author + raw HTML body for preview. */
  const [replyingToComment, setReplyingToComment] = useState<{
    id: string
    authorName: string
    body: string
  } | null>(null)
  const [replyBody, setReplyBody] = useState<string | null>(null)
  const [submittingReply, setSubmittingReply] = useState(false)
  const clearReplyRef = useRef<(() => void) | null>(null)

  // ─── Description ────────────────────────────────────────────────────────────
  const hasCached = cachedDescription !== undefined
  const [descriptionValue, setDescriptionValue] = useState<string | null>(
    hasCached ? cachedDescription : null
  )
  const [descriptionLoading, setDescriptionLoading] = useState(!hasCached)

  // Fetch full task detail + comments
  useEffect(() => {
    if (!hasCached) setDescriptionLoading(true)
    if (cachedComments === null) setCommentsLoading(true)

    Promise.all([
      fetch(API.tasks.byId(initialTask.id)).then(r => r.json()),
      fetch(API.tasks.comments(initialTask.id)).then(r =>
        r.ok ? r.json() : { comments: [] }
      ),
    ])
      .then(([taskData, commentsData]) => {
        if (taskData.task) {
          const t = taskData.task as TaskDetail
          setTask(prev => ({
            ...prev,
            description: t.description,
            project: t.project,
            reviewerId: t.reviewerId,
            number: t.number,
            teamIdentifier: t.teamIdentifier,
          }))
          setDescriptionValue(t.description ?? null)
          onDescriptionLoaded?.(t.id, t.description ?? null)
        }
        const freshComments =
          (commentsData as { comments: ApiComment[] }).comments ?? []
        setComments(freshComments)
        writeCache(CACHE_KEY.comments(initialTask.id), freshComments)
      })
      .catch(console.error)
      .finally(() => {
        setDescriptionLoading(false)
        setCommentsLoading(false)
      })
    // cachedComments intentionally omitted — stable ref from mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialTask.id])

  const handlePatch = useCallback(
    async (
      data: Partial<{
        title: string
        status: ApiStatus
        assigneeId: string | null
        reviewerId: string | null
        description: string | null
        projectId: string
        priority: ApiPriority
      }>
    ) => {
      const snapshot = task
      const localUpdate = { ...task, ...data }
      if (data.projectId) {
        const newProject = projects.find(p => p.id === data.projectId)
        if (newProject)
          localUpdate.project = { id: newProject.id, name: newProject.name }
      }
      setTask(localUpdate)
      try {
        await onUpdate(task.id, data)
      } catch {
        setTask(snapshot)
      }
    },
    [task, onUpdate, projects]
  )

  const commitDescription = useCallback(
    (html: string | null) => {
      const next = html?.trim() || null
      if (next === (task.description ?? null)) return
      handlePatch({ description: next })
      // Sync description cache immediately (optimistic, matches handlePatch)
      onDescriptionLoaded?.(task.id, next)
    },
    [task.description, task.id, handlePatch, onDescriptionLoaded]
  )

  const submitComment = useCallback(async () => {
    const body = commentBody?.trim()
    if (!body || submitting) return
    setSubmitting(true)

    const tempId = `optimistic-${Date.now()}`
    const optimistic: ApiComment = {
      id: tempId,
      taskId: task.id,
      authorId: user?.id ?? '',
      body,
      parentId: null,
      quotedCommentId: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    setComments(prev => [...prev, optimistic])
    setCommentBody(null)
    clearCommentRef.current?.()

    try {
      const res = await fetch(API.tasks.comments(task.id), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body }),
      })
      if (!res.ok) throw new Error()
      const { comment } = (await res.json()) as { comment: ApiComment }
      setComments(prev => {
        const next = prev.map(c => (c.id === tempId ? comment : c))
        writeCache(CACHE_KEY.comments(task.id), next)
        return next
      })
    } catch {
      setComments(prev => prev.filter(c => c.id !== tempId))
    } finally {
      setSubmitting(false)
    }
  }, [commentBody, submitting, task.id, user?.id])

  // Helper: apply a transform to any comment in the 2-level tree.
  // transform returns the updated comment or null to remove it.
  const mapCommentTree = useCallback(
    (
      prev: ApiComment[],
      id: string,
      transform: (c: ApiComment) => ApiComment | null
    ): ApiComment[] =>
      prev.flatMap(c => {
        if (c.id === id) {
          const updated = transform(c)
          return updated ? [updated] : []
        }
        if (c.replies?.length) {
          const newReplies = c.replies.flatMap(r => {
            if (r.id === id) {
              const updated = transform(r)
              return updated ? [updated] : []
            }
            return [r]
          })
          return [{ ...c, replies: newReplies }]
        }
        return [c]
      }),
    []
  )

  // Scroll to a comment by id and briefly highlight it
  const scrollToComment = useCallback((commentId: string) => {
    const el = document.getElementById(`comment-${commentId}`)
    if (!el) return
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    setHighlightedCommentId(commentId)
    setTimeout(() => setHighlightedCommentId(null), 1500)
  }, [])

  const submitReply = useCallback(
    async (parentId: string) => {
      const body = replyBody?.trim()
      if (!body || submittingReply) return
      setSubmittingReply(true)

      const quotedCommentId = replyingToComment?.id ?? null
      const tempId = `optimistic-reply-${Date.now()}`
      const optimistic: ApiComment = {
        id: tempId,
        taskId: task.id,
        authorId: user?.id ?? '',
        body,
        parentId,
        quotedCommentId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }
      setComments(prev => {
        const next = prev.map(c =>
          c.id === parentId
            ? { ...c, replies: [...(c.replies ?? []), optimistic] }
            : c
        )
        writeCache(CACHE_KEY.comments(task.id), next)
        return next
      })
      setReplyBody(null)
      clearReplyRef.current?.()
      setReplyingToId(null)
      setReplyingToComment(null)

      try {
        const res = await fetch(API.tasks.comments(task.id), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ body, parentId, quotedCommentId }),
        })
        if (!res.ok) throw new Error()
        const { comment } = (await res.json()) as { comment: ApiComment }
        setComments(prev => {
          const next = mapCommentTree(prev, tempId, () => comment)
          writeCache(CACHE_KEY.comments(task.id), next)
          return next
        })
      } catch {
        setComments(prev => {
          const next = mapCommentTree(prev, tempId, () => null)
          writeCache(CACHE_KEY.comments(task.id), next)
          return next
        })
      } finally {
        setSubmittingReply(false)
      }
    },
    [replyBody, submittingReply, task.id, user?.id, mapCommentTree]
  )

  const saveEditComment = useCallback(
    async (commentId: string) => {
      const body = editCommentBody?.trim()
      if (!body || savingComment) return
      setSavingComment(true)
      try {
        const res = await fetch(API.tasks.comment(task.id, commentId), {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ body }),
        })
        if (!res.ok) throw new Error()
        const { comment } = (await res.json()) as { comment: ApiComment }
        setComments(prev => {
          const next = mapCommentTree(prev, commentId, () => comment)
          writeCache(CACHE_KEY.comments(task.id), next)
          return next
        })
        setEditingCommentId(null)
        setEditCommentBody(null)
      } catch {
        // keep editing state so the user can retry
      } finally {
        setSavingComment(false)
      }
    },
    [editCommentBody, savingComment, task.id, mapCommentTree]
  )

  const deleteComment = useCallback(
    async (commentId: string) => {
      setDeletingCommentId(commentId)
      try {
        const res = await fetch(API.tasks.comment(task.id, commentId), {
          method: 'DELETE',
        })
        if (!res.ok) throw new Error()
        setComments(prev => {
          const next = mapCommentTree(prev, commentId, () => null)
          writeCache(CACHE_KEY.comments(task.id), next)
          return next
        })
      } catch {
        // silently keep the comment on failure
      } finally {
        setDeletingCommentId(null)
      }
    },
    [task.id, mapCommentTree]
  )

  return (
    <div className='flex-1 overflow-y-auto px-5 py-4'>
      <div className='space-y-1'>
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
            value={task.assigneeId ?? null}
            onChange={v => handlePatch({ assigneeId: v })}
            members={members}
            triggerClassName={FIELD_TRIGGER_CLS}
          />
          <SeparatorDot />
          <ReviewerSelect
            value={task.reviewerId ?? null}
            onChange={v => handlePatch({ reviewerId: v })}
            members={members}
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
        </div>

        {task.pullRequests && task.pullRequests.length > 0 && (
          <div className='pt-3 border-t border-zinc-100 dark:border-zinc-800'>
            <p className='text-xs font-medium text-zinc-400 dark:text-zinc-500 uppercase tracking-wider mb-2 flex items-center gap-1.5'>
              <GitPullRequest size={12} />
              Pull Requests
            </p>
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
          </div>
        )}

        {/* Description */}
        <div className='pt-4'>
          {descriptionLoading ? (
            <Spinner className='size-4 text-zinc-300 dark:text-zinc-600' />
          ) : (
            <DescriptionEditor
              value={descriptionValue}
              onCommit={commitDescription}
              members={mentionableMembers}
              tasks={tasks}
            />
          )}
        </div>
      </div>

      {/* ── Comments ─────────────────────────────────────────────────────────── */}
      <div className='mt-8 pt-6'>
        <p className='text-xs font-semibold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider mb-4'>
          Comments
        </p>

        {commentsLoading && comments.length === 0 ? (
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
            {comments.map(comment => {
              const author = members.find(m => m.clerkId === comment.authorId)
              const name = author?.name ?? 'Unknown'
              const initials = name
                .split(' ')
                .map((n: string) => n[0])
                .join('')
                .slice(0, 2)
                .toUpperCase()
              const isAuthor = comment.authorId === user?.id
              const isEditing = editingCommentId === comment.id
              const isDeleting = deletingCommentId === comment.id
              const wasEdited =
                new Date(comment.updatedAt).getTime() -
                  new Date(comment.createdAt).getTime() >
                1000
              const isReplying = replyingToId === comment.id

              return (
                <div key={comment.id}>
                  {/* ── Top-level comment ── */}
                  <div
                    id={`comment-${comment.id}`}
                    className={`group flex gap-2.5 rounded-md transition-colors duration-300 ${highlightedCommentId === comment.id ? 'bg-amber-50 dark:bg-amber-950/30' : ''}`}
                  >
                    <Avatar className='size-7 shrink-0 mt-0.5'>
                      <AvatarImage src={author?.imageUrl ?? undefined} />
                      <AvatarFallback className='text-[10px]'>
                        {initials}
                      </AvatarFallback>
                    </Avatar>
                    <div className='flex-1 min-w-0'>
                      <div className='flex items-baseline gap-2 mb-1 flex-wrap'>
                        <span className='text-xs font-semibold text-zinc-800 dark:text-zinc-200'>
                          {name}
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
                                saveEditComment(comment.id)
                              }
                              if (e.key === 'Escape') {
                                setEditingCommentId(null)
                                setEditCommentBody(null)
                              }
                            }}
                          >
                            <DescriptionEditor
                              key={`edit-${comment.id}`}
                              value={comment.body}
                              onCommit={html => setEditCommentBody(html)}
                              onChange={html => setEditCommentBody(html)}
                              placeholder='Edit comment…'
                              members={mentionableMembers}
                              tasks={tasks}
                            />
                          </div>
                          <div className='flex justify-end gap-2 px-2 pb-2'>
                            <Button
                              size='sm'
                              variant='ghost'
                              className='h-7 text-xs'
                              onClick={() => {
                                setEditingCommentId(null)
                                setEditCommentBody(null)
                              }}
                            >
                              Cancel
                            </Button>
                            <Button
                              size='sm'
                              className='h-7 text-xs'
                              disabled={
                                !editCommentBody?.trim() || savingComment
                              }
                              onClick={() => saveEditComment(comment.id)}
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
                                  `${window.location.origin}/workspace/${workspaceUrl}/tasks/${task.teamIdentifier}-${task.number}#comment-${comment.id}`
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
                                  setReplyingToId(null)
                                  setReplyingToComment(null)
                                } else {
                                  setReplyingToId(comment.id)
                                  setReplyingToComment({
                                    id: comment.id,
                                    authorName: name,
                                    body: comment.body,
                                  })
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
                                    setEditingCommentId(comment.id)
                                    setEditCommentBody(comment.body)
                                  }}
                                >
                                  <Pencil size={12} />
                                </button>
                              </TooltipTrigger>
                              <TooltipContent>Edit</TooltipContent>
                            </Tooltip>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <button
                                  className='size-6 flex items-center justify-center rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-400 hover:text-red-500 transition-colors disabled:opacity-40'
                                  disabled={isDeleting}
                                  onClick={() => setConfirmDeleteId(comment.id)}
                                >
                                  {isDeleting ? (
                                    <Spinner className='size-3 text-zinc-400' />
                                  ) : (
                                    <Trash2 size={12} />
                                  )}
                                </button>
                              </TooltipTrigger>
                              <TooltipContent>Delete</TooltipContent>
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
                        const rAuthor = members.find(
                          m => m.clerkId === reply.authorId
                        )
                        const rName = rAuthor?.name ?? 'Unknown'
                        const rInitials = rName
                          .split(' ')
                          .map((n: string) => n[0])
                          .join('')
                          .slice(0, 2)
                          .toUpperCase()
                        const rIsAuthor = reply.authorId === user?.id
                        const rIsEditing = editingCommentId === reply.id
                        const rIsDeleting = deletingCommentId === reply.id
                        const rWasEdited =
                          new Date(reply.updatedAt).getTime() -
                            new Date(reply.createdAt).getTime() >
                          1000
                        return (
                          <div
                            key={reply.id}
                            id={`comment-${reply.id}`}
                            className={`group flex gap-2 rounded-md transition-colors duration-300 ${highlightedCommentId === reply.id ? 'bg-amber-50 dark:bg-amber-950/30' : ''}`}
                          >
                            <Avatar className='size-5 shrink-0 mt-0.5'>
                              <AvatarImage
                                src={rAuthor?.imageUrl ?? undefined}
                              />
                              <AvatarFallback className='text-[9px]'>
                                {rInitials}
                              </AvatarFallback>
                            </Avatar>
                            <div className='flex-1 min-w-0'>
                              <div className='flex items-baseline gap-1.5 mb-0.5 flex-wrap'>
                                <span className='text-xs font-semibold text-zinc-800 dark:text-zinc-200'>
                                  {rName}
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
                                        saveEditComment(reply.id)
                                      }
                                      if (e.key === 'Escape') {
                                        setEditingCommentId(null)
                                        setEditCommentBody(null)
                                      }
                                    }}
                                  >
                                    <DescriptionEditor
                                      key={`edit-reply-${reply.id}`}
                                      value={reply.body}
                                      onCommit={html =>
                                        setEditCommentBody(html)
                                      }
                                      onChange={html =>
                                        setEditCommentBody(html)
                                      }
                                      placeholder='Edit reply…'
                                      members={mentionableMembers}
                                      tasks={tasks}
                                    />
                                  </div>
                                  <div className='flex justify-end gap-2 px-2 pb-2'>
                                    <Button
                                      size='sm'
                                      variant='ghost'
                                      className='h-7 text-xs'
                                      onClick={() => {
                                        setEditingCommentId(null)
                                        setEditCommentBody(null)
                                      }}
                                    >
                                      Cancel
                                    </Button>
                                    <Button
                                      size='sm'
                                      className='h-7 text-xs'
                                      disabled={
                                        !editCommentBody?.trim() ||
                                        savingComment
                                      }
                                      onClick={() => saveEditComment(reply.id)}
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
                                        m => m.clerkId === quoted.authorId
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
                                            scrollToComment(
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
                                          `${window.location.origin}/workspace/${workspaceUrl}/tasks/${task.teamIdentifier}-${task.number}#comment-${reply.id}`
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
                                        if (replyingToId === comment.id) {
                                          setReplyingToId(null)
                                          setReplyingToComment(null)
                                        } else {
                                          setReplyingToId(comment.id)
                                          setReplyingToComment({
                                            id: reply.id,
                                            authorName: rName,
                                            body: reply.body,
                                          })
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
                                            setEditingCommentId(reply.id)
                                            setEditCommentBody(reply.body)
                                          }}
                                        >
                                          <Pencil size={12} />
                                        </button>
                                      </TooltipTrigger>
                                      <TooltipContent>Edit</TooltipContent>
                                    </Tooltip>
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <button
                                          className='size-6 flex items-center justify-center rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-400 hover:text-red-500 transition-colors disabled:opacity-40'
                                          disabled={rIsDeleting}
                                          onClick={() =>
                                            setConfirmDeleteId(reply.id)
                                          }
                                        >
                                          {rIsDeleting ? (
                                            <Spinner className='size-3 text-zinc-400' />
                                          ) : (
                                            <Trash2 size={12} />
                                          )}
                                        </button>
                                      </TooltipTrigger>
                                      <TooltipContent>Delete</TooltipContent>
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
                          {(
                            user?.firstName?.[0] ??
                            user?.emailAddresses?.[0]?.emailAddress?.[0] ??
                            '?'
                          ).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <div className='flex-1 min-w-0 border border-zinc-200 dark:border-zinc-800 rounded-lg overflow-hidden focus-within:ring-1 focus-within:ring-zinc-400 transition-all'>
                        {/* Quote block */}
                        {replyingToComment && (
                          <button
                            type='button'
                            onClick={() =>
                              scrollToComment(replyingToComment.id)
                            }
                            className='mx-3 mt-2.5 mb-1 w-[calc(100%-1.5rem)] text-left border-l-2 border-zinc-300 dark:border-zinc-600 pl-2.5 py-0.5 hover:border-zinc-400 dark:hover:border-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 rounded-r transition-colors'
                          >
                            <p className='text-[11px] font-semibold text-zinc-500 dark:text-zinc-400 mb-0.5'>
                              {replyingToComment.authorName}
                            </p>
                            <p className='text-[11px] text-zinc-400 dark:text-zinc-500 line-clamp-2 leading-relaxed'>
                              {typeof document !== 'undefined'
                                ? (() => {
                                    const d = document.createElement('div')
                                    d.innerHTML = replyingToComment.body
                                    return (
                                      (d.textContent ?? d.innerText ?? '')
                                        .trim()
                                        .slice(0, 120) || '…'
                                    )
                                  })()
                                : replyingToComment.body
                                    .replace(/<[^>]+>/g, '')
                                    .slice(0, 120)}
                            </p>
                          </button>
                        )}
                        <CommentEditor
                          onCommit={html => setReplyBody(html)}
                          onSubmit={() => submitReply(comment.id)}
                          clearRef={clearReplyRef}
                          members={mentionableMembers}
                          tasks={tasks}
                        />
                        <div className='flex items-center justify-between px-2 pb-2'>
                          <button
                            className='text-[11px] text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors'
                            onClick={() => {
                              setReplyingToId(null)
                              setReplyBody(null)
                              setReplyingToComment(null)
                            }}
                          >
                            Cancel
                          </button>
                          <Button
                            size='sm'
                            className='h-7 text-xs gap-1.5'
                            disabled={!replyBody?.trim() || submittingReply}
                            onClick={() => submitReply(comment.id)}
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
              {(
                user?.firstName?.[0] ??
                user?.emailAddresses?.[0]?.emailAddress?.[0] ??
                '?'
              ).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <div className='flex-1 min-w-0 border border-zinc-200 dark:border-zinc-800 rounded-lg overflow-hidden focus-within:ring-1 focus-within:ring-zinc-400 transition-all'>
            <CommentEditor
              onCommit={html => setCommentBody(html)}
              onSubmit={submitComment}
              clearRef={clearCommentRef}
              members={mentionableMembers}
              tasks={tasks}
            />
            <div className='flex justify-end px-2 pb-2'>
              <Button
                size='sm'
                className='h-7 text-xs gap-1.5'
                disabled={!commentBody?.trim() || submitting}
                onClick={submitComment}
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
        open={confirmDeleteId !== null}
        onOpenChange={open => {
          if (!open) setConfirmDeleteId(null)
        }}
      >
        <AlertDialogContent
          className='max-w-xs'
          onKeyDown={e => {
            if (e.key === 'Enter') {
              e.preventDefault()
              if (confirmDeleteId) deleteComment(confirmDeleteId)
              setConfirmDeleteId(null)
            }
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>Delete comment?</AlertDialogTitle>
            <AlertDialogDescription>
              This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className='bg-red-600 hover:bg-red-700 focus:ring-red-600'
              onClick={() => {
                if (confirmDeleteId) deleteComment(confirmDeleteId)
                setConfirmDeleteId(null)
              }}
            >
              Delete
              <kbd className='ml-1.5 text-[10px] opacity-60 font-sans'>↵</kbd>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
