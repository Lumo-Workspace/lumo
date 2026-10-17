'use client'

import { useState, useEffect, useCallback } from 'react'
import { statsClient } from '@/lib/api-client/stats'
import type { TaskSummaryStats } from '@/types/summary'

interface UseRealtimeStatsReturn<T> {
  stats: T | null
  loading: boolean
  error: string | null
  refetch: () => void
}

export function useProjectRealtimeStats(
  projectId: string
): UseRealtimeStatsReturn<TaskSummaryStats> {
  const [stats, setStats] = useState<TaskSummaryStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    statsClient
      .getProjectStats<{ stats: TaskSummaryStats }>(projectId)
      .then(data => {
        if (!cancelled) setStats(data.stats)
      })
      .catch(() => {
        if (!cancelled) setError('Failed to load stats')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [projectId, tick])

  const refetch = useCallback(() => setTick(t => t + 1), [])

  return { stats, loading, error, refetch }
}
