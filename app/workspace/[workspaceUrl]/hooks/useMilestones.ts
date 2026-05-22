'use client'

import { useQuery } from '@tanstack/react-query'
import { milestonesClient, type ApiMilestone } from '@/lib/api-client'
import { queryKeys } from '@/lib/query/keys'

/**
 * Project-scoped milestone list. Server response is enriched with
 * `taskCounts` per milestone so callers can render progress without
 * a follow-up fetch.
 */
export function useMilestones(projectId: string | null | undefined) {
  const query = useQuery<ApiMilestone[]>({
    queryKey: projectId
      ? queryKeys.milestones.byProject(projectId)
      : ['milestones', 'byProject', 'disabled'],
    queryFn: async () => {
      const data = await milestonesClient.listByProject(projectId as string)
      return data.milestones
    },
    enabled: !!projectId,
  })

  return {
    milestones: query.data ?? [],
    loading: query.isPending && !!projectId,
    error: query.error
      ? ((query.error as Error).message ?? 'Could not load milestones.')
      : null,
    refetch: query.refetch,
  }
}
