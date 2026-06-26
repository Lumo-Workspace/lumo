'use client'

import { useCallback, useRef } from 'react'
import { useQuery, useQueryClient, type Updater } from '@tanstack/react-query'
import { WorkspaceMemberInfo } from '../types'
import { workspacesClient } from '@/lib/api-client'
import { queryKeys } from '@/lib/query/keys'

export interface AgentActor {
  actorId: string
  name: string
  avatarColor: string
  type: string
}

interface MembersData {
  members: WorkspaceMemberInfo[]
  agentActors: AgentActor[]
}

// Members rarely change within a session; a generous staleTime lets every
// page read the shared cache without refetching on navigation.
const MEMBERS_STALE_TIME = 5 * 60 * 1000 // 5 minutes

export function useMembers() {
  const queryClient = useQueryClient()

  const query = useQuery<MembersData>({
    queryKey: queryKeys.members(),
    queryFn: async () => {
      const data = await workspacesClient.listMembers<{
        members: WorkspaceMemberInfo[]
        agentActors?: AgentActor[]
      }>()
      return {
        members: data.members,
        agentActors: data.agentActors ?? [],
      }
    },
    // Shared workspace-global cache: the first consumer to mount fetches once,
    // every other consumer (and remounts within staleTime) reads that cache.
    // React Query dedupes concurrent requests under the same key, so pages no
    // longer each fire their own listMembers() — eliminating the dropdown
    // flicker and duplicate concurrent requests of the old caller-driven design.
    staleTime: MEMBERS_STALE_TIME,
  })

  // Pin `query` so `fetchMembers` is referentially stable across renders.
  const queryRef = useRef(query)
  queryRef.current = query

  const fetchMembers = useCallback(async () => {
    await queryRef.current.refetch()
  }, [])

  // Invalidate after a membership mutation (invite accepted / role change /
  // removal) so every page reconciles instead of waiting out staleTime.
  const invalidateMembers = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.members() })
  }, [queryClient])

  const setMembers = useCallback(
    (updater: Updater<WorkspaceMemberInfo[], WorkspaceMemberInfo[]>) => {
      queryClient.setQueryData<MembersData>(queryKeys.members(), prev => {
        const prevMembers = prev?.members ?? []
        const nextMembers =
          typeof updater === 'function'
            ? (
                updater as (
                  prev: WorkspaceMemberInfo[]
                ) => WorkspaceMemberInfo[]
              )(prevMembers)
            : updater
        return {
          members: nextMembers,
          agentActors: prev?.agentActors ?? [],
        }
      })
    },
    [queryClient]
  )

  return {
    members: query.data?.members ?? [],
    setMembers,
    fetchMembers,
    invalidateMembers,
    agentActors: query.data?.agentActors ?? [],
  }
}
