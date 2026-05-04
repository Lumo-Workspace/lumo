'use client'

import { useQuery } from '@tanstack/react-query'
import { tasksClient } from '@/lib/api-client'
import type { AgentRunTimelineResponse } from '../types'

interface UseAgentRunsOptions {
  taskId: string
  /** When false the hook neither fetches nor reads cache — used to keep
   *  the badge query alive when the tab is mounted but inactive. */
  enabled?: boolean
}

/**
 * Read-through cache for the Agent Run timeline. Once the QueryClient has
 * cached data for `taskId`, tab switches paint instantly while a quiet
 * background refetch keeps it fresh.
 */
export function useAgentRuns({ taskId, enabled = true }: UseAgentRunsOptions) {
  const query = useQuery<AgentRunTimelineResponse>({
    queryKey: ['agentRuns', taskId] as const,
    queryFn: () =>
      tasksClient.getAgentRuns<AgentRunTimelineResponse>(
        taskId
      ) as Promise<AgentRunTimelineResponse>,
    enabled: !!taskId && enabled,
  })

  return {
    data: query.data ?? null,
    loading: query.isPending && !!taskId && enabled,
    error: query.error
      ? ((query.error as Error).message ?? 'Failed to load agent runs')
      : null,
    refresh: query.refetch,
  }
}
