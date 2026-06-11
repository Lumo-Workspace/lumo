'use client'

import { useQuery } from '@tanstack/react-query'
import { tasksClient } from '@/lib/api-client'
import { queryKeys } from '@/lib/query/keys'
import type { TaskAcceptanceStatusView } from '../types'

interface UseTaskStatusOptions {
  /** Task identifier (LUM-42); the status route resolves it or a cuid. */
  identifier: string
  /** When false the hook neither fetches nor reads cache (tab inactive). */
  enabled?: boolean
}

/**
 * Read-through cache for a task's acceptance-status read model (LUM-344),
 * consumed by the read-only Acceptance tab (LUM-423). Mirrors useTaskLineage:
 * once cached for `identifier`, tab switches paint instantly while a quiet
 * background refetch keeps it fresh. Read-only — no mutations, no new backend.
 */
export function useTaskStatus({
  identifier,
  enabled = true,
}: UseTaskStatusOptions) {
  const query = useQuery<TaskAcceptanceStatusView>({
    queryKey: queryKeys.taskStatus(identifier),
    queryFn: () => tasksClient.getStatus<TaskAcceptanceStatusView>(identifier),
    enabled: !!identifier && enabled,
  })

  return {
    data: query.data ?? null,
    loading: query.isPending && !!identifier && enabled,
    error: query.error
      ? ((query.error as Error).message ?? 'Failed to load status')
      : null,
    refresh: query.refetch,
  }
}
