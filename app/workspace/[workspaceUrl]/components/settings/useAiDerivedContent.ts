'use client'

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { workspacesClient } from '@/lib/api-client'
import { queryKeys } from '@/lib/query/keys'

export interface AiDerivedCounts {
  memories: number
  sessionSummaries: number
  runSummaries: number
  claimSnapshots: number
  verdictTexts: number
}

/** Upper bound on passes per delete, so a runaway never loops forever. */
const MAX_PURGE_PASSES = 50

const EMPTY: AiDerivedCounts = {
  memories: 0,
  sessionSummaries: 0,
  runSummaries: 0,
  claimSnapshots: 0,
  verdictTexts: 0,
}

/**
 * LUM-917 — what AI-derived content the workspace stores, and the batched
 * delete: `purge` keeps calling the API while it reports `done: false`, then
 * re-reads the counts. Resolves to the totals removed; throws on failure
 * (whatever earlier passes removed stays removed).
 */
export function useAiDerivedContent() {
  const queryClient = useQueryClient()
  const query = useQuery({
    queryKey: queryKeys.workspaceAiDerivedContent(),
    queryFn: async () => (await workspacesClient.getAiDerivedContent()).counts,
    retry: false,
  })
  // Unknown counts (a failed read) render as null, never as stale numbers.
  const counts = query.isError ? null : (query.data ?? null)

  const refresh = async () => {
    await queryClient.invalidateQueries({
      queryKey: queryKeys.workspaceAiDerivedContent(),
    })
  }

  const purge = async (confirmName: string): Promise<AiDerivedCounts> => {
    const total = { ...EMPTY }
    try {
      for (let i = 0; i < MAX_PURGE_PASSES; i++) {
        const pass = await workspacesClient.purgeAiDerivedContent(confirmName)
        for (const key of Object.keys(total) as (keyof AiDerivedCounts)[]) {
          total[key] += pass.deleted[key]
        }
        if (pass.done) break
      }
    } finally {
      await refresh()
    }
    return total
  }

  return { counts, purge }
}
