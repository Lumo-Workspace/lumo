'use client'

import { useCallback, useRef, type Dispatch, type SetStateAction } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { MyTask, TaskDetail } from '../types'
import { tasksClient } from '@/lib/api-client'
import { queryKeys } from '@/lib/query/keys'

interface MyTasksData {
  tasks: MyTask[]
  myTasksViewId: string | null
}

/**
 * Fetches the current user's full task list and caches it in TanStack Query.
 * Each fetched task is also mirrored into `tasks.detail(id)` so detail-page
 * reads and per-task optimistic updates share a single source of truth.
 */
export function useMyTasks() {
  const queryClient = useQueryClient()

  // `enabled: false` preserves the legacy "manual fetch only" semantics —
  // consumers gate fetches via fetchMyTasks() on page change. TanStack still
  // serves cached data instantly on remount.
  const query = useQuery<MyTasksData>({
    queryKey: queryKeys.tasks.my(),
    queryFn: async () => {
      const data = await tasksClient.listMine<{
        tasks: MyTask[]
        myTasksViewId: string
      }>()
      // Mirror each task into the per-task detail cache.
      for (const t of data.tasks) {
        queryClient.setQueryData<TaskDetail>(
          queryKeys.tasks.detail(t.id),
          prev => ({ ...(prev ?? {}), ...t }) as TaskDetail
        )
      }
      return {
        tasks: data.tasks,
        myTasksViewId: data.myTasksViewId,
      }
    },
    enabled: false,
  })

  // Pin the query so `fetchMyTasks` is referentially stable.
  const queryRef = useRef(query)
  queryRef.current = query

  const fetchMyTasks = useCallback(async () => {
    await queryRef.current.refetch()
  }, [])

  const setTasks = useCallback<Dispatch<SetStateAction<MyTask[]>>>(
    action => {
      queryClient.setQueryData<MyTasksData>(queryKeys.tasks.my(), prev => {
        const prevTasks = prev?.tasks ?? []
        const nextTasks =
          typeof action === 'function'
            ? (action as (prev: MyTask[]) => MyTask[])(prevTasks)
            : action
        // Mirror updated task data into the per-task detail cache so any open
        // detail surface reflects the change.
        for (const t of nextTasks) {
          queryClient.setQueryData<TaskDetail>(
            queryKeys.tasks.detail(t.id),
            existing => ({ ...(existing ?? {}), ...t }) as TaskDetail
          )
        }
        return {
          tasks: nextTasks,
          myTasksViewId: prev?.myTasksViewId ?? null,
        }
      })
    },
    [queryClient]
  )

  return {
    tasks: query.data?.tasks ?? [],
    setTasks,
    myTasksViewId: query.data?.myTasksViewId ?? null,
    loading: query.isFetching && !query.data,
    error: query.error
      ? ((query.error as Error).message ?? 'Could not load your tasks.')
      : null,
    fetchMyTasks,
  }
}
