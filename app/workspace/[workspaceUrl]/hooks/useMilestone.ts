'use client'

import { useQuery } from '@tanstack/react-query'
import { milestonesClient, type ApiMilestone } from '@/lib/api-client'
import { queryKeys } from '@/lib/query/keys'

/**
 * Single-milestone detail. Returns `null` until the id resolves; downstream
 * components should null-guard while loading.
 */
export function useMilestone(milestoneId: string | null | undefined) {
  const query = useQuery<ApiMilestone | null>({
    queryKey: milestoneId
      ? queryKeys.milestones.detail(milestoneId)
      : ['milestones', 'detail', 'disabled'],
    queryFn: async () => {
      const data = await milestonesClient.getById(milestoneId as string)
      return data.milestone
    },
    enabled: !!milestoneId,
  })

  return {
    milestone: query.data ?? null,
    loading: query.isPending && !!milestoneId,
    error: query.error
      ? ((query.error as Error).message ?? 'Could not load milestone.')
      : null,
  }
}
