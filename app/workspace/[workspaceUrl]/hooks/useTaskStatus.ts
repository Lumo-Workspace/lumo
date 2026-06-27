'use client'

import { useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { tasksClient } from '@/lib/api-client'
import { queryKeys } from '@/lib/query/keys'
import type { TaskAcceptanceStatusView } from '../types'

interface UseTaskStatusOptions {
  /** Task identifier (LUM-42); the status route resolves it or a cuid. */
  identifier: string
  /** When false the hook neither fetches nor reads cache (tab inactive). */
  enabled?: boolean
}

/**
 * Read-through cache for a task's acceptance-status read model (LUM-344),
 * consumed by the read-only Acceptance tab (LUM-423). Mirrors useTaskLineage:
 * once cached for `identifier`, tab switches paint instantly while a quiet
 * background refetch keeps it fresh.
 *
 * LUM-613: also owns the one mutating shortcut the tab needs —
 * `optimisticallyPass`, which flips the targeted criteria to a HUMAN PASS in
 * this same cache the instant the reviewer clicks, so the row turns met without
 * waiting on the POST round-trip plus a full refetch. It returns a rollback
 * closure for the caller to invoke if the request fails; the server stays the
 * source of truth via the caller's settle-time `refresh`. Keeping the cache
 * write here (not in the component) means every test that already mocks this
 * hook stays provider-free — only this hook's own test needs a QueryClient.
 */
export function useTaskStatus({
  identifier,
  enabled = true,
}: UseTaskStatusOptions) {
  const queryClient = useQueryClient()
  const query = useQuery<TaskAcceptanceStatusView>({
    queryKey: queryKeys.taskStatus(identifier),
    queryFn: () => tasksClient.getStatus<TaskAcceptanceStatusView>(identifier),
    enabled: !!identifier && enabled,
  })

  const optimisticallyPass = useCallback(
    (criterionIds?: string[]): (() => void) => {
      const key = queryKeys.taskStatus(identifier)
      const previous = queryClient.getQueryData<TaskAcceptanceStatusView>(key)
      if (!previous) return () => {}
      const targeted = criterionIds ? new Set(criterionIds) : null
      const recordedAt = new Date().toISOString()
      queryClient.setQueryData<TaskAcceptanceStatusView>(key, {
        ...previous,
        criteria: previous.criteria.map(c =>
          targeted && !targeted.has(c.id)
            ? c
            : {
                ...c,
                // A fresh human PASS vouches for the current statement, so the
                // stale flag clears with it (it recomputes on refetch).
                verdictStale: false,
                latestVerdict: {
                  round: c.latestVerdict?.round ?? 0,
                  verdict: 'PASS',
                  verifierType: 'HUMAN',
                  evidencePointer: c.latestVerdict?.evidencePointer ?? null,
                  rejectionReason: null,
                  rejectionReasonEnum: null,
                  recordedAt,
                },
              }
        ),
      })
      return () => queryClient.setQueryData(key, previous)
    },
    [queryClient, identifier]
  )

  return {
    data: query.data ?? null,
    loading: query.isPending && !!identifier && enabled,
    error: query.error
      ? ((query.error as Error).message ?? 'Failed to load status')
      : null,
    refresh: query.refetch,
    optimisticallyPass,
  }
}
