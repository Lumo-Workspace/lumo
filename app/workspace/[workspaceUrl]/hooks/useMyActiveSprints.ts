'use client'

import { useState, useEffect } from 'react'
import { sprintsClient } from '@/lib/api-client'

/**
 * Fetches the active sprint IDs for all teams the current user belongs to.
 * Used by the "Current sprint only" filter chip on the My Tasks page.
 */
export function useMyActiveSprints() {
  const [sprintIds, setSprintIds] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    sprintsClient
      .myActiveSprintIds()
      .then(data => {
        if (!cancelled) setSprintIds(data.sprintIds)
      })
      .catch(() => {
        if (!cancelled) setError('Could not load active sprints.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  return { sprintIds, loading, error }
}
