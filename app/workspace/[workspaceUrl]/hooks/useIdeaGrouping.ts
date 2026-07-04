'use client'

import { useQuery } from '@tanstack/react-query'
import { planRunsClient } from '@/lib/api-client/plan-runs'
import type { LatestClustering } from '@/lib/api-client/plan-runs'
import { queryKeys } from '@/lib/query/keys'

/**
 * Loads the clustering the Ideas page groups its pool by (LUM-677) — the latest
 * run's CLUSTER output, from `GET /api/plan-runs/latest-clustering`. Pure DB
 * read on the server (no clustering LLM call on page load). `clustering` is
 * null when no run has clustered yet, so the page falls back to a flat list.
 */
export function useIdeaGrouping() {
  const query = useQuery<LatestClustering | null>({
    queryKey: queryKeys.planRuns.latestClustering(),
    queryFn: async () => (await planRunsClient.latestClustering()).clustering,
    staleTime: 30_000,
  })

  return {
    clustering: query.data ?? null,
    loading: query.isLoading,
    error: query.error
      ? ((query.error as Error).message ?? 'Could not load clustering.')
      : null,
  }
}
