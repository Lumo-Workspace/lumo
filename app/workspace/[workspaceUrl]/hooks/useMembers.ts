'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { WorkspaceMemberInfo } from '../types'
import { readCache, writeCache } from '../cache'
import { CACHE_KEY } from '../constants'
import { workspacesClient } from '@/lib/api-client'

export interface AgentActor {
  actorId: string
  name: string
  avatarColor: string
  type: string
}

export function useMembers() {
  const [members, setMembers] = useState<WorkspaceMemberInfo[]>([])
  const [agentActors, setAgentActors] = useState<AgentActor[]>([])
  const fetching = useRef(false)

  useEffect(() => {
    // Seed from cache immediately for instant display
    const cached = readCache<WorkspaceMemberInfo[]>(CACHE_KEY.members)
    if (cached) setMembers(cached)
    const cachedAgents = readCache<AgentActor[]>(CACHE_KEY.agentActors)
    if (cachedAgents) setAgentActors(cachedAgents)
  }, [])

  // Always re-fetches (stale-while-revalidate) so cache never goes stale
  const fetchMembers = useCallback(async () => {
    if (fetching.current) return
    fetching.current = true
    try {
      const data = await workspacesClient.listMembers<{
        members: WorkspaceMemberInfo[]
        agentActors?: AgentActor[]
      }>()
      setMembers(data.members)
      writeCache(CACHE_KEY.members, data.members)
      if (data.agentActors) {
        setAgentActors(data.agentActors)
        writeCache(CACHE_KEY.agentActors, data.agentActors)
      }
    } catch {
      // Non-critical — assignee picker keeps current list
    } finally {
      fetching.current = false
    }
  }, [])

  return { members, setMembers, fetchMembers, agentActors }
}
