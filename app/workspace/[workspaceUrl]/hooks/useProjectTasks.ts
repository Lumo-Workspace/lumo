'use client'

import {
  useCallback,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react'
import {
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query'
import { ApiTask, TaskDetail } from '../types'
import { flattenTasks } from '../utils'
import { projectsClient } from '@/lib/api-client'
import { queryKeys } from '@/lib/query/keys'

interface ProjectTasksData {
  tasks: ApiTask[]
  kanbanViewId: string | null
}

// Mirror each fetched task into the per-task detail cache so detail pages
// can read by id without a re-fetch.
function seedTaskDetailCache(queryClient: QueryClient, tasks: ApiTask[]) {
  for (const t of tasks) {
    queryClient.setQueryData<TaskDetail>(
      queryKeys.tasks.detail(t.id),
      prev => ({ ...(prev ?? {}), ...t }) as TaskDetail
    )
  }
}

/**
 * Per-project task list. The hook tracks the "current" projectId in local
 * state so the same hook instance can switch projects without remount —
 * `hydrateForProject(id)` snaps to that project's cache, `fetchProjectTasks(id)`
 * forces a refetch.
 */
export function useProjectTasks() {
  const queryClient = useQueryClient()

  const [currentProjectId, setCurrentProjectId] = useState<string | null>(null)

  const query = useQuery<ProjectTasksData>({
    queryKey: currentProjectId
      ? queryKeys.tasks.byProject(currentProjectId)
      : ['tasks', 'byProject', 'disabled'],
    queryFn: async () => {
      const data = await projectsClient.listTasks<{
        tasks: (ApiTask & { children?: ApiTask[] })[]
        kanbanViewId: string
      }>(currentProjectId as string)
      const flat = flattenTasks(data.tasks)
      seedTaskDetailCache(queryClient, flat)
      return {
        tasks: flat,
        kanbanViewId: data.kanbanViewId,
      }
    },
    // `enabled: false` keeps fetch behavior caller-driven (mirrors the
    // legacy fetchProjectTasks(projectId) imperative API).
    enabled: false,
  })

  const queryRef = useRef(query)
  queryRef.current = query

  const hydrateForProject = useCallback(
    (projectId: string) => {
      setCurrentProjectId(projectId)
    },
    [setCurrentProjectId]
  )

  const fetchProjectTasks = useCallback(
    async (projectId: string) => {
      setCurrentProjectId(projectId)
      // After setState, the queryKey above flips on next render. Trigger a
      // fetch directly via queryClient so we don't have to wait a render.
      await queryClient.fetchQuery<ProjectTasksData>({
        queryKey: queryKeys.tasks.byProject(projectId),
        queryFn: async () => {
          const data = await projectsClient.listTasks<{
            tasks: (ApiTask & { children?: ApiTask[] })[]
            kanbanViewId: string
          }>(projectId)
          const flat = flattenTasks(data.tasks)
          seedTaskDetailCache(queryClient, flat)
          return {
            tasks: flat,
            kanbanViewId: data.kanbanViewId,
          }
        },
      })
    },
    [queryClient]
  )

  const setTasks = useCallback<Dispatch<SetStateAction<ApiTask[]>>>(
    action => {
      if (!currentProjectId) return
      queryClient.setQueryData<ProjectTasksData>(
        queryKeys.tasks.byProject(currentProjectId),
        prev => {
          const prevTasks = prev?.tasks ?? []
          const nextTasks =
            typeof action === 'function'
              ? (action as (prev: ApiTask[]) => ApiTask[])(prevTasks)
              : action
          // Mirror into per-task detail cache.
          for (const t of nextTasks) {
            queryClient.setQueryData<TaskDetail>(
              queryKeys.tasks.detail(t.id),
              existing => ({ ...(existing ?? {}), ...t }) as TaskDetail
            )
          }
          return {
            tasks: nextTasks,
            kanbanViewId: prev?.kanbanViewId ?? null,
          }
        }
      )
    },
    [queryClient, currentProjectId]
  )

  return {
    tasks: query.data?.tasks ?? [],
    setTasks,
    kanbanViewId: query.data?.kanbanViewId ?? null,
    loading: query.isFetching && !query.data,
    error: query.error
      ? ((query.error as Error).message ?? 'Could not load tasks.')
      : null,
    hydrateForProject,
    fetchProjectTasks,
  }
}
