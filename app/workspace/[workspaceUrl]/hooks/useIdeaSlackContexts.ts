'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  ideaSlackContextsClient,
  type IdeaSlackContextResource,
} from '@/lib/api-client/idea-slack-contexts'

interface UseIdeaSlackContextsResult {
  contexts: IdeaSlackContextResource[]
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
  link: (permalink: string) => Promise<void>
  refreshOne: (contextId: string) => Promise<void>
  unlink: (contextId: string) => Promise<void>
}

export function useIdeaSlackContexts(
  ideaId: string,
  enabled = true
): UseIdeaSlackContextsResult {
  const [contexts, setContexts] = useState<IdeaSlackContextResource[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const { contexts } = await ideaSlackContextsClient.list(ideaId)
      setContexts(contexts)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'unknown_error')
    } finally {
      setLoading(false)
    }
  }, [ideaId])

  useEffect(() => {
    if (!enabled) return
    void refresh()
  }, [enabled, refresh])

  const link = useCallback(
    async (permalink: string) => {
      const { context } = await ideaSlackContextsClient.link(ideaId, permalink)
      setContexts(prev => [context, ...prev])
    },
    [ideaId]
  )

  const refreshOne = useCallback(
    async (contextId: string) => {
      const { context } = await ideaSlackContextsClient.refresh(
        ideaId,
        contextId
      )
      setContexts(prev => prev.map(c => (c.id === contextId ? context : c)))
    },
    [ideaId]
  )

  const unlink = useCallback(
    async (contextId: string) => {
      await ideaSlackContextsClient.unlink(ideaId, contextId)
      setContexts(prev => prev.filter(c => c.id !== contextId))
    },
    [ideaId]
  )

  return { contexts, loading, error, refresh, link, refreshOne, unlink }
}
