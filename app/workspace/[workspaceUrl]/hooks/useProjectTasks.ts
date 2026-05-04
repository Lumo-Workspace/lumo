'use client'

import { useCallback, useRef, useState } from 'react'
import { useQuery, useQueryClient, type Updater } from '@tanstack/react-query'
import { ApiTask } from '../types'
import { flattenTasks } from '../utils'
import { projectsClient } from '@/lib/api-client'
import { queryKeys } from '@/lib/query/keys'

interface ProjectTasksData {
  taskIds: string[]
  kanbanViewId: string | null
}

/**
 * Per-project task list. The hook tracks the "current" projectId in local
 * state so the same hook instance can switch projects without remount —
 * `hydrateForProject(id)` snaps to that project's cache, `fetchProjectTasks(id)`
 * forces a refetch.
 */
export function useProjectTasks(upsertTasks: (tasks: ApiTask[]) => void) {
  const queryClient = useQueryClient()
  const upsertRef = useRef(upsertTasks)
  upsertRef.current = upsertTasks

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
      upsertRef.current(flat)
      return {
        taskIds: flat.map(t => t.id),
        kanbanViewId: data.kanbanViewId,
      }
    },
    // `enabled: false` keeps fetch behavior caller-driven (mirrors the
    // legacy fetchProjectTasks(projectId) imperative API).
    enabled: false,
  })

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
          upsertRef.current(flat)
          return {
            taskIds: flat.map(t => t.id),
            kanbanViewId: data.kanbanViewId,
          }
        },
      })
    },
    [queryClient]
  )

  const setTaskIds = useCallback(
    (updater: Updater<string[], string[]>) => {
      if (!currentProjectId) return
      queryClient.setQueryData<ProjectTasksData>(
        queryKeys.tasks.byProject(currentProjectId),
        prev => {
          const prevIds = prev?.taskIds ?? []
          const nextIds =
            typeof updater === 'function'
              ? (updater as (prev: string[]) => string[])(prevIds)
              : updater
          return {
            taskIds: nextIds,
            kanbanViewId: prev?.kanbanViewId ?? null,
          }
        }
      )
    },
    [queryClient, currentProjectId]
  )

  return {
    taskIds: query.data?.taskIds ?? [],
    setTaskIds,
    kanbanViewId: query.data?.kanbanViewId ?? null,
    loading: query.isFetching && !query.data,
    error: query.error
      ? ((query.error as Error).message ?? 'Could not load tasks.')
      : null,
    hydrateForProject,
    fetchProjectTasks,
  }
}
