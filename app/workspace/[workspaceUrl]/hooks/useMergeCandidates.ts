'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { memoriesClient, type MergeProposal } from '@/lib/api-client'
import { queryKeys } from '@/lib/query/keys'

/**
 * LUM-541 (P5) — a project's near-dup merge proposals + the human-confirm action.
 * Candidacy is DERIVED (recomputed each load), so there's no optimistic cache to
 * mutate; confirming archives the superseded duplicates through the existing
 * status machine and then invalidates the proposal list and the memory list (the
 * archived rows leave ACTIVE and drop out of both). Read returns [] (never
 * throws) so a candidate-fetch failure never blocks the memory tab. PROJECT
 * scope only.
 */
export function useMergeCandidates(projectId: string, enabled = true) {
  const queryClient = useQueryClient()

  const query = useQuery<MergeProposal[]>({
    queryKey: queryKeys.mergeCandidates(projectId),
    queryFn: async () =>
      (await memoriesClient.mergeCandidates(projectId)).candidates,
    enabled: enabled && !!projectId,
  })

  const confirmMutation = useMutation<
    { merged: number },
    Error,
    { canonicalId: string; supersededIds: string[] }
  >({
    mutationFn: body => memoriesClient.confirmMerge(projectId, body),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.mergeCandidates(projectId),
      })
      queryClient.invalidateQueries({ queryKey: ['memories', 'project'] })
    },
  })

  return {
    candidates: query.data ?? [],
    confirmMerge: (canonicalId: string, supersededIds: string[]) =>
      confirmMutation.mutateAsync({ canonicalId, supersededIds }),
    confirming: confirmMutation.isPending,
  }
}
