'use client'

import { useCallback, useEffect, useRef } from 'react'
import { useMutation } from '@tanstack/react-query'
import { tasksClient } from '@/lib/api-client'
import type { ApiPriority } from '../types'

interface SimilarTask {
  id: string
  number: number
  title: string
  priority: ApiPriority
}

export interface PrioritySuggestion {
  priority: ApiPriority
  reason: string
  stats: {
    total: number
    distribution: Record<string, number>
  }
  similarTasks: SimilarTask[]
}

interface UsePrioritySuggestionOptions {
  projectId?: string
  /** LUM-1338: false when the workspace switched priority suggestions off. */
  enabled?: boolean
}

interface FetchParams {
  title: string
  description?: string
}

const TITLE_DEBOUNCE_MS = 500
const DESCRIPTION_DEBOUNCE_MS = 800
const MIN_TITLE_LENGTH = 4
const TIMEOUT_MS = 5000

export function usePrioritySuggestion({
  projectId,
  enabled = true,
}: UsePrioritySuggestionOptions) {
  const abortRef = useRef<AbortController | null>(null)
  const titleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const descTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const suggestionMutation = useMutation<
    PrioritySuggestion,
    Error,
    FetchParams
  >({
    mutationFn: async ({ title, description }) => {
      // Cancel any in-flight request so the latest debounced call wins.
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller
      const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS)

      try {
        return await tasksClient.suggestPriority<PrioritySuggestion>(
          {
            title: title.trim(),
            ...(projectId ? { projectId } : {}),
            ...(description ? { description } : {}),
          },
          controller.signal
        )
      } finally {
        clearTimeout(timeoutId)
      }
    },
  })

  // Clean up timers + in-flight request on unmount.
  useEffect(() => {
    return () => {
      abortRef.current?.abort()
      if (titleTimerRef.current) clearTimeout(titleTimerRef.current)
      if (descTimerRef.current) clearTimeout(descTimerRef.current)
    }
  }, [])

  const fetchSuggestion = useCallback(
    (title: string, description?: string) => {
      if (!enabled || title.trim().length < MIN_TITLE_LENGTH) return
      // mutate() handles cleanup + state internally; we just kick it off.
      suggestionMutation.mutate(
        description !== undefined ? { title, description } : { title }
      )
    },
    [enabled, suggestionMutation]
  )

  /** Call after title input blur or debounce */
  const onTitleChange = useCallback(
    (title: string) => {
      if (titleTimerRef.current) clearTimeout(titleTimerRef.current)

      if (title.trim().length < MIN_TITLE_LENGTH) {
        suggestionMutation.reset()
        return
      }

      titleTimerRef.current = setTimeout(() => {
        fetchSuggestion(title)
      }, TITLE_DEBOUNCE_MS)
    },
    [fetchSuggestion, suggestionMutation]
  )

  /** Call after description input blur or debounce */
  const onDescriptionChange = useCallback(
    (title: string, description: string) => {
      if (descTimerRef.current) clearTimeout(descTimerRef.current)

      if (title.trim().length < MIN_TITLE_LENGTH) return

      descTimerRef.current = setTimeout(() => {
        fetchSuggestion(title, description)
      }, DESCRIPTION_DEBOUNCE_MS)
    },
    [fetchSuggestion]
  )

  /** Reset all state (call when modal closes) */
  const reset = useCallback(() => {
    abortRef.current?.abort()
    if (titleTimerRef.current) clearTimeout(titleTimerRef.current)
    if (descTimerRef.current) clearTimeout(descTimerRef.current)
    suggestionMutation.reset()
  }, [suggestionMutation])

  // Treat AbortError as silent — match prior behavior where the catch
  // swallowed aborts. Surface the result only when the mutation has data.
  const suggestion = suggestionMutation.data ?? null
  const isLoading = suggestionMutation.isPending

  return {
    suggestion,
    isLoading,
    onTitleChange,
    onDescriptionChange,
    reset,
  }
}
