'use client'

import { useMemo } from 'react'
import {
  useInfiniteQuery,
  useQueryClient,
  type InfiniteData,
} from '@tanstack/react-query'
import type { TimelineEntry, TimelineResponse } from '../types'
import { tasksClient } from '@/lib/api-client'
import { queryKeys } from '@/lib/query/keys'
import { usePusherEvent } from './usePusher'

interface UseTimelineOptions {
  taskId: string
  enabled?: boolean
}

/**
 * Paginated task-activity timeline backed by useInfiniteQuery. Pages are
 * fetched newest-first (initial = newest 30, loadMore = next 30 older).
 * The returned `entries` array is flattened oldest→newest to match the
 * pre-migration ordering, so callers can render top-to-bottom.
 */
export function useTimeline({ taskId, enabled = true }: UseTimelineOptions) {
  const queryClient = useQueryClient()
  const queryKey = queryKeys.timeline(taskId)

  const query = useInfiniteQuery<
    TimelineResponse,
    Error,
    InfiniteData<TimelineResponse, string | null>,
    typeof queryKey,
    string | null
  >({
    queryKey,
    initialPageParam: null,
    queryFn: ({ pageParam }) =>
      tasksClient.getTimeline<TimelineResponse>(taskId, pageParam, 30),
    getNextPageParam: lastPage =>
      lastPage.hasMore ? lastPage.nextCursor : null,
    enabled,
  })

  // pages[0] = initial fetch (newest 30); subsequent pages are 30 older each.
  // Flatten oldest→newest by reversing the page order first.
  const entries = useMemo<TimelineEntry[]>(() => {
    if (!query.data) return []
    return [...query.data.pages].reverse().flatMap(p => p.items)
  }, [query.data])

  const lastPage = query.data?.pages[query.data.pages.length - 1]
  const hasMore = lastPage?.hasMore ?? false

  // Realtime: prepend new activities to pages[0] (which renders at the end
  // of the flattened entries — i.e. newest position).
  usePusherEvent<{ type: string; entry: TimelineEntry }>(
    `task-${taskId}`,
    'activity-created',
    event => {
      if (!event.entry) return
      queryClient.setQueryData<InfiniteData<TimelineResponse, string | null>>(
        queryKey,
        prev => {
          if (!prev || prev.pages.length === 0) return prev
          const newest = prev.pages[0]
          if (!newest || newest.items.some(e => e.id === event.entry.id)) {
            return prev
          }
          const newestUpdated: TimelineResponse = {
            ...newest,
            items: [...newest.items, event.entry],
          }
          return {
            ...prev,
            pages: [newestUpdated, ...prev.pages.slice(1)],
          }
        }
      )
    }
  )

  return {
    entries,
    loading: query.isLoading,
    hasMore,
    loadingMore: query.isFetchingNextPage,
    loadMore: () => query.fetchNextPage(),
    refresh: () => query.refetch(),
  }
}
