'use client'

import { useQuery } from '@tanstack/react-query'
import { sprintsClient } from '@/lib/api-client'

/**
 * Fetches the active sprint IDs for all teams the current user belongs to.
 * Used by the "Current sprint only" filter chip on the My Tasks page.
 */
export function useMyActiveSprints() {
  const query = useQuery<string[]>({
    queryKey: ['sprints', 'myActive'] as const,
    queryFn: async () => {
      const data = await sprintsClient.myActiveSprintIds()
      return data.sprintIds
    },
  })

  return {
    sprintIds: query.data ?? [],
    loading: query.isPending,
    error: query.error
      ? ((query.error as Error).message ?? 'Could not load active sprints.')
      : null,
  }
}
