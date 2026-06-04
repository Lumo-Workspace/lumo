'use client'

import {
  useCallback,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { ApiComment } from '../types'
import { readCache, writeCache } from '../cache'
import { CACHE_KEY } from '../constants'
import { tasksClient } from '@/lib/api-client'
import { queryKeys } from '@/lib/query/keys'
import { mapCommentTree } from '../components/comment-utils'

// ── Types ───────────────────────────────────────────────────────────────────

interface UseTaskCommentsOptions {
  taskId: string
  /** actorId of the current user (for optimistic comment creation) */
  currentActorId: string | null
}

// ── Hook ────────────────────────────────────────────────────────────────────

export function useTaskComments({
  taskId,
  currentActorId,
}: UseTaskCommentsOptions) {
  const queryClient = useQueryClient()
  const queryKey = queryKeys.comments(taskId)

  // ── Comments list ───────────────────────────────────────────────────────
  const query = useQuery<ApiComment[]>({
    queryKey,
    queryFn: async () => {
      const data = await tasksClient.listComments<{ comments: ApiComment[] }>(
        taskId
      )
      const fresh = data.comments ?? []
      writeCache(CACHE_KEY.comments(taskId), fresh)
      return fresh
    },
    initialData: () =>
      readCache<ApiComment[]>(CACHE_KEY.comments(taskId)) ?? undefined,
    // The localStorage seed is from a prior session and may be stale, so mark
    // it as fetched-at-epoch: the first mount always refetches to freshen.
    // A short staleTime then dedupes redundant refetches within a session —
    // sibling observers and reopening the same task panel reuse the cache.
    // Comments have no Pusher channel, so keep the window short (30s) to pick
    // up other members' comments soon after they post.
    initialDataUpdatedAt: 0,
    staleTime: 30_000,
  })

  const comments = query.data ?? []
  const commentsLoading = query.isLoading

  // setComments wrapper — writes through the TanStack cache + mirrors to
  // localStorage. Preserves the Dispatch<SetStateAction<ApiComment[]>>
  // contract so callers (including the in-hook mutations below) don't
  // notice the migration.
  const setComments = useCallback<Dispatch<SetStateAction<ApiComment[]>>>(
    action => {
      queryClient.setQueryData<ApiComment[]>(queryKey, prev => {
        const prevList = prev ?? []
        const next =
          typeof action === 'function'
            ? (action as (prev: ApiComment[]) => ApiComment[])(prevList)
            : action
        writeCache(CACHE_KEY.comments(taskId), next)
        return next
      })
    },
    // queryKey is a fresh tuple per render; queryClient is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [queryClient, taskId]
  )

  // ── New comment ─────────────────────────────────────────────────────────
  const [commentBody, setCommentBody] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const clearCommentRef = useRef<(() => void) | null>(null)
  const [commentKey, setCommentKey] = useState(0)

  // ── Edit / delete ───────────────────────────────────────────────────────
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null)
  const [editCommentBody, setEditCommentBody] = useState<string | null>(null)
  const [savingComment, setSavingComment] = useState(false)
  const [deletingCommentId, setDeletingCommentId] = useState<string | null>(
    null
  )
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  // ── Threads (replies) ───────────────────────────────────────────────────
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

  // ── Fetch from server ───────────────────────────────────────────────────
  const fetchComments = useCallback(async () => {
    await query.refetch()
  }, [query])

  // ── Submit new comment (optimistic) ─────────────────────────────────────
  const submitComment = useCallback(async () => {
    const body = commentBody?.trim()
    if (!body || submitting) return
    setSubmitting(true)

    const tempId = `optimistic-${Date.now()}`
    const optimistic: ApiComment = {
      id: tempId,
      taskId,
      authorActorId: currentActorId,
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
      const { comment } = await tasksClient.createComment<{
        comment: ApiComment
      }>(taskId, { body })
      setComments(prev => prev.map(c => (c.id === tempId ? comment : c)))
    } catch {
      setComments(prev => prev.filter(c => c.id !== tempId))
    } finally {
      setSubmitting(false)
    }
  }, [commentBody, submitting, taskId, currentActorId, setComments])

  // ── Submit reply (optimistic) ───────────────────────────────────────────
  const submitReply = useCallback(
    async (parentId: string) => {
      const body = replyBody?.trim()
      if (!body || submittingReply) return
      setSubmittingReply(true)

      const quotedCommentId = replyingToComment?.id ?? null
      const tempId = `optimistic-reply-${Date.now()}`
      const optimistic: ApiComment = {
        id: tempId,
        taskId,
        authorActorId: currentActorId,
        body,
        parentId,
        quotedCommentId,
        type: 'USER',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }
      setComments(prev =>
        prev.map(c =>
          c.id === parentId
            ? { ...c, replies: [...(c.replies ?? []), optimistic] }
            : c
        )
      )
      setReplyBody(null)
      clearReplyRef.current?.()
      setReplyingToId(null)
      setReplyingToComment(null)

      try {
        const { comment } = await tasksClient.createComment<{
          comment: ApiComment
        }>(taskId, { body, parentId, quotedCommentId })
        setComments(prev => mapCommentTree(prev, tempId, () => comment))
      } catch {
        setComments(prev => mapCommentTree(prev, tempId, () => null))
      } finally {
        setSubmittingReply(false)
      }
    },
    [
      replyBody,
      submittingReply,
      taskId,
      currentActorId,
      replyingToComment,
      setComments,
    ]
  )

  // ── Save edit (optimistic) ──────────────────────────────────────────────
  const saveEditComment = useCallback(
    async (commentId: string) => {
      const body = editCommentBody?.trim()
      if (!body || savingComment) return
      setSavingComment(true)
      try {
        const { comment } = await tasksClient.updateComment<{
          comment: ApiComment
        }>(taskId, commentId, { body })
        setComments(prev => mapCommentTree(prev, commentId, () => comment))
        setEditingCommentId(null)
        setEditCommentBody(null)
      } catch {
        // keep editing state so the user can retry
      } finally {
        setSavingComment(false)
      }
    },
    [editCommentBody, savingComment, taskId, setComments]
  )

  // ── Delete ──────────────────────────────────────────────────────────────
  const deleteComment = useCallback(
    async (commentId: string) => {
      setDeletingCommentId(commentId)
      try {
        await tasksClient.deleteComment(taskId, commentId)
        setComments(prev => mapCommentTree(prev, commentId, () => null))
      } catch {
        // silently keep the comment on failure
      } finally {
        setDeletingCommentId(null)
        setConfirmDeleteId(null)
      }
    },
    [taskId, setComments]
  )

  // ── Scroll to comment ──────────────────────────────────────────────────
  const scrollToComment = useCallback((commentId: string) => {
    const el = document.getElementById(`comment-${commentId}`)
    if (!el) return
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    setHighlightedCommentId(commentId)
    setTimeout(() => setHighlightedCommentId(null), 1500)
  }, [])

  // ── Convenience actions ────────────────────────────────────────────────
  const startEditing = useCallback((comment: ApiComment) => {
    setEditingCommentId(comment.id)
    setEditCommentBody(comment.body)
  }, [])

  const cancelEditing = useCallback(() => {
    setEditingCommentId(null)
    setEditCommentBody(null)
  }, [])

  const startReply = useCallback((comment: ApiComment, authorName: string) => {
    setReplyingToId(comment.parentId ?? comment.id)
    setReplyingToComment({
      id: comment.id,
      authorName,
      body: comment.body,
    })
  }, [])

  const cancelReply = useCallback(() => {
    setReplyingToId(null)
    setReplyingToComment(null)
    setReplyBody(null)
  }, [])

  return {
    // State
    comments,
    commentsLoading,
    commentBody,
    submitting,
    editingCommentId,
    editCommentBody,
    savingComment,
    deletingCommentId,
    confirmDeleteId,
    highlightedCommentId,
    replyingToId,
    replyingToComment,
    replyBody,
    submittingReply,
    clearCommentRef,
    clearReplyRef,
    commentKey,

    // Actions
    fetchComments,
    submitComment,
    submitReply,
    saveEditComment,
    deleteComment,
    scrollToComment,
    startEditing,
    cancelEditing,
    startReply,
    cancelReply,
    setComments,
    setCommentBody,
    setReplyBody,
    setEditCommentBody,
    setConfirmDeleteId,
  }
}
