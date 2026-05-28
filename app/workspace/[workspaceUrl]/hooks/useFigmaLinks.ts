'use client'

import { useCallback, useEffect, useState } from 'react'
import { taskFigmaLinksClient } from '@/lib/api-client/task-figma-links'
import type { FigmaLinkJson } from '@/lib/api-client/task-figma-links'

// Optimistic placeholders share FigmaLinkJson's shape but carry a tempId +
// loading flag. Server rows never have these.
export type OptimisticFigmaLink = FigmaLinkJson & {
  tempId?: string
  loading?: boolean
}

interface UseFigmaLinksResult {
  figmaLinks: OptimisticFigmaLink[]
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
  add: (payload: { url: string }) => Promise<void>
  remove: (linkId: string) => Promise<void>
  refreshAll: () => Promise<void>
}

function makeOptimisticPlaceholder(payload: {
  url: string
}): OptimisticFigmaLink {
  const tempId = `tmp_${Math.random().toString(36).slice(2, 10)}`
  return {
    id: tempId,
    tempId,
    fileKey: '',
    nodeId: '',
    url: payload.url,
    fileName: '',
    frameName: null,
    thumbnailUrl: null,
    thumbnailFetchedAt: null,
    lastSyncedAt: new Date().toISOString(),
    lastSyncError: null,
    createdAt: new Date().toISOString(),
    loading: true,
  }
}

export function useFigmaLinks(
  taskId: string,
  enabled = true
): UseFigmaLinksResult {
  const [figmaLinks, setFigmaLinks] = useState<OptimisticFigmaLink[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const { links } = await taskFigmaLinksClient.list(taskId)
      setFigmaLinks(links)
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
    async (payload: { url: string }): Promise<void> => {
      // For Figma-not-connected errors, surface to caller without optimistic add
      const placeholder = makeOptimisticPlaceholder(payload)
      setFigmaLinks(prev => [placeholder, ...prev])
      try {
        const { link } = await taskFigmaLinksClient.add(taskId, payload)
        setFigmaLinks(prev =>
          prev.map(l => (l.tempId === placeholder.tempId ? link : l))
        )
      } catch (e) {
        // Roll back the optimistic row
        setFigmaLinks(prev => prev.filter(l => l.tempId !== placeholder.tempId))
        // Re-throw so callers (popover) can surface the error
        throw e
      }
    },
    [taskId]
  )

  const remove = useCallback(
    async (linkId: string) => {
      await taskFigmaLinksClient.remove(taskId, linkId)
      setFigmaLinks(prev => prev.filter(l => l.id !== linkId))
    },
    [taskId]
  )

  const refreshAll = useCallback(async () => {
    const { results } = await taskFigmaLinksClient.refreshAll(taskId)
    // After a bulk refresh, re-fetch the list to get updated thumbnails
    if (results.some(r => r.ok)) {
      await refresh()
    }
  }, [taskId, refresh])

  return { figmaLinks, loading, error, refresh, add, remove, refreshAll }
}
