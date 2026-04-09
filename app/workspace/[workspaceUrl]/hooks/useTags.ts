'use client'

import { useState, useEffect, useCallback } from 'react'
import { tagsClient } from '@/lib/api-client'
import type { ApiTag } from '../types'

/**
 * Hook to manage the workspace tag pool.
 * Fetches all tags on mount and provides create/refresh methods.
 */
export function useTags() {
  const [tags, setTags] = useState<ApiTag[]>([])
  const [loading, setLoading] = useState(true)

  const fetchTags = useCallback(async () => {
    try {
      const data = await tagsClient.list<{ tags: ApiTag[] }>()
      setTags(data.tags)
    } catch {
      // silently fail
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchTags()
  }, [fetchTags])

  const createTag = useCallback(
    async (name: string): Promise<ApiTag | null> => {
      try {
        const data = await tagsClient.create<{ tag: ApiTag }>({ name })
        setTags(prev =>
          [...prev, data.tag].sort((a, b) => a.name.localeCompare(b.name))
        )
        return data.tag
      } catch {
        return null
      }
    },
    []
  )

  return { tags, loading, createTag, refreshTags: fetchTags }
}
