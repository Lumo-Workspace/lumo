'use client'

import { useCallback, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  taskDocumentsClient,
  type TaskDocumentResource,
} from '@/lib/api-client/task-documents'
import { queryKeys } from '@/lib/query/keys'

interface UseTaskDocumentsResult {
  documents: TaskDocumentResource[]
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
}

export function useTaskDocuments(
  taskId: string,
  enabled = true
): UseTaskDocumentsResult {
  const queryClient = useQueryClient()
  const queryKey = useMemo(() => queryKeys.taskDocuments(taskId), [taskId])

  const query = useQuery<TaskDocumentResource[], Error>({
    queryKey,
    queryFn: async () => {
      const { documents } = await taskDocumentsClient.list(taskId)
      return documents
    },
    enabled,
  })

  const refresh = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey })
  }, [queryClient, queryKey])

  return {
    documents: query.data ?? [],
    loading: query.isLoading,
    error: query.error?.message ?? null,
    refresh,
  }
}
