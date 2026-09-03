'use client'

import { useQuery } from '@tanstack/react-query'
import { tasksClient } from '@/lib/api-client'
import { queryKeys } from '@/lib/query/keys'
import type { TaskSecurityScans } from '@/lib/services/pr-security-scan.service'

/** LUM-732: latest security scan per linked PR. taskId null → disabled. */
export function useSecurityScans(taskId: string | null) {
  const enabled = !!taskId
  const query = useQuery<TaskSecurityScans>({
    queryKey: queryKeys.tasks.securityScans(taskId ?? ''),
    queryFn: () =>
      tasksClient.securityScans<TaskSecurityScans>(taskId as string),
    enabled,
    staleTime: 30 * 1000,
  })
  return {
    data: query.data,
    isLoading: query.isPending && enabled,
  }
}
