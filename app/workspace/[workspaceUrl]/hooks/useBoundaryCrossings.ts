'use client'

import { useQuery } from '@tanstack/react-query'
import { tasksClient } from '@/lib/api-client'
import { queryKeys } from '@/lib/query/keys'

export interface BoundaryCrossingView {
  id: string
  category: string
  detail: string
  detectedAt: string
}

interface BoundaryCrossingsResponse {
  crossings: BoundaryCrossingView[]
}

interface UseBoundaryCrossingsOptions {
  /** Task identifier (LUM-42); the route resolves it or a cuid. */
  identifier: string
  /** When false the hook neither fetches nor reads cache (tab inactive). */
  enabled?: boolean
}

/**
 * Read-through cache for a task's open (unacknowledged) boundary-crossings
 * (LUM-426), consumed by the AcceptanceTab panel. Mirrors useTaskStatus: once
 * cached for `identifier`, tab switches paint instantly while a quiet
 * background refetch keeps it fresh.
 */
export function useBoundaryCrossings({
  identifier,
  enabled = true,
}: UseBoundaryCrossingsOptions) {
  const query = useQuery<BoundaryCrossingsResponse>({
    queryKey: queryKeys.boundaryCrossings(identifier),
    queryFn: () =>
      tasksClient.listBoundaryCrossings<BoundaryCrossingsResponse>(identifier),
    enabled: !!identifier && enabled,
  })

  return {
    crossings: query.data?.crossings ?? [],
    loading: query.isPending && !!identifier && enabled,
    error: query.error
      ? ((query.error as Error).message ?? 'Failed to load boundary crossings')
      : null,
    refresh: query.refetch,
  }
}
