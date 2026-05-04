'use client'

import { useCallback } from 'react'
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
    // Caller-driven (legacy fetchMembers semantics).
    enabled: false,
  })

  const fetchMembers = useCallback(async () => {
    await query.refetch()
  }, [query])

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
    agentActors: query.data?.agentActors ?? [],
  }
}
