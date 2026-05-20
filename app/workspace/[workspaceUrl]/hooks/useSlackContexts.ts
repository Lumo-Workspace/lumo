'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  slackContextsClient,
  type SlackContextResource,
} from '@/lib/api-client/slack-contexts'

interface UseSlackContextsResult {
  contexts: SlackContextResource[]
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
  link: (permalink: string) => Promise<void>
  refreshOne: (contextId: string) => Promise<void>
  unlink: (contextId: string) => Promise<void>
}

export function useSlackContexts(
  taskId: string,
  enabled = true
): UseSlackContextsResult {
  const [contexts, setContexts] = useState<SlackContextResource[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const { contexts } = await slackContextsClient.list(taskId)
      setContexts(contexts)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'unknown_error')
    } finally {
      setLoading(false)
    }
  }, [taskId])

  useEffect(() => {
    if (!enabled) return
    void refresh()
  }, [enabled, refresh])

  const link = useCallback(
    async (permalink: string) => {
      const { context } = await slackContextsClient.link(taskId, permalink)
      setContexts(prev => [context, ...prev])
    },
    [taskId]
  )

  const refreshOne = useCallback(
    async (contextId: string) => {
      const { context } = await slackContextsClient.refresh(taskId, contextId)
      setContexts(prev => prev.map(c => (c.id === contextId ? context : c)))
    },
    [taskId]
  )

  const unlink = useCallback(
    async (contextId: string) => {
      await slackContextsClient.unlink(taskId, contextId)
      setContexts(prev => prev.filter(c => c.id !== contextId))
    },
    [taskId]
  )

  return { contexts, loading, error, refresh, link, refreshOne, unlink }
}
