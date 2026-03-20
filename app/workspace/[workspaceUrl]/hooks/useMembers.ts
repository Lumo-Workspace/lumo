'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { WorkspaceMemberInfo } from '../types'
import { readCache, writeCache } from '../cache'

export function useMembers() {
  const [members, setMembers] = useState<WorkspaceMemberInfo[]>([])
  const fetching = useRef(false)

  useEffect(() => {
    // Seed from cache immediately for instant display
    const cached = readCache<WorkspaceMemberInfo[]>('lumo:members')
    if (cached) setMembers(cached)
  }, [])

  // Always re-fetches (stale-while-revalidate) so cache never goes stale
  const fetchMembers = useCallback(async () => {
    if (fetching.current) return
    fetching.current = true
    try {
      const res = await fetch('/api/workspaces/members')
      if (!res.ok) return
      const data = (await res.json()) as { members: WorkspaceMemberInfo[] }
      setMembers(data.members)
      writeCache('lumo:members', data.members)
    } catch {
      // Non-critical — assignee picker keeps current list
    } finally {
      fetching.current = false
    }
  }, [])

  return { members, fetchMembers }
}
