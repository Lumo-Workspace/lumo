'use client'

import { useState, useEffect, useCallback } from 'react'
import { statsClient } from '@/lib/api-client/stats'
import type { TaskSummaryStats, WorkspaceSummaryStats } from '@/types/summary'

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

  const fetch = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await statsClient.getProjectStats<{
        stats: TaskSummaryStats
      }>(projectId)
      setStats(data.stats)
    } catch {
      setError('Failed to load stats')
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    let cancelled = false
    fetch().then(() => {
      if (cancelled) setStats(null)
    })
    return () => {
      cancelled = true
    }
  }, [fetch])

  return { stats, loading, error, refetch: fetch }
}

export function useWorkspaceRealtimeStats(): UseRealtimeStatsReturn<WorkspaceSummaryStats> {
  const [stats, setStats] = useState<WorkspaceSummaryStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetch = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await statsClient.getWorkspaceStats<{
        stats: WorkspaceSummaryStats
      }>()
      setStats(data.stats)
    } catch {
      setError('Failed to load stats')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    fetch().then(() => {
      if (cancelled) setStats(null)
    })
    return () => {
      cancelled = true
    }
  }, [fetch])

  return { stats, loading, error, refetch: fetch }
}
