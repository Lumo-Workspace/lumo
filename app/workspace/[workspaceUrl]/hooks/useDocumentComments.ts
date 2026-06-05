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

  return {
    comments: query.data ?? [],
    isLoading: query.isLoading,
    error: query.error,
    create: createMutation.mutateAsync,
    refetch: query.refetch,
  }
}
