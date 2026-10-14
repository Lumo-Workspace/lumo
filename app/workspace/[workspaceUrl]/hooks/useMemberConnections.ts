'use client'

import { useQuery } from '@tanstack/react-query'
import { workspacesClient } from '@/lib/api-client'
import { queryKeys } from '@/lib/query/keys'

/** LUM-1136: per-member agent connections + latest CLI for the members page. */
export function useMemberConnections() {
  const query = useQuery({
    queryKey: queryKeys.memberConnections(),
    queryFn: () => workspacesClient.listMemberConnections(),
    staleTime: 60 * 1000,
  })
  return {
    connections: query.data?.connections ?? {},
    latestCliVersion: query.data?.latestCliVersion ?? null,
    loading: query.isPending,
    /** The request failed — versions are unknown, not "not connected". */
    unavailable: query.isError,
  }
}
