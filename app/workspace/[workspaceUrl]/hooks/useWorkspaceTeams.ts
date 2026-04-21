'use client'

import { useEffect, useState, useCallback } from 'react'
import { teamsClient } from '@/lib/api-client'
import type { ApiTeam } from '@/lib/api-client'
import { CACHE_KEY } from '../constants'
import { readCache, writeCache } from '../cache'

/**
 * Fetches all teams in the current workspace.
 *
 * Hydrates from localStorage on mount so consumers (sidebar visibility,
 * sprints chip, etc.) render with the last-known team list immediately,
 * then refreshes in the background. Subsequent navigations don't flash
 * a missing 'Sprints' menu item while the network round-trip lands.
 *
 * Returns { teams, isLoading, error, refetch }.
 */
export function useWorkspaceTeams() {
  // SSR-safe: read cache only inside useState initializer; never on first
  // server render.
  const [teams, setTeams] = useState<ApiTeam[]>(() => {
    if (typeof window === 'undefined') return []
    return readCache<ApiTeam[]>(CACHE_KEY.teams) ?? []
  })
  // If we have a cached value we don't need to flash a loading state.
  const [isLoading, setIsLoading] = useState(() => {
    if (typeof window === 'undefined') return true
    return readCache<ApiTeam[]>(CACHE_KEY.teams) === null
  })
  const [error, setError] = useState<Error | undefined>(undefined)
  const [tick, setTick] = useState(0)

  const refetch = useCallback(() => setTick(t => t + 1), [])

  useEffect(() => {
    let cancelled = false
    teamsClient
      .list()
      .then(res => {
        if (cancelled) return
        setTeams(res.teams)
        writeCache(CACHE_KEY.teams, res.teams)
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err)
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [tick])

  return { teams, isLoading, error, refetch }
}
