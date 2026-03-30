'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { WorkspaceMemberInfo } from '../types'
import { readCache, writeCache, CACHE_TTL } from '../cache'
import { API, CACHE_KEY } from '../constants'

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
    const cached = readCache<WorkspaceMemberInfo[]>(
      CACHE_KEY.members,
      CACHE_TTL.long
    )
    if (cached) setMembers(cached)
    const cachedAgents = readCache<AgentActor[]>(
      CACHE_KEY.agentActors,
      CACHE_TTL.long
    )
    if (cachedAgents) setAgentActors(cachedAgents)
  }, [])

  // Always re-fetches (stale-while-revalidate) so cache never goes stale
  const fetchMembers = useCallback(async () => {
    if (fetching.current) return
    fetching.current = true
    try {
      const res = await fetch(API.workspaces.members)
      if (!res.ok) return
      const data = (await res.json()) as {
        members: WorkspaceMemberInfo[]
        agentActors?: AgentActor[]
      }
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
