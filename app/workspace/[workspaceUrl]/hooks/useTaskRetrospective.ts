'use client'

import { useQuery } from '@tanstack/react-query'
import { tasksClient } from '@/lib/api-client'
import { queryKeys } from '@/lib/query/keys'
import type { TaskRetrospective } from '@/lib/forecast/retrospective-types'

/** 拉取已交付任务的回顾。taskId 为 null（未交付）时禁用。 */
export function useTaskRetrospective(taskId: string | null) {
  const enabled = !!taskId
  const query = useQuery<{ retrospective: TaskRetrospective | null }>({
    queryKey: queryKeys.tasks.retrospective(taskId ?? ''),
    queryFn: () =>
      tasksClient.retrospective<{ retrospective: TaskRetrospective | null }>(
        taskId as string
      ),
    enabled,
    staleTime: 5 * 60 * 1000,
  })
  return {
    retrospective: query.data?.retrospective ?? undefined,
    isLoading: query.isPending && enabled,
    error: query.error ?? undefined,
  }
}
