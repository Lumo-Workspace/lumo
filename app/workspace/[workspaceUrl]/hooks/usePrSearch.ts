'use client'

import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { tasksClient } from '@/lib/api-client'
import { queryKeys } from '@/lib/query/keys'
import type { ApiPullRequestSearchResult } from '../types'

const DEBOUNCE_MS = 300
const SEARCH_LIMIT = 10

interface UsePrSearchResult {
  results: ApiPullRequestSearchResult[]
  loading: boolean
}

/**
 * Debounced PR search backed by TanStack Query. The query key carries the
 * debounced term so repeating a search (or reopening the popover) within
 * `staleTime` is served from cache instead of re-hitting the API.
 *
 * `enabled` lets the caller gate searching on popover-open state and on the
 * input not being a direct PR URL (the URL case is handled inline by the
 * caller, not searched).
 */
export function usePrSearch(
  workspaceId: string,
  query: string,
  enabled: boolean
): UsePrSearchResult {
  const trimmed = query.trim()
  const [debounced, setDebounced] = useState(trimmed)

  // Debounce the raw input before it reaches the query key.
  useEffect(() => {
    const handle = setTimeout(() => setDebounced(trimmed), DEBOUNCE_MS)
    return () => clearTimeout(handle)
  }, [trimmed])

  const active = enabled && trimmed !== ''
  const canFetch = enabled && debounced !== ''

  const result = useQuery({
    queryKey: queryKeys.prSearch(workspaceId, debounced),
    queryFn: () =>
      tasksClient.searchPrs<{ pullRequests: ApiPullRequestSearchResult[] }>(
        workspaceId,
        debounced,
        SEARCH_LIMIT
      ),
    enabled: canFetch,
    staleTime: 30_000,
  })

  // Show the spinner from the first keystroke (while the debounce is pending)
  // through the network round-trip, matching the old imperative UX.
  const loading = active && (trimmed !== debounced || result.isFetching)

  return {
    results: active ? (result.data?.pullRequests ?? []) : [],
    loading,
  }
}
