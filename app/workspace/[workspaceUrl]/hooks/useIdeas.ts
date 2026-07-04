'use client'

import { useQuery } from '@tanstack/react-query'
import { ApiIdea } from '../types'
import { ideasClient } from '@/lib/api-client'
import { queryKeys } from '@/lib/query/keys'

/**
 * Loads the team's idea pool (every status, newest first) from `GET /api/ideas`
 * via the api-client. Mirrors the self-fetching page hooks (sprints, milestone
 * detail): the pool page owns its own data rather than being prop-drilled from
 * `WorkspaceApp`. Fetches on mount and dedupes for 30s.
 */
export function useIdeas() {
  const query = useQuery<ApiIdea[]>({
    queryKey: queryKeys.ideas.all(),
    queryFn: async () => {
      const data = await ideasClient.listPool<{ ideas: ApiIdea[] }>()
      return data.ideas
    },
    staleTime: 30_000,
  })

  return {
    ideas: query.data ?? [],
    loading: query.isLoading,
    error: query.error
      ? ((query.error as Error).message ?? 'Could not load ideas.')
      : null,
    refetch: query.refetch,
  }
}
