'use client'

import { useState, useCallback, useMemo } from 'react'
import { readCache, writeCache } from '../cache'
import { CACHE_KEY } from '../constants'

// ── Types ───────────────────────────────────────────────────────────────────

interface UseTaskDescriptionOptions {
  taskId: string
  /** Pre-resolved description from SSR or parent cache. */
  initialDescription?: string | null | undefined
  /** Cached description passed from parent (TaskDetailPanel pattern). */
  cachedDescription?: string | null | undefined
  /** Callback when description is loaded from API (for parent cache sync). */
  onDescriptionLoaded?:
    | ((taskId: string, description: string | null) => void)
    | undefined
}

// ── Hook ────────────────────────────────────────────────────────────────────

export function useTaskDescription({
  taskId,
  initialDescription,
  cachedDescription,
  onDescriptionLoaded,
}: UseTaskDescriptionOptions) {
  // Resolve initial value: prop > parent cache > localStorage > undefined
  const resolvedDescription = useMemo(() => {
    if (initialDescription !== undefined) return initialDescription
    if (cachedDescription !== undefined) return cachedDescription
    return (
      readCache<{ desc: string | null }>(CACHE_KEY.description(taskId))?.desc ??
      undefined
    )
  }, [initialDescription, cachedDescription, taskId])

  const hasCached = resolvedDescription !== undefined
  const [descriptionValue, setDescriptionValue] = useState<string | null>(
    hasCached ? (resolvedDescription ?? null) : null
  )
  const [descriptionLoading, setDescriptionLoading] = useState(!hasCached)

  /** Called when full task detail is fetched from API — updates description state + cache. */
  const setDescriptionFromFetch = useCallback(
    (description: string | null) => {
      setDescriptionValue(description)
      setDescriptionLoading(false)
      writeCache(CACHE_KEY.description(taskId), { desc: description })
      onDescriptionLoaded?.(taskId, description)
    },
    [taskId, onDescriptionLoaded]
  )

  /** Mark description loading as complete (call in .finally() of fetch). */
  const finishLoading = useCallback(() => {
    setDescriptionLoading(false)
  }, [])

  return {
    descriptionValue,
    descriptionLoading,
    setDescriptionValue,
    setDescriptionFromFetch,
    finishLoading,
  }
}
