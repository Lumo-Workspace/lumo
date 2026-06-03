'use client'

import { useQuery } from '@tanstack/react-query'
import {
  milestonesClient,
  type ApiMilestone,
  type MilestoneListFilter,
} from '@/lib/api-client'
import { queryKeys } from '@/lib/query/keys'

/**
 * Project-scoped milestone list. Server response is enriched with
 * `taskCounts` per milestone so callers can render progress without
 * a follow-up fetch.
 *
 * `filter` selects by archive state (`active` excludes archived — the
 * default). It is part of the query key so each view caches independently;
 * existing prefix-based invalidations on `byProject(projectId)` still match.
 */
export function useMilestones(
  projectId: string | null | undefined,
  filter: MilestoneListFilter = 'active'
) {
  const query = useQuery<ApiMilestone[]>({
    queryKey: projectId
      ? [...queryKeys.milestones.byProject(projectId), filter]
      : ['milestones', 'byProject', 'disabled'],
    queryFn: async () => {
      const data = await milestonesClient.listByProject(
        projectId as string,
        filter
      )
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
