'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ideasClient } from '@/lib/api-client'
import { queryKeys } from '@/lib/query/keys'
import { ApiIdeaComment } from '../types'

/**
 * An idea's comment thread + a composer mutation (LUM-680). Reads
 * `GET /api/ideas/[id]/comments`; posting a comment invalidates both the thread
 * and the activity timeline (a comment records a COMMENT_ADDED activity), so the
 * Activity tab reflects it too. Scoped per-idea via the query key.
 */
export function useIdeaComments(ideaId: string) {
  const queryClient = useQueryClient()

  const query = useQuery<ApiIdeaComment[]>({
    queryKey: queryKeys.ideas.comments(ideaId),
    queryFn: async () => {
      const data = await ideasClient.listComments<{
        comments: ApiIdeaComment[]
      }>(ideaId)
      return data.comments
    },
    staleTime: 30_000,
  })

  const addMutation = useMutation<ApiIdeaComment, Error, string>({
    mutationFn: async body => {
      const { comment } = await ideasClient.createComment<{
        comment: ApiIdeaComment
      }>(ideaId, body)
      return comment
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.ideas.comments(ideaId),
      })
      void queryClient.invalidateQueries({
        queryKey: queryKeys.ideas.activity(ideaId),
      })
    },
  })

  return {
    comments: query.data ?? [],
    loading: query.isLoading,
    error: query.error ? ((query.error as Error).message ?? 'error') : null,
    addComment: (body: string) => addMutation.mutateAsync(body),
    posting: addMutation.isPending,
  }
}
