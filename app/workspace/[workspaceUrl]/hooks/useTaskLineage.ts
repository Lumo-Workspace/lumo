'use client'

import { useQuery } from '@tanstack/react-query'
import { tasksClient } from '@/lib/api-client'
import { queryKeys } from '@/lib/query/keys'
import type { LineageResponse } from '../types'

interface UseTaskLineageOptions {
  /** Task identifier (LUM-42), not the cuid — the lineage route resolves it. */
  identifier: string
  /** When false the hook neither fetches nor reads cache (tab inactive). */
  enabled?: boolean
}

/**
 * Read-through cache for a task's lineage causal trail (LUM-297). Mirrors
 * useAgentRuns: once cached for `identifier`, tab switches paint instantly
 * while a quiet background refetch keeps it fresh. Read-only — no mutations.
 */
export function useTaskLineage({
  identifier,
  enabled = true,
}: UseTaskLineageOptions) {
  const query = useQuery<LineageResponse>({
    queryKey: queryKeys.lineage(identifier),
    queryFn: () => tasksClient.getLineage<LineageResponse>(identifier),
    enabled: !!identifier && enabled,
  })

  return {
    data: query.data ?? null,
    loading: query.isPending && !!identifier && enabled,
    error: query.error
      ? ((query.error as Error).message ?? 'Failed to load lineage')
      : null,
    refresh: query.refetch,
  }
}
