'use client'

import { useQuery } from '@tanstack/react-query'
import type { RhEvidenceView } from '@/ee/security/services/reward-hack-evidence.service'
import { securityScanClient } from '@/ee/security/api-client'

export const rewardHackEvidenceQueryKey = (taskId: string, findingId: string) =>
  ['tasks', 'rewardHackEvidence', taskId, findingId] as const

/** LUM-1234: the evidence behind one REWARD_HACK finding, read on demand. */
export function useRewardHackEvidence(taskId: string, findingId: string) {
  const query = useQuery<RhEvidenceView>({
    queryKey: rewardHackEvidenceQueryKey(taskId, findingId),
    queryFn: () => securityScanClient.rewardHackEvidence(taskId, findingId),
    staleTime: 60 * 1000,
  })
  return {
    data: query.data,
    isLoading: query.isPending,
    isError: query.isError,
  }
}
