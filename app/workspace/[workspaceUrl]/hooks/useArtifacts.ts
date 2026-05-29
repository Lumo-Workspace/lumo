'use client'

import { useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { artifactsClient } from '@/lib/api-client/task-artifacts'
import { queryKeys } from '@/lib/query/keys'
import type { TaskArtifact } from '@prisma/client'

interface UseArtifactsResult {
  artifacts: TaskArtifact[]
  loading: boolean
  refresh: () => Promise<void>
}

export function useArtifacts(
  taskId: string,
  enabled = true
): UseArtifactsResult {
  const queryClient = useQueryClient()
  const queryKey = queryKeys.taskArtifacts(taskId)

  const query = useQuery<TaskArtifact[], Error>({
    queryKey,
    queryFn: async () => {
      const { artifacts } = await artifactsClient.list(taskId)
      return artifacts
    },
    enabled,
  })

  const refresh = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey })
  }, [queryClient, queryKey])

  return {
    artifacts: query.data ?? [],
    loading: query.isLoading,
    refresh,
  }
}
