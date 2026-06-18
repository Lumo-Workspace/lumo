'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { memoriesClient, type RetireCandidate } from '@/lib/api-client'
import { queryKeys } from '@/lib/query/keys'

/**
 * LUM-540 (P4a) — the project's retire candidates + the human-confirm action.
 * Candidacy is DERIVED (recomputed each load), so there's no optimistic cache to
 * mutate; confirming retires the memory through the existing status machine and
 * then invalidates both the candidate list and the memory list (the retired row
 * leaves ACTIVE and drops out of both). Read returns [] (never throws) so a
 * candidate-fetch failure never blocks the memory tab. PROJECT scope only.
 */
export function useRetireCandidates(projectId: string, enabled = true) {
  const queryClient = useQueryClient()

  const query = useQuery<RetireCandidate[]>({
    queryKey: queryKeys.retireCandidates(projectId),
    queryFn: async () =>
      (await memoriesClient.retireCandidates(projectId)).candidates,
    enabled: enabled && !!projectId,
  })

  const confirmMutation = useMutation<{ retired: number }, Error, string>({
    mutationFn: memoryId => memoriesClient.confirmRetire(memoryId),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.retireCandidates(projectId),
      })
      queryClient.invalidateQueries({ queryKey: ['memories', 'project'] })
    },
  })

  return {
    candidates: query.data ?? [],
    confirmRetire: (memoryId: string) => confirmMutation.mutateAsync(memoryId),
    confirming: confirmMutation.isPending,
  }
}
