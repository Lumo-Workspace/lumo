'use client'

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { sessionsClient } from '@/lib/api-client'
import { queryKeys } from '@/lib/query/keys'

/** Upper bound on passes per delete, so a runaway never loops forever. */
const MAX_DELETE_PASSES = 50

export interface SessionRawRecordDeleteTotals {
  deleted: number
  keptForCrossings: number
}

/**
 * LUM-944 — whether the viewer may delete a session's raw record, what it
 * would clear, and the batched delete: `remove` keeps calling the API with
 * the returned cursor while it reports `done: false`, then re-reads the
 * status. Resolves to the totals; throws on failure (whatever earlier passes
 * cleared stays cleared).
 */
export function useSessionRawRecord(sessionId: string) {
  const queryClient = useQueryClient()
  const queryKey = queryKeys.sessionRawRecord(sessionId)
  const query = useQuery({
    queryKey,
    queryFn: () => sessionsClient.getRawRecordStatus(sessionId),
    retry: false,
  })
  // A failed read hides the control rather than showing stale numbers.
  const status = query.isError ? null : (query.data ?? null)

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey })
  }

  const remove = async (): Promise<SessionRawRecordDeleteTotals> => {
    const totals = { deleted: 0, keptForCrossings: 0 }
    try {
      let cursor: string | null = null
      for (let i = 0; i < MAX_DELETE_PASSES; i++) {
        const pass = await sessionsClient.deleteRawRecordBatch(
          sessionId,
          cursor
        )
        totals.deleted += pass.deleted
        totals.keptForCrossings += pass.keptForCrossings
        if (pass.done) break
        cursor = pass.cursor
      }
    } finally {
      await refresh()
    }
    return totals
  }

  return { status, remove }
}
