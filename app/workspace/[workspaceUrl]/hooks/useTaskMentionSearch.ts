'use client'

import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useParams } from 'next/navigation'
import { mentionSearchClient } from '@/lib/api-client/mention-search'
import { queryKeys } from '@/lib/query/keys'
import type { MentionSearchItem } from '@/types/mention'

const DEBOUNCE_MS = 200
const SEARCH_LIMIT = 10

interface UseTaskMentionSearchResult {
  results: MentionSearchItem[]
  loading: boolean
}

/** Task hits only, minus the task the picker is attached to. */
export function pickTaskResults(
  items: MentionSearchItem[],
  excludeIdentifier: string
): MentionSearchItem[] {
  return items.filter(i => i.kind === 'task' && i.label !== excludeIdentifier)
}

/**
 * Debounced task search for pickers (LUM-1340), backed by TanStack Query so a
 * repeated term is served from cache and a slow, stale response can never
 * overwrite a newer one — the query key carries the term it answers.
 */
export function useTaskMentionSearch(
  query: string,
  excludeIdentifier: string,
  enabled: boolean
): UseTaskMentionSearchResult {
  const params = useParams<{ workspaceUrl?: string }>()
  const workspaceUrl = params?.workspaceUrl ?? ''
  const trimmed = query.trim()
  const [debounced, setDebounced] = useState(trimmed)

  useEffect(() => {
    const handle = setTimeout(() => setDebounced(trimmed), DEBOUNCE_MS)
    return () => clearTimeout(handle)
  }, [trimmed])

  const active = enabled && trimmed !== ''

  const result = useQuery({
    queryKey: queryKeys.mentionSearch(workspaceUrl, debounced, SEARCH_LIMIT),
    queryFn: () => mentionSearchClient.search(debounced, SEARCH_LIMIT),
    enabled: enabled && debounced !== '',
    staleTime: 30_000,
  })

  return {
    results: active
      ? pickTaskResults(result.data ?? [], excludeIdentifier)
      : [],
    // Spinner from the first keystroke (debounce pending) through the fetch.
    loading: active && (trimmed !== debounced || result.isFetching),
  }
}
