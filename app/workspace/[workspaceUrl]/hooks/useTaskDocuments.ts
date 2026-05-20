'use client'

import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api-client/base'

export interface TaskDocumentResource {
  id: string
  title: string
  emoji: string | null
  updatedAt: string
}

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
      const { documents } = await apiFetch<{
        documents: TaskDocumentResource[]
      }>(`/api/tasks/${taskId}/documents`)
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
