'use client'

import { useQuery } from '@tanstack/react-query'
import { tasksClient } from '@/lib/api-client'
import { queryKeys } from '@/lib/query/keys'
import type { TaskProgress } from '@/lib/forecast/progress-types'

/** 拉取交付中态数据。taskId 为 null（交付后 / 未知）时禁用。 */
export function useTaskProgress(taskId: string | null) {
  const enabled = !!taskId
  const query = useQuery<{ progress: TaskProgress | null }>({
    queryKey: queryKeys.tasks.progress(taskId ?? ''),
    queryFn: () =>
      tasksClient.progress<{ progress: TaskProgress | null }>(taskId as string),
    enabled,
    staleTime: 5 * 60 * 1000,
  })
  return {
    progress: query.data?.progress ?? undefined,
    isLoading: query.isPending && enabled,
    error: query.error ?? undefined,
  }
}
