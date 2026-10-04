'use client'

import { useInfiniteQuery } from '@tanstack/react-query'
import {
  auditClient,
  type AuditEventFilterParams,
} from '@/lib/api-client/audit'
import { ApiClientError } from '@/lib/api-client/base'
import { queryKeys } from '@/lib/query/keys'
import type { AuditEventPage, AuditEventView } from '@/lib/audit/query'

/**
 * LUM-907 — the workspace audit log for the settings page: newest first,
 * one keyset page at a time ("Load more"). `forbidden` = the caller is not
 * an OWNER (the API answered 403), so the page shows that instead of an
 * error.
 */
export function useAuditEvents(filters: AuditEventFilterParams) {
  const query = useInfiniteQuery<AuditEventPage>({
    queryKey: queryKeys.auditEvents(filters),
    queryFn: ({ pageParam }) =>
      auditClient.list({
        ...filters,
        cursor: typeof pageParam === 'string' ? pageParam : '',
      }),
    initialPageParam: '',
    getNextPageParam: last => last.nextCursor ?? undefined,
    retry: (count, error) =>
      !(error instanceof ApiClientError && error.status < 500) && count < 2,
  })

  const events: AuditEventView[] =
    query.data?.pages.flatMap(p => p.events) ?? []

  return {
    events,
    isLoading: query.isLoading,
    isError: query.isError,
    forbidden:
      query.error instanceof ApiClientError && query.error.status === 403,
    hasMore: query.hasNextPage,
    isLoadingMore: query.isFetchingNextPage,
    loadMore: () => void query.fetchNextPage(),
  }
}
