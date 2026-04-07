'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
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
  projectId: string
  /** Whether the user has manually changed the priority */
  userHasOverridden: boolean
}

const TITLE_DEBOUNCE_MS = 500
const DESCRIPTION_DEBOUNCE_MS = 800
const MIN_TITLE_LENGTH = 4
const TIMEOUT_MS = 5000

export function usePrioritySuggestion({
  projectId,
  userHasOverridden,
}: UsePrioritySuggestionOptions) {
  const [suggestion, setSuggestion] = useState<PrioritySuggestion | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const titleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const descTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Clean up on unmount
  useEffect(() => {
    return () => {
      abortRef.current?.abort()
      if (titleTimerRef.current) clearTimeout(titleTimerRef.current)
      if (descTimerRef.current) clearTimeout(descTimerRef.current)
    }
  }, [])

  const fetchSuggestion = useCallback(
    async (title: string, description?: string) => {
      if (!projectId || title.trim().length < MIN_TITLE_LENGTH) return

      // Abort previous request
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller

      setIsLoading(true)

      const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS)

      try {
        const res = await fetch('/api/tasks/suggest-priority', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: title.trim(),
            projectId,
            ...(description ? { description } : {}),
          }),
          signal: controller.signal,
        })

        clearTimeout(timeoutId)

        if (res.ok) {
          const data: PrioritySuggestion = await res.json()
          setSuggestion(data)
        }
      } catch {
        // Silent failure — AbortError or network error
      } finally {
        if (!controller.signal.aborted) {
          setIsLoading(false)
        }
      }
    },
    [projectId]
  )

  /** Call after title input blur or debounce */
  const onTitleChange = useCallback(
    (title: string) => {
      if (titleTimerRef.current) clearTimeout(titleTimerRef.current)

      if (title.trim().length < MIN_TITLE_LENGTH) {
        setSuggestion(null)
        return
      }

      titleTimerRef.current = setTimeout(() => {
        fetchSuggestion(title)
      }, TITLE_DEBOUNCE_MS)
    },
    [fetchSuggestion]
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
    setSuggestion(null)
    setIsLoading(false)
  }, [])

  return {
    suggestion,
    isLoading,
    onTitleChange,
    onDescriptionChange,
    reset,
  }
}
