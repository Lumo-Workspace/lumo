'use client'

import { useEffect, useState, useCallback } from 'react'
import { teamsClient } from '@/lib/api-client'
import type { ApiTeam } from '@/lib/api-client'

/**
 * Fetches all teams in the current workspace.
 * Returns { teams, isLoading, error, refetch }.
 */
export function useWorkspaceTeams() {
  const [teams, setTeams] = useState<ApiTeam[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<Error | undefined>(undefined)
  const [tick, setTick] = useState(0)

  const refetch = useCallback(() => setTick(t => t + 1), [])

  useEffect(() => {
    let cancelled = false
    setIsLoading(true)
    setError(undefined)
    teamsClient
      .list()
      .then(res => {
        if (!cancelled) setTeams(res.teams)
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
