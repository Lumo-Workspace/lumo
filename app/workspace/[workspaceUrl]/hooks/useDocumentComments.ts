'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/lib/query/keys'
import { documentCommentsApi } from '@/lib/api-client/documents'

export interface ApiDocumentComment {
  id: string
  documentId: string
  authorActorId: string | null
  body: string
  parentId: string | null
  quotedText: string | null
  anchorStart: number | null
  anchorEnd: number | null
  status: 'OPEN' | 'RESOLVED'
  isOrphaned: boolean
  type: 'USER' | 'AGENT'
  createdAt: string
  /** Set when soft-deleted. A deleted parent kept for its replies renders as a tombstone. */
  deletedAt?: string | null
  author?: {
    id: string
    type: string
    member?: { id: string; clerkId: string } | null
    agent?: { id: string; name: string; avatarColor: string } | null
  } | null
  replies?: ApiDocumentComment[]
}

export interface CreateDocCommentArgs {
  id: string
  body: string
  parentId?: string | undefined
  from?: number | undefined
  to?: number | undefined
  quotedText?: string | undefined
  content?: string | undefined
}

/** Apply fn to the matching comment anywhere in the thread tree; fn=>null deletes it. */
export function mapThread(
  list: ApiDocumentComment[],
  id: string,
  fn: (c: ApiDocumentComment) => ApiDocumentComment | null
): ApiDocumentComment[] {
  const out: ApiDocumentComment[] = []
  for (const t of list) {
    if (t.id === id) {
      const next = fn(t)
      if (next) out.push(next)
      continue
    }
    const replies = t.replies ?? []
    const idx = replies.findIndex(r => r.id === id)
    if (idx >= 0) {
      const r = replies[idx]!
      const nr = fn(r)
      const nextReplies = nr
        ? replies.map(x => (x.id === id ? nr : x))
        : replies.filter(x => x.id !== id)
      out.push({ ...t, replies: nextReplies })
    } else {
      out.push(t)
    }
  }
  return out
}

export function useDocumentComments(documentId: string, enabled = true) {
  const queryClient = useQueryClient()
  const key = queryKeys.documentComments(documentId)

  const query = useQuery({
    queryKey: key,
    queryFn: async () => {
      const res = await documentCommentsApi.list<{
        comments: ApiDocumentComment[]
      }>(documentId)
      return res.comments
    },
    enabled: enabled && !!documentId,
  })

  const createMutation = useMutation<
    ApiDocumentComment,
    Error,
    CreateDocCommentArgs,
    { previous: ApiDocumentComment[] | undefined }
  >({
    mutationFn: async args => {
      const res = await documentCommentsApi.create<{
        comment: ApiDocumentComment
      }>(documentId, args)
      return res.comment
    },
    onMutate: async args => {
      await queryClient.cancelQueries({ queryKey: key })
      const previous = queryClient.getQueryData<ApiDocumentComment[]>(key)
      const optimistic: ApiDocumentComment = {
        id: args.id,
        documentId,
        authorActorId: null,
        body: args.body,
        parentId: args.parentId ?? null,
        quotedText: args.quotedText ?? null,
        anchorStart: args.from ?? null,
        anchorEnd: args.to ?? null,
        status: 'OPEN',
        isOrphaned: false,
        type: 'USER',
        createdAt: new Date().toISOString(),
        replies: [],
      }
      queryClient.setQueryData<ApiDocumentComment[]>(key, old =>
        args.parentId
          ? (old ?? []).map(t =>
              t.id === args.parentId
                ? { ...t, replies: [...(t.replies ?? []), optimistic] }
                : t
            )
          : [...(old ?? []), optimistic]
      )
      return { previous }
    },
    onError: (_e, _args, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(key, ctx.previous)
    },
    onSuccess: (real, args) => {
      queryClient.setQueryData<ApiDocumentComment[]>(key, old => {
        const list = old ?? []
        if (args.parentId) {
          return list.map(t =>
            t.id === args.parentId
              ? {
                  ...t,
                  replies: (t.replies ?? []).map(r =>
                    r.id === args.id ? real : r
                  ),
                }
              : t
          )
        }
        return list.map(t => (t.id === args.id ? real : t))
      })
    },
  })

  const updateMutation = useMutation<
    ApiDocumentComment,
    Error,
    { commentId: string; body: string },
    { previous: ApiDocumentComment[] | undefined }
  >({
    mutationFn: async ({ commentId, body }) => {
      const res = await documentCommentsApi.update<{
        comment: ApiDocumentComment
      }>(documentId, commentId, { body })
      return res.comment
    },
    onMutate: async ({ commentId, body }) => {
      await queryClient.cancelQueries({ queryKey: key })
      const previous = queryClient.getQueryData<ApiDocumentComment[]>(key)
      queryClient.setQueryData<ApiDocumentComment[]>(key, old =>
        mapThread(old ?? [], commentId, c => ({ ...c, body }))
      )
      return { previous }
    },
    onError: (_e, _args, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(key, ctx.previous)
    },
    onSuccess: real => {
      // The server update row only carries AUTHOR_SELECT, never `replies`.
      // Replacing the node wholesale would wipe a parent's replies from cache
      // (onMutate already kept them via { ...c, body }). Merge the fresh fields
      // over the cached node and preserve its existing replies.
      queryClient.setQueryData<ApiDocumentComment[]>(key, old =>
        mapThread(old ?? [], real.id, c => ({
          ...c,
          ...real,
          replies: c.replies ?? [],
        }))
      )
    },
  })

  const deleteMutation = useMutation<
    void,
    Error,
    { commentId: string },
    { previous: ApiDocumentComment[] | undefined }
  >({
    mutationFn: async ({ commentId }) => {
      await documentCommentsApi.remove(documentId, commentId)
    },
    onMutate: async ({ commentId }) => {
      await queryClient.cancelQueries({ queryKey: key })
      const previous = queryClient.getQueryData<ApiDocumentComment[]>(key)
      queryClient.setQueryData<ApiDocumentComment[]>(key, old =>
        mapThread(old ?? [], commentId, c =>
          // A parent that still has replies becomes a "[deleted]" tombstone so
          // its replies stay visible (the server keeps the soft-deleted row for
          // the same reason). Replies and childless parents are removed.
          (c.replies?.length ?? 0) > 0
            ? { ...c, deletedAt: new Date().toISOString() }
            : null
        )
      )
      return { previous }
    },
    onError: (_e, _args, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(key, ctx.previous)
    },
  })

  const statusMutation = useMutation<
    ApiDocumentComment,
    Error,
    { commentId: string; status: 'OPEN' | 'RESOLVED' },
    { previous: ApiDocumentComment[] | undefined }
  >({
    mutationFn: async ({ commentId, status }) => {
      const res = await documentCommentsApi.setStatus<{
        comment: ApiDocumentComment
      }>(documentId, commentId, status)
      return res.comment
    },
    onMutate: async ({ commentId, status }) => {
      await queryClient.cancelQueries({ queryKey: key })
      const previous = queryClient.getQueryData<ApiDocumentComment[]>(key)
      queryClient.setQueryData<ApiDocumentComment[]>(key, old =>
        mapThread(old ?? [], commentId, c => ({ ...c, status }))
      )
      return { previous }
    },
    onError: (_e, _args, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(key, ctx.previous)
    },
    onSuccess: real => {
      queryClient.setQueryData<ApiDocumentComment[]>(key, old =>
        mapThread(old ?? [], real.id, () => real)
      )
    },
  })

  return {
    comments: query.data ?? [],
    isLoading: query.isLoading,
    error: query.error,
    create: createMutation.mutateAsync,
    refetch: query.refetch,
    updateComment: (commentId: string, body: string) =>
      updateMutation.mutateAsync({ commentId, body }),
    deleteComment: (commentId: string) =>
      deleteMutation.mutateAsync({ commentId }),
    setStatus: (commentId: string, status: 'OPEN' | 'RESOLVED') =>
      statusMutation.mutateAsync({ commentId, status }),
  }
}
