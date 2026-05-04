'use client'

import { useCallback, useRef } from 'react'
import { useQuery, useQueryClient, type Updater } from '@tanstack/react-query'
import { ApiTask, MyTask } from '../types'
import { tasksClient } from '@/lib/api-client'
import { queryKeys } from '@/lib/query/keys'

interface MyTasksData {
  taskIds: string[]
  myTasksViewId: string | null
}

/**
 * Fetches the current user's full task list. Returns only
 * `{ taskIds, myTasksViewId }`; full task records are forwarded into the
 * shared task store via `upsertTasks(...)`.
 */
export function useMyTasks(upsertTasks: (tasks: ApiTask[]) => void) {
  const queryClient = useQueryClient()
  const upsertRef = useRef(upsertTasks)
  upsertRef.current = upsertTasks

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
      upsertRef.current(data.tasks)
      return {
        taskIds: data.tasks.map(t => t.id),
        myTasksViewId: data.myTasksViewId,
      }
    },
    enabled: false,
  })

  // The TanStack `query` result object is a fresh reference every render;
  // pin it so `fetchMyTasks` stays referentially stable for consumers that
  // put it in useEffect dep arrays.
  const queryRef = useRef(query)
  queryRef.current = query

  const fetchMyTasks = useCallback(async () => {
    await queryRef.current.refetch()
  }, [])

  const setTaskIds = useCallback(
    (updater: Updater<string[], string[]>) => {
      queryClient.setQueryData<MyTasksData>(queryKeys.tasks.my(), prev => {
        const prevIds = prev?.taskIds ?? []
        const nextIds =
          typeof updater === 'function'
            ? (updater as (prev: string[]) => string[])(prevIds)
            : updater
        return {
          taskIds: nextIds,
          myTasksViewId: prev?.myTasksViewId ?? null,
        }
      })
    },
    [queryClient]
  )

  return {
    taskIds: query.data?.taskIds ?? [],
    setTaskIds,
    myTasksViewId: query.data?.myTasksViewId ?? null,
    loading: query.isFetching && !query.data,
    error: query.error
      ? ((query.error as Error).message ?? 'Could not load your tasks.')
      : null,
    fetchMyTasks,
  }
}
