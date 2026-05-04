'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { tasksClient } from '@/lib/api-client'
import type { AgentRunTimelineResponse } from '../types'
import { readCache, writeCache } from '../cache'
import { CACHE_KEY } from '../constants'

interface UseAgentRunsOptions {
  taskId: string
  /** When false the hook neither fetches nor reads cache — used to keep
   *  the badge query alive when the tab is mounted but inactive. */
  enabled?: boolean
}

/**
 * Read-through cache for the Agent Run timeline. The agent-runs payload
 * for a busy task can be megabytes (hundreds of hook events), so a
 * cold network round-trip on every tab switch is the user-visible
 * "feels slow" path. Pattern mirrors {@link useTimeline}:
 *
 *   1. Synchronously read localStorage on mount → render instantly
 *   2. Kick off a background fetch → refresh whether stale or not
 *   3. Write the fresh payload back to cache for next mount
 *
 * `loading` is only true on a cold-cache cold-fetch — once we have any
 * cached data the UI never goes through a loading state, only a quiet
 * refresh.
 */
export function useAgentRuns({ taskId, enabled = true }: UseAgentRunsOptions) {
  const cacheKey = CACHE_KEY.agentRuns(taskId)
  const cached = useRef(readCache<AgentRunTimelineResponse>(cacheKey))

  const [data, setData] = useState<AgentRunTimelineResponse | null>(
    () => cached.current
  )
  const [loading, setLoading] = useState(!cached.current)
  const [error, setError] = useState<string | null>(null)

  const fetchRuns = useCallback(async () => {
    setError(null)
    try {
      const result =
        await tasksClient.getAgentRuns<AgentRunTimelineResponse>(taskId)
      setData(result)
      writeCache(cacheKey, result)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load agent runs')
    } finally {
      setLoading(false)
    }
  }, [taskId, cacheKey])

  useEffect(() => {
    if (!enabled) return
    fetchRuns()
  }, [enabled, fetchRuns])

  return { data, loading, error, refresh: fetchRuns }
}
