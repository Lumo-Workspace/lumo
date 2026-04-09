'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import type { TimelineEntry, TimelineResponse } from '../types'
import { tasksClient } from '@/lib/api-client'
import { usePusherEvent } from './usePusher'
import { readCache, writeCache } from '../cache'
import { CACHE_KEY } from '../constants'

interface CachedTimeline {
  items: TimelineEntry[]
  hasMore: boolean
  nextCursor: string | null
}

interface UseTimelineOptions {
  taskId: string
  enabled?: boolean
}

export function useTimeline({ taskId, enabled = true }: UseTimelineOptions) {
  const cacheKey = CACHE_KEY.timeline(taskId)
  const cached = useRef(readCache<CachedTimeline>(cacheKey))

  const [entries, setEntries] = useState<TimelineEntry[]>(
    () => cached.current?.items ?? []
  )
  const [loading, setLoading] = useState(!cached.current)
  const [hasMore, setHasMore] = useState(cached.current?.hasMore ?? false)
  const [nextCursor, setNextCursor] = useState<string | null>(
    cached.current?.nextCursor ?? null
  )
  const [loadingMore, setLoadingMore] = useState(false)
  const initialFetched = useRef(false)

  const fetchTimeline = useCallback(
    async (cursor?: string | null) => {
      try {
        const data = await tasksClient.getTimeline<TimelineResponse>(
          taskId,
          cursor,
          30
        )
        return data
      } catch {
        return null
      }
    },
    [taskId]
  )

  // Initial load — always fetch to get fresh data, but don't show loading if cached
  useEffect(() => {
    if (!enabled || initialFetched.current) return
    initialFetched.current = true

    if (!cached.current) setLoading(true)
    fetchTimeline().then(data => {
      if (data) {
        setEntries(data.items)
        setHasMore(data.hasMore)
        setNextCursor(data.nextCursor)
        writeCache(cacheKey, {
          items: data.items,
          hasMore: data.hasMore,
          nextCursor: data.nextCursor,
        })
      }
      setLoading(false)
    })
  }, [enabled, fetchTimeline, cacheKey])

  // Load more (earlier entries)
  const loadMore = useCallback(async () => {
    if (!hasMore || loadingMore || !nextCursor) return
    setLoadingMore(true)

    const data = await fetchTimeline(nextCursor)
    if (data) {
      setEntries(prev => {
        const merged = [...data.items, ...prev]
        writeCache(cacheKey, {
          items: merged,
          hasMore: data.hasMore,
          nextCursor: data.nextCursor,
        })
        return merged
      })
      setHasMore(data.hasMore)
      setNextCursor(data.nextCursor)
    }
    setLoadingMore(false)
  }, [hasMore, loadingMore, nextCursor, fetchTimeline, cacheKey])

  // Realtime: append new activities
  usePusherEvent<{ type: string; entry: TimelineEntry }>(
    `task-${taskId}`,
    'activity-created',
    event => {
      if (event.entry) {
        setEntries(prev => {
          // Deduplicate by id
          if (prev.some(e => e.id === event.entry.id)) return prev
          const updated = [...prev, event.entry]
          writeCache(cacheKey, {
            items: updated,
            hasMore,
            nextCursor,
          })
          return updated
        })
      }
    }
  )

  // Refresh all entries (for comment updates via existing pusher events)
  const refresh = useCallback(async () => {
    const data = await fetchTimeline()
    if (data) {
      setEntries(data.items)
      setHasMore(data.hasMore)
      setNextCursor(data.nextCursor)
      writeCache(cacheKey, {
        items: data.items,
        hasMore: data.hasMore,
        nextCursor: data.nextCursor,
      })
    }
  }, [fetchTimeline, cacheKey])

  return {
    entries,
    loading,
    hasMore,
    loadingMore,
    loadMore,
    refresh,
  }
}
