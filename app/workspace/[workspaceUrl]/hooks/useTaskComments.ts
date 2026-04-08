'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import type { ApiComment } from '../types'
import { readCache, writeCache } from '../cache'
import { CACHE_KEY } from '../constants'
import { tasksClient } from '@/lib/api-client'
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
  // ── Comments list ───────────────────────────────────────────────────────
  const [comments, setComments] = useState<ApiComment[]>([])
  const [commentsLoading, setCommentsLoading] = useState(true)

  // Hydrate from cache once on mount
  const hydratedComments = useRef(false)
  useEffect(() => {
    if (hydratedComments.current) return
    hydratedComments.current = true
    const cached = readCache<ApiComment[]>(CACHE_KEY.comments(taskId))
    if (cached) {
      setComments(cached)
      setCommentsLoading(false)
    }
  }, [taskId])

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
    try {
      const data = await tasksClient.listComments<{ comments: ApiComment[] }>(
        taskId
      )
      const fresh = data.comments ?? []
      setComments(fresh)
      writeCache(CACHE_KEY.comments(taskId), fresh)
    } catch {
      // keep existing comments on failure
    } finally {
      setCommentsLoading(false)
    }
  }, [taskId])

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
      setComments(prev => {
        const next = prev.map(c => (c.id === tempId ? comment : c))
        writeCache(CACHE_KEY.comments(taskId), next)
        return next
      })
    } catch {
      setComments(prev => prev.filter(c => c.id !== tempId))
    } finally {
      setSubmitting(false)
    }
  }, [commentBody, submitting, taskId, currentActorId])

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
      setComments(prev => {
        const next = prev.map(c =>
          c.id === parentId
            ? { ...c, replies: [...(c.replies ?? []), optimistic] }
            : c
        )
        writeCache(CACHE_KEY.comments(taskId), next)
        return next
      })
      setReplyBody(null)
      clearReplyRef.current?.()
      setReplyingToId(null)
      setReplyingToComment(null)

      try {
        const { comment } = await tasksClient.createComment<{
          comment: ApiComment
        }>(taskId, { body, parentId, quotedCommentId })
        setComments(prev => {
          const next = mapCommentTree(prev, tempId, () => comment)
          writeCache(CACHE_KEY.comments(taskId), next)
          return next
        })
      } catch {
        setComments(prev => {
          const next = mapCommentTree(prev, tempId, () => null)
          writeCache(CACHE_KEY.comments(taskId), next)
          return next
        })
      } finally {
        setSubmittingReply(false)
      }
    },
    [replyBody, submittingReply, taskId, currentActorId, replyingToComment]
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
        setComments(prev => {
          const next = mapCommentTree(prev, commentId, () => comment)
          writeCache(CACHE_KEY.comments(taskId), next)
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
    [editCommentBody, savingComment, taskId]
  )

  // ── Delete ──────────────────────────────────────────────────────────────
  const deleteComment = useCallback(
    async (commentId: string) => {
      setDeletingCommentId(commentId)
      try {
        await tasksClient.deleteComment(taskId, commentId)
        setComments(prev => {
          const next = mapCommentTree(prev, commentId, () => null)
          writeCache(CACHE_KEY.comments(taskId), next)
          return next
        })
      } catch {
        // silently keep the comment on failure
      } finally {
        setDeletingCommentId(null)
        setConfirmDeleteId(null)
      }
    },
    [taskId]
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
