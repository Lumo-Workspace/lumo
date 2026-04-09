'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import type { TimelineEntry, TimelineResponse } from '../types'
import { tasksClient } from '@/lib/api-client'
import { usePusherEvent } from './usePusher'

interface UseTimelineOptions {
  taskId: string
  enabled?: boolean
}

export function useTimeline({ taskId, enabled = true }: UseTimelineOptions) {
  const [entries, setEntries] = useState<TimelineEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [hasMore, setHasMore] = useState(false)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
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

  // Initial load
  useEffect(() => {
    if (!enabled || initialFetched.current) return
    initialFetched.current = true

    setLoading(true)
    fetchTimeline().then(data => {
      if (data) {
        setEntries(data.items)
        setHasMore(data.hasMore)
        setNextCursor(data.nextCursor)
      }
      setLoading(false)
    })
  }, [enabled, fetchTimeline])

  // Load more (earlier entries)
  const loadMore = useCallback(async () => {
    if (!hasMore || loadingMore || !nextCursor) return
    setLoadingMore(true)

    const data = await fetchTimeline(nextCursor)
    if (data) {
      setEntries(prev => [...data.items, ...prev])
      setHasMore(data.hasMore)
      setNextCursor(data.nextCursor)
    }
    setLoadingMore(false)
  }, [hasMore, loadingMore, nextCursor, fetchTimeline])

  // Realtime: append new activities
  usePusherEvent<{ type: string; entry: TimelineEntry }>(
    `task-${taskId}`,
    'activity-created',
    event => {
      if (event.entry) {
        setEntries(prev => {
          // Deduplicate by id
          if (prev.some(e => e.id === event.entry.id)) return prev
          return [...prev, event.entry]
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
    }
  }, [fetchTimeline])

  return {
    entries,
    loading,
    hasMore,
    loadingMore,
    loadMore,
    refresh,
  }
}
