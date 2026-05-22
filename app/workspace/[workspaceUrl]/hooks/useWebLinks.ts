'use client'

import { useCallback, useEffect, useState } from 'react'
import { webLinksClient } from '@/lib/api-client/task-web-links'
import type { TaskWebLink } from '@prisma/client'

interface UseWebLinksResult {
  webLinks: TaskWebLink[]
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
  add: (payload: { url: string; note?: string }) => Promise<void>
  remove: (linkId: string) => Promise<void>
  refreshOne: (linkId: string) => Promise<void>
}

export function useWebLinks(taskId: string, enabled = true): UseWebLinksResult {
  const [webLinks, setWebLinks] = useState<TaskWebLink[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const { webLinks } = await webLinksClient.list(taskId)
      setWebLinks(webLinks)
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

  const add = useCallback(
    async (payload: { url: string; note?: string }) => {
      const { webLink } = await webLinksClient.add(taskId, payload)
      setWebLinks(prev => [webLink, ...prev])
    },
    [taskId]
  )

  const remove = useCallback(
    async (linkId: string) => {
      await webLinksClient.remove(taskId, linkId)
      setWebLinks(prev => prev.filter(l => l.id !== linkId))
    },
    [taskId]
  )

  const refreshOne = useCallback(
    async (linkId: string) => {
      const { webLink } = await webLinksClient.refresh(taskId, linkId)
      setWebLinks(prev => prev.map(l => (l.id === linkId ? webLink : l)))
    },
    [taskId]
  )

  return { webLinks, loading, error, refresh, add, remove, refreshOne }
}
