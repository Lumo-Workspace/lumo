'use client'

import { useCallback, useEffect, useState } from 'react'
import { webLinksClient } from '@/lib/api-client/task-web-links'
import type { TaskWebLink } from '@prisma/client'

// Optimistic placeholders share TaskWebLink's shape (so WebLinkCard works
// uniformly) but carry a tempId + loading flag. Server rows never have these.
export type OptimisticWebLink = TaskWebLink & {
  tempId?: string
  loading?: boolean
}

interface UseWebLinksResult {
  webLinks: OptimisticWebLink[]
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
  add: (payload: { url: string }) => Promise<void>
  remove: (linkId: string) => Promise<void>
  refreshOne: (linkId: string) => Promise<void>
}

function makeOptimisticPlaceholder(
  payload: { url: string },
  taskId: string
): OptimisticWebLink {
  let domain = ''
  try {
    domain = new URL(payload.url.trim()).hostname.toLowerCase()
  } catch {
    domain = payload.url
  }
  const tempId = `tmp_${Math.random().toString(36).slice(2, 10)}`
  // Cast: the optimistic row has only the fields the card reads; the rest are
  // never displayed during the loading state. We satisfy TaskWebLink's shape
  // with safe defaults.
  return {
    id: tempId,
    tempId,
    taskId,
    workspaceId: '',
    url: payload.url,
    domain,
    title: null,
    description: null,
    note: null,
    imageUrl: null,
    faviconUrl: null,
    fetchedAt: null,
    fetchError: null,
    createdById: '',
    createdAt: new Date(),
    updatedAt: new Date(),
    loading: true,
  }
}

export function useWebLinks(taskId: string, enabled = true): UseWebLinksResult {
  const [webLinks, setWebLinks] = useState<OptimisticWebLink[]>([])
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
    async (payload: { url: string }): Promise<void> => {
      const placeholder = makeOptimisticPlaceholder(payload, taskId)
      setWebLinks(prev => [placeholder, ...prev])
      try {
        const { webLink } = await webLinksClient.add(taskId, payload)
        setWebLinks(prev =>
          prev.map(l => (l.tempId === placeholder.tempId ? webLink : l))
        )
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'add failed'
        setWebLinks(prev =>
          prev.map(l =>
            l.tempId === placeholder.tempId
              ? { ...l, loading: false, fetchError: msg }
              : l
          )
        )
        throw e
      }
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
