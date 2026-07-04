'use client'

import { useQuery } from '@tanstack/react-query'
import { planRunsClient } from '@/lib/api-client/plan-runs'
import type { PlanRunListRow } from '@/lib/api-client/plan-runs'
import { queryKeys } from '@/lib/query/keys'

/**
 * Loads the team's plan runs (active + terminal, newest first) from
 * `GET /api/plan-runs` via the api-client, so the Ideas page can surface them
 * without the CLI deep-link (LUM-677). Mirrors `useIdeas`: the page owns its
 * own data rather than being prop-drilled. Fetches on mount, dedupes 30s.
 */
export function usePlanRuns() {
  const query = useQuery<PlanRunListRow[]>({
    queryKey: queryKeys.planRuns.list(),
    queryFn: async () => (await planRunsClient.list()).runs,
    staleTime: 30_000,
  })

  return {
    runs: query.data ?? [],
    loading: query.isLoading,
    error: query.error
      ? ((query.error as Error).message ?? 'Could not load plan runs.')
      : null,
    refetch: query.refetch,
  }
}
