'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { tasksClient } from '@/lib/api-client'
import { queryKeys } from '@/lib/query/keys'
import type { DependencyEdge } from '../dependencies/types'

interface UseDependenciesOptions {
  /** Task cuid or LUM-N — the route's resolveTask accepts both. */
  taskId: string
  enabled?: boolean
}

export function useDependencies({
  taskId,
  enabled = true,
}: UseDependenciesOptions) {
  const queryClient = useQueryClient()
  const key = queryKeys.taskDependencies(taskId)

  const query = useQuery<{ dependencies: DependencyEdge[] }>({
    queryKey: key,
    queryFn: () =>
      tasksClient.listDependencies<{ dependencies: DependencyEdge[] }>(taskId),
    enabled: !!taskId && enabled,
  })

  const invalidate = () => queryClient.invalidateQueries({ queryKey: key })

  const add = useMutation({
    mutationFn: (data: {
      blockedBy: string
      kind?: 'BLOCKS' | 'RELATES'
      direction?: 'BLOCKED_BY' | 'BLOCKS'
    }) => tasksClient.addDependency(taskId, data),
    onSuccess: invalidate,
  })

  const patch = useMutation({
    mutationFn: ({
      depId,
      action,
      reverse,
    }: {
      depId: string
      action: 'confirm' | 'dismiss'
      reverse?: boolean
    }) => {
      const body: { action: 'confirm' | 'dismiss'; reverse?: boolean } = {
        action,
      }
      if (reverse !== undefined) body.reverse = reverse
      return tasksClient.patchDependency(taskId, depId, body)
    },
    onSuccess: invalidate,
  })

  const remove = useMutation({
    mutationFn: (depId: string) => tasksClient.removeDependency(taskId, depId),
    onSuccess: invalidate,
  })

  return {
    edges: query.data?.dependencies ?? [],
    loading: query.isPending && !!taskId && enabled,
    error: query.error
      ? ((query.error as Error).message ?? 'Failed to load dependencies')
      : null,
    add,
    patch,
    remove,
  }
}
