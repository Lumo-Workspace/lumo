'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  taskDocumentsClient,
  type TaskDocumentResource,
} from '@/lib/api-client/task-documents'

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
  const [documents, setDocuments] = useState<TaskDocumentResource[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const { documents } = await taskDocumentsClient.list(taskId)
      setDocuments(documents)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'unknown_error')
    } finally {
      setLoading(false)
    }
  }, [taskId])

  useEffect(() => {
    if (!enabled) return
    void refresh()
  }, [enabled, refresh])

  return { documents, loading, error, refresh }
}
