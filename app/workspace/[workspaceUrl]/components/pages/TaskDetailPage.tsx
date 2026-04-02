'use client'

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import {
  Send,
  Pencil,
  Trash2,
  Reply,
  Link as LinkIcon,
  Check,
  Copy,
  ExternalLink,
  MoreHorizontal,
  GitPullRequest,
  GitBranch,
} from 'lucide-react'
import { useCurrentUser } from '../../hooks/useCurrentUser'
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar'
import { AppSidebar } from '../Sidebar'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { Spinner } from '@/components/ui/spinner'
import {
  TaskDetail,
  ApiTask,
  ApiComment,
  ApiStatus,
  ApiPriority,
  WorkspaceMemberInfo,
  ApiProject,
  Page,
} from '../../types'
import { API, CACHE_KEY } from '../../constants'
import { readCache, writeCache } from '../../cache'
import { formatTimestamp, slugifyProjectName, apiFetch } from '../../utils'
import { useRealtimeNotifications } from '../../hooks/useRealtimeNotifications'
import { copyLink } from '../../utils/copyLink'
import { useCopyState } from '../../hooks/useCopyState'
import { usePusherEvent } from '../../hooks/usePusher'
import type { TaskEvent } from '@/lib/pusher/server'
import { DescriptionEditor } from '../DescriptionEditor'
import {
  StatusSelect,
  AssigneeSelect,
  ReviewerSelect,
  ProjectSelect,
  PrioritySelect,
  FIELD_TRIGGER_CLS,
} from '../TaskFieldSelects'
import { CreateBranchDialog } from '../CreateBranchDialog'
import { PrStateBadge, CiIcon } from '../pr-helpers'
import { CommentAvatar } from '../CommentAvatar'
import { resolveCommentAuthor } from '../comment-utils'
import { AgentPanel } from '@/components/task/AgentPanel'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

interface TaskDetailPageProps {
  initialTask: TaskDetail & {
    children?: { id: string; title: string; number: number }[]
  }
  workspaceUrl: string
  /** Pre-set source for breadcrumb (e.g. 'my-tasks'). Falls back to sessionStorage. */
  source?: string | undefined
}

export function TaskDetailPage({
  initialTask,
  workspaceUrl,
  source: sourceProp,
}: TaskDetailPageProps) {
  // ── Hooks ──────────────────────────────────────────────────────────────────
  const router = useRouter()
  const { user } = useCurrentUser()

  // ── Notifications ─────────────────────────────────────────────────────────
  const { unreadCount } = useRealtimeNotifications()

  // ── Breadcrumb ─────────────────────────────────────────────────────────────
  const [from, setFrom] = useState<string | null>(sourceProp ?? null)
  useEffect(() => {
    if (sourceProp) return // already set via prop
    const stored = sessionStorage.getItem('lumo:taskSource')
    if (stored) {
      setFrom(stored)
      sessionStorage.removeItem('lumo:taskSource')
    }
  }, [sourceProp])
  const sourceLabel =
    from === 'my-tasks' ? 'My Tasks' : (initialTask.project?.name ?? 'Project')

  // ── Task state ─────────────────────────────────────────────────────────────
  const [task, setTask] = useState<TaskDetail>(initialTask)
  const [descriptionValue, setDescriptionValue] = useState<string | null>(
    initialTask.description ?? null
  )
  const [descriptionLoading, setDescriptionLoading] = useState(
    initialTask.description === undefined
  )
  // Hydrate description from localStorage after mount to avoid SSR mismatch
  useEffect(() => {
    if (initialTask.description !== undefined) return
    const cached = readCache<{ desc: string | null }>(
      CACHE_KEY.description(initialTask.id)
    )
    if (cached) {
      setDescriptionValue(cached.desc)
      setDescriptionLoading(false)
    }
  }, [initialTask.id, initialTask.description])

  // ── Branch copy ────────────────────────────────────────────────────────────
  const [copiedBranchId, setCopiedBranchId] = useState<string | null>(null)
  const handleCopyBranch = useCallback(async (id: string, name: string) => {
    await navigator.clipboard.writeText(name)
    setCopiedBranchId(id)
    setTimeout(() => setCopiedBranchId(null), 1500)
  }, [])

  // ── Task copy link ─────────────────────────────────────────────────────────
  const taskIdentifier = `${task.teamIdentifier}-${task.number}`
  const [origin, setOrigin] = useState('')
  useEffect(() => setOrigin(window.location.origin), [])
  const taskFullUrl = useMemo(() => {
    const base = `${origin}/workspace/${workspaceUrl}`
    return from === 'my-tasks'
      ? `${base}/my-tasks/${taskIdentifier}`
      : `${base}/project/${slugifyProjectName(task.project.name)}/tasks/${taskIdentifier}`
  }, [origin, workspaceUrl, from, taskIdentifier, task.project.name])

  const [taskLinkCopied, triggerTaskLinkCopy] = useCopyState()
  const handleCopyTaskLink = useCallback(async () => {
    await copyLink(taskFullUrl)
    triggerTaskLinkCopy()
  }, [taskFullUrl, triggerTaskLinkCopy])

  // ── Delete task ────────────────────────────────────────────────────────────
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [createBranchOpen, setCreateBranchOpen] = useState(false)
  const handleDeleteTask = useCallback(async () => {
    await fetch(API.tasks.byId(task.id), { method: 'DELETE' })
    router.back()
  }, [task.id, router])

  // ── Members + Projects (hydrate from cache after mount to avoid SSR mismatch)
  const [members, setMembers] = useState<WorkspaceMemberInfo[]>([])
  const [agentActors, setAgentActors] = useState<
    { actorId: string; name: string; avatarColor: string }[]
  >([])
  const [projects, setProjects] = useState<ApiProject[]>([])
  useEffect(() => {
    const cachedMembers = readCache<WorkspaceMemberInfo[]>(CACHE_KEY.members)
    if (cachedMembers) setMembers(cachedMembers)
    const cachedAgents = readCache<
      { actorId: string; name: string; avatarColor: string }[]
    >(CACHE_KEY.agentActors)
    if (cachedAgents) setAgentActors(cachedAgents)
    const cachedProjects = readCache<ApiProject[]>(CACHE_KEY.projects)
    if (cachedProjects) setProjects(cachedProjects)
  }, [])

  // ── Comments state ─────────────────────────────────────────────────────────
  // Always start with loading=true to avoid SSR/client hydration mismatch
  // (localStorage is not available on the server)
  const [comments, setComments] = useState<ApiComment[]>([])
  const [commentsLoading, setCommentsLoading] = useState(true)
  const hydratedComments = useRef(false)
  useEffect(() => {
    if (hydratedComments.current) return
    hydratedComments.current = true
    const cached = readCache<ApiComment[]>(CACHE_KEY.comments(initialTask.id))
    if (cached) {
      setComments(cached)
      setCommentsLoading(false)
    }
  }, [initialTask.id])
  const [commentBody, setCommentBody] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const clearCommentRef = useRef<(() => void) | null>(null)
  const [commentKey, setCommentKey] = useState(0)

  // ── Comment edit / delete ──────────────────────────────────────────────────
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null)
  const [editCommentBody, setEditCommentBody] = useState<string | null>(null)
  const [savingComment, setSavingComment] = useState(false)
  const [deletingCommentId, setDeletingCommentId] = useState<string | null>(
    null
  )
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  // ── Comment threads (replies) ──────────────────────────────────────────────
  const [highlightedCommentId, setHighlightedCommentId] = useState<
    string | null
  >(null)
  const [replyingToId, setReplyingToId] = useState<string | null>(null)
  const [replyingToComment, setReplyingToComment] = useState<{
    id: string
    authorName: string
    body: string
  } | null>(null)
  const [replyBody, setReplyBody] = useState<string | null>(null)
  const [submittingReply, setSubmittingReply] = useState(false)
  const clearReplyRef = useRef<(() => void) | null>(null)

  // ── Parallel fetch on mount ────────────────────────────────────────────────
  useEffect(() => {
    Promise.all([
      fetch(API.tasks.byId(initialTask.id)).then(r =>
        r.ok ? r.json() : { task: null }
      ),
      fetch(API.workspaces.members).then(r =>
        r.ok ? r.json() : { members: [] }
      ),
      fetch(API.projects.list).then(r => (r.ok ? r.json() : { projects: [] })),
      fetch(API.tasks.comments(initialTask.id)).then(r =>
        r.ok ? r.json() : { comments: [] }
      ),
    ])
      .then(([taskData, membersData, projectsData, commentsData]) => {
        if (taskData.task) {
          const t = taskData.task as TaskDetail
          setTask(prev => ({ ...prev, ...t }))
          setDescriptionValue(t.description ?? null)
          const taskMap =
            readCache<Record<string, ApiTask>>(CACHE_KEY.tasks) ?? {}
          writeCache(CACHE_KEY.tasks, { ...taskMap, [t.id]: t })
          writeCache(CACHE_KEY.description(t.id), {
            desc: t.description ?? null,
          })
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
        const freshProjects: ApiProject[] = projectsData.projects ?? []
        if (freshProjects.length > 0) {
          setProjects(freshProjects)
          writeCache(CACHE_KEY.projects, freshProjects)
        }
        const freshComments: ApiComment[] = commentsData.comments ?? []
        setComments(freshComments)
        writeCache(CACHE_KEY.comments(initialTask.id), freshComments)
      })
      .catch(console.error)
      .finally(() => {
        setDescriptionLoading(false)
        setCommentsLoading(false)
      })
  }, [initialTask.id])

  // ── Pusher: real-time task & comment updates ──────────────────────────────
  usePusherEvent<TaskEvent>(`task-${initialTask.id}`, 'task-update', event => {
    if (
      event.type === 'comment:created' ||
      event.type === 'comment:updated' ||
      event.type === 'comment:deleted'
    ) {
      // Refetch comments
      fetch(API.tasks.comments(initialTask.id))
        .then(r => (r.ok ? r.json() : null))
        .then(data => {
          if (data?.comments) {
            setComments(data.comments)
            writeCache(CACHE_KEY.comments(initialTask.id), data.comments)
          }
        })
        .catch(console.error)
    }
    if (event.type === 'task:updated') {
      // Refetch task data and sync cache
      fetch(API.tasks.byId(initialTask.id))
        .then(r => (r.ok ? r.json() : null))
        .then(data => {
          if (data?.task) {
            const t = data.task as TaskDetail
            setTask(prev => ({ ...prev, ...t }))
            setDescriptionValue(t.description ?? null)
            // Write back to cache so list pages reflect the update
            const taskMap =
              readCache<Record<string, ApiTask>>(CACHE_KEY.tasks) ?? {}
            writeCache(CACHE_KEY.tasks, { ...taskMap, [t.id]: t })
            writeCache(CACHE_KEY.description(t.id), {
              desc: t.description ?? null,
            })
          }
        })
        .catch(console.error)
    }
  })

  // ── Field mutations ────────────────────────────────────────────────────────
  const onUpdate = useCallback(
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
        spec: string | null
      }>
    ) => {
      const res = await apiFetch(API.tasks.byId(taskId), {
        method: 'PATCH',
        body: data,
      })
      if (!res.ok) throw new Error('Failed to update task')
    },
    []
  )

  const handlePatch = useCallback(
    async (
      data: Partial<{
        title: string
        status: ApiStatus
        assigneeActorId: string | null
        reviewerActorId: string | null
        repositoryId: string | null
        description: string | null
        spec: string | null
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
      const taskMap = readCache<Record<string, ApiTask>>(CACHE_KEY.tasks) ?? {}
      writeCache(CACHE_KEY.tasks, { ...taskMap, [task.id]: localUpdate })
      try {
        await onUpdate(task.id, data)
      } catch {
        setTask(snapshot)
        writeCache(CACHE_KEY.tasks, { ...taskMap, [task.id]: snapshot })
      }
    },
    [task, onUpdate, projects]
  )

  const commitDescription = useCallback(
    (html: string | null) => {
      const next = html?.trim() || null
      if (next === (task.description ?? null)) return
      handlePatch({ description: next })
    },
    [task.description, handlePatch]
  )

  const commitSpec = useCallback(
    (html: string | null) => {
      const next = html?.trim() || null
      if (next === (task.spec ?? null)) return
      handlePatch({ spec: next })
    },
    [task.spec, handlePatch]
  )

  // ── Comment handlers ───────────────────────────────────────────────────────
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

  const scrollToComment = useCallback((commentId: string) => {
    const el = document.getElementById(`comment-${commentId}`)
    if (!el) return
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    setHighlightedCommentId(commentId)
    setTimeout(() => setHighlightedCommentId(null), 1500)
  }, [])

  // Anchor scroll: fire once when comments first load
  const hasScrolled = useRef(false)
  useEffect(() => {
    if (hasScrolled.current) return
    if (!comments.length) return
    const hash = window.location.hash // e.g. "#comment-cm4abc123"
    if (!hash.startsWith('#comment-')) return
    const commentId = hash.slice('#comment-'.length)
    hasScrolled.current = true
    scrollToComment(commentId)
  }, [comments, scrollToComment])

  const submitComment = useCallback(async () => {
    const body = commentBody?.trim()
    if (!body || submitting) return
    setSubmitting(true)

    const tempId = `optimistic-${Date.now()}`
    const optimistic: ApiComment = {
      id: tempId,
      taskId: task.id,
      authorActorId: members.find(m => m.clerkId === user?.id)?.actorId ?? null,
      body,
      parentId: null,
      quotedCommentId: null,
      type: 'USER',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    setComments(prev => [...prev, optimistic])
    setCommentBody(null)
    clearCommentRef.current?.()
    setCommentKey(k => k + 1)

    try {
      const res = await apiFetch(API.tasks.comments(task.id), {
        method: 'POST',
        body: { body },
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
  }, [commentBody, submitting, task.id, user?.id, members])

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
        authorActorId:
          members.find(m => m.clerkId === user?.id)?.actorId ?? null,
        body,
        parentId,
        quotedCommentId,
        type: 'USER',
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
        const res = await apiFetch(API.tasks.comments(task.id), {
          method: 'POST',
          body: { body, parentId, quotedCommentId },
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
    [
      replyBody,
      submittingReply,
      task.id,
      user?.id,
      mapCommentTree,
      replyingToComment,
      members,
    ]
  )

  const saveEditComment = useCallback(
    async (commentId: string) => {
      const body = editCommentBody?.trim()
      if (!body || savingComment) return
      setSavingComment(true)
      try {
        const res = await apiFetch(API.tasks.comment(task.id, commentId), {
          method: 'PATCH',
          body: { body },
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

  const mentionableMembers = members.filter(m => m.clerkId !== user?.id)

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <SidebarProvider className='h-screen font-sans'>
      <AppSidebar
        currentPage={'task-detail' as Page}
        onNavigate={() => router.push(`/workspace/${workspaceUrl}`)}
        unreadCount={unreadCount}
      />
      <SidebarInset className='overflow-hidden flex flex-col'>
        {/* Breadcrumb */}
        <div className='flex items-center justify-between px-5 h-10 border-b border-zinc-100 dark:border-zinc-800 shrink-0 text-sm'>
          <div className='flex items-center gap-1.5'>
            <button
              onClick={() => {
                if (from === 'my-tasks') {
                  router.push(`/workspace/${workspaceUrl}/my-tasks`)
                } else {
                  router.push(
                    `/workspace/${workspaceUrl}/projects/${slugifyProjectName(task.project.name)}`
                  )
                }
              }}
              className='flex items-center gap-1 text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors'
            >
              <span>{sourceLabel}</span>
            </button>
            <span className='text-zinc-300 dark:text-zinc-600'>›</span>
            <span className='text-zinc-500 font-medium'>
              {task.teamIdentifier}-{task.number}
            </span>
            <span className='text-zinc-300 dark:text-zinc-600'>·</span>
            <span className='text-zinc-700 dark:text-zinc-300 truncate max-w-xs'>
              {task.title}
            </span>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant='ghost'
                  size='icon'
                  className='h-6 w-6 text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100'
                >
                  <MoreHorizontal size={14} />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align='start'>
                <DropdownMenuItem
                  className='text-destructive focus:text-destructive'
                  onClick={() => setDeleteOpen(true)}
                >
                  <Trash2 className='mr-2 size-4' />
                  Delete task
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant='ghost'
                size='icon'
                onClick={handleCopyTaskLink}
                className='h-7 w-7 text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100'
              >
                {taskLinkCopied ? <Check size={14} /> : <LinkIcon size={14} />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>Copy link</TooltipContent>
          </Tooltip>
        </div>

        <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
          <AlertDialogContent size='sm'>
            <AlertDialogHeader>
              <AlertDialogMedia className='bg-destructive/10 text-destructive dark:bg-destructive/20 dark:text-destructive'>
                <Trash2 />
              </AlertDialogMedia>
              <AlertDialogTitle>Delete task?</AlertDialogTitle>
              <AlertDialogDescription>
                &ldquo;{task.title}&rdquo; will be permanently deleted. This
                action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel variant='outline'>Cancel</AlertDialogCancel>
              <AlertDialogAction
                variant='destructive'
                onClick={handleDeleteTask}
              >
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

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
            {descriptionLoading ? (
              <Spinner className='size-4 text-zinc-300 dark:text-zinc-600' />
            ) : (
              <DescriptionEditor
                value={descriptionValue}
                onCommit={commitDescription}
                members={mentionableMembers}
              />
            )}

            {/* Spec */}
            <div className='mt-8'>
              <div className='flex items-center gap-2 mb-2'>
                <span className='text-xs font-semibold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider'>
                  Spec
                </span>
                <span className='text-[10px] font-medium text-indigo-500 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/50 border border-indigo-200 dark:border-indigo-800 rounded px-1.5 py-0.5 leading-none'>
                  Agent reads this
                </span>
              </div>
              <DescriptionEditor
                value={task.spec ?? null}
                onCommit={commitSpec}
                placeholder='+ Add spec for the agent…'
                members={mentionableMembers}
              />
            </div>

            {/* Sub-tasks placeholder */}
            {(initialTask.children?.length ?? 0) > 0 && (
              <div className='mt-8'>
                <p className='text-xs font-semibold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider mb-3'>
                  Sub-tasks
                </p>
                <div className='space-y-1'>
                  {initialTask.children!.map(child => (
                    <div
                      key={child.id}
                      className='text-sm text-zinc-600 dark:text-zinc-400 py-1.5 px-2 rounded hover:bg-zinc-50 dark:hover:bg-zinc-900'
                    >
                      {task.teamIdentifier}-{child.number} · {child.title}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Agent Panel */}
            {task.assignee?.type === 'AGENT' && (
              <div className='mt-8'>
                <AgentPanel
                  task={task}
                  onTaskUpdate={updates =>
                    setTask(prev => ({ ...prev, ...updates }) as TaskDetail)
                  }
                />
              </div>
            )}

            {/* Comments section */}
            <p className='text-xs font-semibold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider mt-8 mb-4'>
              Comments
            </p>

            {/* Skeleton while loading */}
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
                  const ca = resolveCommentAuthor(comment, members, agentActors)
                  const currentMember = members.find(
                    m => m.clerkId === user?.id
                  )
                  const isAuthor =
                    !ca.isAgent &&
                    comment.authorActorId === currentMember?.actorId
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
                            {/* Copy comment link */}
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
                                      setReplyingToId(null)
                                      setReplyingToComment(null)
                                    } else {
                                      setReplyingToId(comment.id)
                                      setReplyingToComment({
                                        id: comment.id,
                                        authorName: ca.name,
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
                                      onClick={() =>
                                        setConfirmDeleteId(comment.id)
                                      }
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
                            const ra = resolveCommentAuthor(
                              reply,
                              members,
                              agentActors
                            )
                            const rIsAuthor =
                              !ra.isAgent &&
                              reply.authorActorId === currentMember?.actorId
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
                                          onClick={() =>
                                            saveEditComment(reply.id)
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
                                          const allComments = [
                                            comment,
                                            ...(comment.replies ?? []),
                                          ]
                                          const quoted = allComments.find(
                                            c => c.id === reply.quotedCommentId
                                          )
                                          if (!quoted) return null
                                          const qAuthor = members.find(
                                            m =>
                                              m.actorId === quoted.authorActorId
                                          )
                                          const qName =
                                            qAuthor?.name ?? 'Unknown'
                                          const qText = (() => {
                                            if (
                                              typeof document !== 'undefined'
                                            ) {
                                              const d =
                                                document.createElement('div')
                                              d.innerHTML = quoted.body
                                              return (
                                                (
                                                  d.textContent ??
                                                  d.innerText ??
                                                  ''
                                                )
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
                                    {/* Copy reply link */}
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
                                            if (replyingToId === comment.id) {
                                              setReplyingToId(null)
                                              setReplyingToComment(null)
                                            } else {
                                              setReplyingToId(comment.id)
                                              setReplyingToComment({
                                                id: reply.id,
                                                authorName: ra.name,
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
                                          <TooltipContent>
                                            Delete
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
                                  submitReply(comment.id)
                                }
                              }}
                            >
                              <DescriptionEditor
                                key={`reply-${comment.id}`}
                                value={null}
                                onCommit={html => setReplyBody(html)}
                                onChange={html => setReplyBody(html)}
                                placeholder='Add a reply…'
                                members={mentionableMembers}
                              />
                            </div>
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
                  {user?.initials ?? '?'}
                </AvatarFallback>
              </Avatar>
              <div className='flex-1 min-w-0 border border-zinc-200 dark:border-zinc-800 rounded-lg overflow-hidden focus-within:ring-1 focus-within:ring-zinc-400 transition-all'>
                <div
                  className='px-3 pt-2 pb-1 text-sm'
                  onKeyDown={e => {
                    const isMac = /Mac|iPhone|iPad/i.test(navigator.platform)
                    if ((isMac ? e.metaKey : e.ctrlKey) && e.key === 'Enter') {
                      e.preventDefault()
                      submitComment()
                    }
                  }}
                >
                  <DescriptionEditor
                    key={commentKey}
                    value={null}
                    onCommit={setCommentBody}
                    onChange={setCommentBody}
                    placeholder='Add a comment…'
                    members={mentionableMembers}
                    agentActors={agentActors}
                  />
                </div>
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

          {/* Right column */}
          <div className='w-72 shrink-0 border-l border-zinc-100 dark:border-zinc-800 overflow-y-auto px-5 py-6 bg-zinc-50/50 dark:bg-zinc-900/30'>
            {/* Properties */}
            <p className='text-xs font-semibold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider mb-3'>
              Properties
            </p>
            <div className='flex flex-col gap-0.5 mb-8'>
              {(
                [
                  {
                    label: 'Status',
                    node: (
                      <StatusSelect
                        value={task.status}
                        onChange={v => handlePatch({ status: v })}
                        triggerClassName={FIELD_TRIGGER_CLS}
                      />
                    ),
                  },
                  {
                    label: 'Assignee',
                    node: (
                      <AssigneeSelect
                        value={task.assigneeActorId ?? null}
                        onChange={v => handlePatch({ assigneeActorId: v })}
                        members={members.filter(
                          (m): m is WorkspaceMemberInfo & { actorId: string } =>
                            m.actorId !== null
                        )}
                        agentActors={agentActors}
                        assignee={task.assignee}
                        triggerClassName={FIELD_TRIGGER_CLS}
                      />
                    ),
                  },
                  {
                    label: 'Reviewer',
                    node: (
                      <ReviewerSelect
                        value={task.reviewerActorId ?? null}
                        onChange={v => handlePatch({ reviewerActorId: v })}
                        members={members.filter(
                          (m): m is WorkspaceMemberInfo & { actorId: string } =>
                            m.actorId !== null
                        )}
                        inheritedId={task.project?.defaultReviewerId ?? null}
                        triggerClassName={FIELD_TRIGGER_CLS}
                      />
                    ),
                  },
                  {
                    label: 'Project',
                    node: (
                      <ProjectSelect
                        value={task.projectId}
                        onChange={v => handlePatch({ projectId: v })}
                        projects={projects}
                        triggerClassName={FIELD_TRIGGER_CLS}
                      />
                    ),
                  },
                  {
                    label: 'Priority',
                    node: (
                      <PrioritySelect
                        value={task.priority}
                        onChange={v => handlePatch({ priority: v })}
                        triggerClassName={FIELD_TRIGGER_CLS}
                      />
                    ),
                  },
                  ...((task.project.repositories?.length ?? 0) > 0
                    ? [
                        {
                          label: 'Repository',
                          node: (
                            <Select
                              value={task.repositoryId ?? '__none__'}
                              onValueChange={v =>
                                handlePatch({
                                  repositoryId: v === '__none__' ? null : v,
                                })
                              }
                            >
                              <SelectTrigger className={FIELD_TRIGGER_CLS}>
                                <GitBranch
                                  size={12}
                                  className='mr-1 shrink-0'
                                />
                                <SelectValue placeholder='Repository' />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value='__none__'>
                                  No repository
                                </SelectItem>
                                {task.project.repositories!.map(repo => (
                                  <SelectItem key={repo.id} value={repo.id}>
                                    {repo.name}
                                    {repo.isDefault ? ' (default)' : ''}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          ),
                        },
                      ]
                    : []),
                ] as { label: string; node: React.ReactNode }[]
              ).map(({ label, node }) => (
                <div key={label} className='flex items-center gap-2 -ml-2'>
                  <span className='w-16 shrink-0 text-[11px] text-zinc-400 dark:text-zinc-500 pl-2'>
                    {label}
                  </span>
                  <div className='flex-1 min-w-0'>{node}</div>
                </div>
              ))}
            </div>

            {/* ── Branch ─────────────────────────────────────────────────── */}
            <div className='pt-3 border-t border-zinc-100 dark:border-zinc-800'>
              <p className='text-xs font-semibold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider mb-2 flex items-center gap-1.5'>
                <GitBranch size={12} />
                Branch
              </p>
              {task.branches && task.branches.length > 0 ? (
                <ul className='space-y-1.5'>
                  {task.branches.map(branch => (
                    <li
                      key={branch.id}
                      className='flex items-center gap-1.5 group'
                    >
                      <span className='text-xs font-mono text-zinc-700 dark:text-zinc-300 truncate flex-1 min-w-0'>
                        {branch.branchName}
                      </span>
                      <button
                        onClick={() =>
                          handleCopyBranch(branch.id, branch.branchName)
                        }
                        className='shrink-0 text-zinc-300 hover:text-zinc-600 dark:text-zinc-600 dark:hover:text-zinc-300 transition-colors'
                        title='Copy branch name'
                      >
                        {copiedBranchId === branch.id ? (
                          <Check size={12} className='text-emerald-500' />
                        ) : (
                          <Copy size={12} />
                        )}
                      </button>
                      <a
                        href={`https://github.com/${branch.repo}/tree/${branch.branchName}`}
                        target='_blank'
                        rel='noopener noreferrer'
                        className='shrink-0 text-zinc-300 hover:text-zinc-600 dark:text-zinc-600 dark:hover:text-zinc-300 transition-colors'
                        title='Open on GitHub'
                      >
                        <ExternalLink size={12} />
                      </a>
                    </li>
                  ))}
                </ul>
              ) : (
                <button
                  onClick={() => setCreateBranchOpen(true)}
                  className='w-full flex items-center justify-center gap-1.5 rounded-md border border-dashed border-zinc-200 dark:border-zinc-700 px-3 py-2 text-xs text-zinc-400 hover:border-zinc-300 dark:hover:border-zinc-600 hover:text-zinc-500 transition-colors'
                >
                  <GitBranch size={12} />
                  Create branch
                </button>
              )}
            </div>

            {/* ── Pull Requests ───────────────────────────────────────────── */}
            {task.pullRequests && task.pullRequests.length > 0 && (
              <div className='pt-3 border-t border-zinc-100 dark:border-zinc-800'>
                <p className='text-xs font-semibold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider mb-2 flex items-center gap-1.5'>
                  <GitPullRequest size={12} />
                  Pull Requests
                </p>
                <ul className='space-y-2.5'>
                  {task.pullRequests.map(pr => {
                    // Find the AgentRun that created this PR
                    const relatedRun = task.agentRuns?.find(
                      r => r.prNumber === pr.number
                    )
                    const runLabel = relatedRun
                      ? `Session #${relatedRun.runNumber}`
                      : null
                    const runStatusLabel =
                      relatedRun?.status === 'FAILED'
                        ? ' · Failed'
                        : relatedRun?.status === 'CANCELED'
                          ? ' · Canceled'
                          : relatedRun?.errorCode === 'TIMEOUT'
                            ? ' · Timed out'
                            : null

                    return (
                      <li key={pr.id} className='flex items-start gap-2'>
                        <CiIcon status={pr.ciStatus} />
                        <div className='min-w-0 flex-1'>
                          <a
                            href={pr.url}
                            target='_blank'
                            rel='noopener noreferrer'
                            className='text-xs text-zinc-700 dark:text-zinc-300 hover:underline font-medium leading-snug block'
                          >
                            #{pr.number} {pr.title}
                          </a>
                          <div className='flex items-center gap-1.5 mt-1'>
                            <PrStateBadge state={pr.state} />
                            {runLabel && (
                              <span className='text-[10px] text-zinc-400'>
                                {runLabel}
                                {runStatusLabel && (
                                  <span className='text-zinc-400'>
                                    {runStatusLabel}
                                  </span>
                                )}
                              </span>
                            )}
                          </div>
                        </div>
                      </li>
                    )
                  })}
                </ul>
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
            />
          </div>
        </div>
      </SidebarInset>

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
    </SidebarProvider>
  )
}
