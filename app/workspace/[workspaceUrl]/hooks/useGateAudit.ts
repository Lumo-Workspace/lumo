'use client'

import { useQuery } from '@tanstack/react-query'
import { tasksClient } from '@/lib/api-client'
import { queryKeys } from '@/lib/query/keys'
import type { DeliveryGateAudit } from '@/lib/services/gate-audit'

/** Fetch the delivery's mechanical-gate audit. taskId null → disabled. */
export function useGateAudit(taskId: string | null) {
  const enabled = !!taskId
  const query = useQuery<{ audit: DeliveryGateAudit | null }>({
    queryKey: queryKeys.tasks.gates(taskId ?? ''),
    queryFn: () =>
      tasksClient.gates<{ audit: DeliveryGateAudit | null }>(taskId as string),
    enabled,
    staleTime: 5 * 60 * 1000,
  })
  return {
    audit: query.data?.audit ?? undefined,
    isLoading: query.isPending && enabled,
    error: query.error ?? undefined,
  }
}
