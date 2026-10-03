'use client'

import { useQuery } from '@tanstack/react-query'
import { tasksClient } from '@/lib/api-client'
import { queryKeys } from '@/lib/query/keys'
import type { TaskStatusView } from '../types'

interface UseTaskStatusOptions {
  /** Task identifier (LUM-42); the status route resolves it or a cuid. */
  identifier: string
  /** When false the hook neither fetches nor reads cache (tab inactive). */
  enabled?: boolean
}

/**
 * Read-through cache for a task's status read model (LUM-344), consumed by the
 * read-only Record tab. Mirrors useTaskLineage: once cached for `identifier`,
 * tab switches paint instantly while a quiet background refetch keeps it fresh.
 */
export function useTaskStatus({
  identifier,
  enabled = true,
}: UseTaskStatusOptions) {
  const query = useQuery<TaskStatusView>({
    queryKey: queryKeys.taskStatus(identifier),
    queryFn: () => tasksClient.getStatus<TaskStatusView>(identifier),
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
