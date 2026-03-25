'use client'

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { Send, Pencil, Trash2 } from 'lucide-react'
import { formatTimestamp } from '../utils'
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
          const next = prev.map(c => (c.id === commentId ? comment : c))
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
    [editCommentBody, savingComment, task.id]
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
          const next = prev.filter(c => c.id !== commentId)
          writeCache(CACHE_KEY.comments(task.id), next)
          return next
        })
      } catch {
        // silently keep the comment on failure
      } finally {
        setDeletingCommentId(null)
      }
    },
    [task.id]
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
              return (
                <div key={comment.id} className='group flex gap-2.5'>
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
                            disabled={!editCommentBody?.trim() || savingComment}
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

                  {/* Edit / delete — author only, visible on hover */}
                  {isAuthor && !isEditing && (
                    <div className='flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0 pt-0.5'>
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
