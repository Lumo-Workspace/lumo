'use client'

import { useQuery } from '@tanstack/react-query'
import { teamsClient } from '@/lib/api-client'
import type { ApiTeam } from '@/lib/api-client'
import { queryKeys } from '@/lib/query/keys'

/**
 * Fetches all teams in the current workspace.
 * Returns { teams, isLoading, error, refetch }.
 */
export function useWorkspaceTeams() {
  const query = useQuery<ApiTeam[]>({
    queryKey: queryKeys.teams(),
    queryFn: async () => {
      const res = await teamsClient.list()
      return res.teams
    },
  })

  return {
    teams: query.data ?? [],
    isLoading: query.isPending,
    error: (query.error as Error | undefined) ?? undefined,
    refetch: query.refetch,
  }
}
