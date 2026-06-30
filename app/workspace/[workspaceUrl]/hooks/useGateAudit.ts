'use client'

import { useQuery } from '@tanstack/react-query'
import { tasksClient } from '@/lib/api-client'
import { queryKeys } from '@/lib/query/keys'
import type { PerPrGateAudit } from '@/lib/services/gate-audit'

/** Fetch the delivery's mechanical-gate audit, grouped by PR. taskId null → disabled. */
export function useGateAudit(taskId: string | null) {
  const enabled = !!taskId
  const query = useQuery<{ perPr: PerPrGateAudit | null }>({
    queryKey: queryKeys.tasks.gates(taskId ?? ''),
    queryFn: () =>
      tasksClient.gates<{ perPr: PerPrGateAudit | null }>(taskId as string),
    enabled,
    staleTime: 5 * 60 * 1000,
  })
  return {
    perPr: query.data?.perPr ?? undefined,
    isLoading: query.isPending && enabled,
    error: query.error ?? undefined,
  }
}
