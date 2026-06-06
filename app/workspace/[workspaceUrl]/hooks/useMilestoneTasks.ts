'use client'

import {
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query'
import { tasksClient } from '@/lib/api-client'
import { queryKeys } from '@/lib/query/keys'
import type { MyTask, TaskDetail } from '../types'

interface MilestoneTasksResult {
  tasks: MyTask[]
}

// Mirror each fetched task into the per-task detail cache so detail pages can
// read by id without a re-fetch (same trick the sprint/backlog hooks use).
function seedTaskDetailCache(queryClient: QueryClient, tasks: MyTask[]) {
  for (const t of tasks) {
    queryClient.setQueryData<TaskDetail>(
      queryKeys.tasks.detail(t.id),
      prev => ({ ...(prev ?? {}), ...t }) as TaskDetail
    )
  }
}

/**
 * Fetches all tasks attached to a milestone (single project). The milestone
 * tasks route returns MyTask-shaped rows, so the shared task workspace (board
 * + list) renders them exactly like the sprint board.
 * Returns { tasks, isLoading, error, refetch }.
 */
export function useMilestoneTasks(milestoneId: string | null) {
  const queryClient = useQueryClient()
  const query = useQuery<MyTask[]>({
    queryKey: milestoneId
      ? queryKeys.tasks.byMilestone(milestoneId)
      : ['tasks', 'byMilestone', 'disabled'],
    queryFn: async () => {
      const res = await tasksClient.listByMilestone<MilestoneTasksResult>(
        milestoneId as string
      )
      seedTaskDetailCache(queryClient, res.tasks)
      return res.tasks
    },
    enabled: !!milestoneId,
  })

  return {
    tasks: query.data,
    isLoading: query.isPending && !!milestoneId,
    error: query.error ?? undefined,
    refetch: query.refetch,
  }
}
