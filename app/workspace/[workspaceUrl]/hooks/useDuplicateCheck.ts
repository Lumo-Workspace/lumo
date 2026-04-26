'use client'

import { useState, useEffect, useRef } from 'react'
import { findSimilarTasks, SimilarTaskMatch } from '@/lib/similarity'
import { ApiTask } from '../types'

const DEBOUNCE_MS = 500
const THRESHOLD = 0.5
const MAX_RESULTS = 3

export function useDuplicateCheck(
  title: string,
  tasks: ApiTask[],
  projectId: string
) {
  const [clientMatches, setClientMatches] = useState<
    SimilarTaskMatch<ApiTask>[]
  >([])
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current)

    const trimmed = title.trim()
    if (trimmed.length < 3 || !projectId) {
      // Avoid scheduling a re-render when there's nothing to clear — passing a
      // fresh [] would fail Object.is and feed any unstable dep upstream into
      // an infinite loop.
      setClientMatches(prev => (prev.length === 0 ? prev : []))
      return
    }

    timerRef.current = setTimeout(() => {
      const matches = findSimilarTasks(trimmed, tasks, projectId, {
        threshold: THRESHOLD,
        maxResults: MAX_RESULTS,
      })
      setClientMatches(matches)
    }, DEBOUNCE_MS)

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [title, tasks, projectId])

  return { clientMatches }
}
