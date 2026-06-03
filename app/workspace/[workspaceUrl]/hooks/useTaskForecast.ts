'use client'

import { useQuery } from '@tanstack/react-query'
import { tasksClient } from '@/lib/api-client'
import { queryKeys } from '@/lib/query/keys'
import type { TaskForecast } from '@/lib/forecast/types'

/** Lazily fetch a task's delivery forecast. Disabled until taskId is known. */
export function useTaskForecast(taskId: string | null) {
  const enabled = !!taskId
  const query = useQuery<{ forecast: TaskForecast }>({
    queryKey: queryKeys.tasks.forecast(taskId ?? ''),
    queryFn: () =>
      tasksClient.forecast<{ forecast: TaskForecast }>(taskId as string),
    enabled,
    staleTime: 5 * 60 * 1000,
  })
  return {
    forecast: query.data?.forecast,
    isLoading: query.isPending && enabled,
    error: query.error ?? undefined,
  }
}
