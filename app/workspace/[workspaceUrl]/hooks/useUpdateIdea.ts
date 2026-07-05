'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ideasClient } from '@/lib/api-client'
import { queryKeys } from '@/lib/query/keys'
import { ApiIdea } from '../types'

/**
 * Mutation for editing an idea's statement from the detail slide-over
 * (LUM-683). PATCHes `/api/ideas/[id]` via the api-client, then patches the
 * pool cache (`queryKeys.ideas.all()`) in place so the row + any open panel
 * reflect the edit without a refetch. Container-owned: the pool page wires the
 * returned `updateStatement` into the drawer's `onSave` (SRP — the view stays
 * presentational).
 */
export function useUpdateIdea() {
  const queryClient = useQueryClient()

  const mutation = useMutation<
    ApiIdea,
    Error,
    { id: string; statement: string }
  >({
    mutationFn: async ({ id, statement }) => {
      const { idea } = await ideasClient.update<{ idea: ApiIdea }>(id, {
        statement,
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
    updateStatement: (id: string, statement: string) =>
      mutation.mutateAsync({ id, statement }),
    saving: mutation.isPending,
    error: mutation.error ? mutation.error.message : null,
  }
}
