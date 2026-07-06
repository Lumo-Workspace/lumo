'use client'

import { useQuery } from '@tanstack/react-query'
import { ideasClient } from '@/lib/api-client'
import { queryKeys } from '@/lib/query/keys'
import { ApiIdeaActivity } from '../types'

/**
 * An idea's activity timeline (LUM-680). Reads `GET /api/ideas/[id]/activity`,
 * oldest first. Invalidated by `useIdeaComments` when a comment is posted so a
 * COMMENT_ADDED entry appears without a manual refetch.
 */
export function useIdeaActivity(ideaId: string) {
  const query = useQuery<ApiIdeaActivity[]>({
    queryKey: queryKeys.ideas.activity(ideaId),
    queryFn: async () => {
      const data = await ideasClient.listActivity<{
        activity: ApiIdeaActivity[]
      }>(ideaId)
      return data.activity
    },
    staleTime: 30_000,
  })

  return {
    activity: query.data ?? [],
    loading: query.isLoading,
    error: query.error ? ((query.error as Error).message ?? 'error') : null,
  }
}
