'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ideasClient } from '@/lib/api-client'
import { queryKeys } from '@/lib/query/keys'
import { ApiIdea } from '../types'

type IdeaStatus = ApiIdea['status']

/**
 * Mutation for advancing an idea's lifecycle status from the pool list
 * (LUM-708). PATCHes `/api/ideas/[id]` with `{ status }` — the same route the
 * statement edit uses, dispatched server-side by the presence of `status` —
 * then patches the pool cache in place so the row's badge updates without a
 * refetch.
 *
 * The legality of a given `from → to` move lives in `lib/idea-status.ts` and is
 * enforced by the service; the caller picks the next legal status (the view
 * never offers an illegal one, so a rejected move means the cache was stale).
 */
export function useUpdateIdeaStatus() {
  const queryClient = useQueryClient()

  const mutation = useMutation<
    ApiIdea,
    Error,
    { id: string; status: IdeaStatus }
  >({
    mutationFn: async ({ id, status }) => {
      const { idea } = await ideasClient.updateStatus<{ idea: ApiIdea }>(id, {
        status,
      })
      return idea
    },
    onSuccess: updated => {
      queryClient.setQueryData<ApiIdea[]>(queryKeys.ideas.all(), prev =>
        prev
          ? prev.map(idea => (idea.id === updated.id ? updated : idea))
          : prev
      )
    },
  })

  return {
    updateStatus: (id: string, status: IdeaStatus) =>
      mutation.mutateAsync({ id, status }),
    updating: mutation.isPending,
    error: mutation.error ? mutation.error.message : null,
  }
}
