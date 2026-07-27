'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ideasClient } from '@/lib/api-client'
import { queryKeys } from '@/lib/query/keys'
import { ApiIdea } from '../types'

/**
 * Mutation for the Ideas page's inline capture input (LUM-708) — the web
 * counterpart of `lumo idea "<statement>"`. POSTs `/api/ideas` via the
 * api-client, then prepends the created idea to the pool cache
 * (`queryKeys.ideas.all()`) so the new row appears without a refetch; the API
 * already returns the pool newest-first, so the head is its place.
 *
 * Container-owned like `useUpdateIdea`: the pool page wires `capture` into the
 * view's input, keeping the view presentational (SRP).
 */
export function useCaptureIdea() {
  const queryClient = useQueryClient()

  const mutation = useMutation<ApiIdea, Error, { statement: string }>({
    mutationFn: async ({ statement }) => {
      const { idea } = await ideasClient.capture<{ idea: ApiIdea }>({
        statement,
      })
      return idea
    },
    onSuccess: created => {
      queryClient.setQueryData<ApiIdea[]>(queryKeys.ideas.all(), prev =>
        prev ? [created, ...prev] : prev
      )
    },
  })

  return {
    capture: (statement: string) => mutation.mutateAsync({ statement }),
    capturing: mutation.isPending,
    error: mutation.error ? mutation.error.message : null,
  }
}
