'use client'

import { useState, useCallback, useEffect } from 'react'
import { apiFetch } from '@/lib/api-client'
import type { ApiRepository } from '../types'

/**
 * The linked-repository list for one project, plus the three writes that change
 * it (link, set-default, unlink).
 *
 * Split out of the Repos row so that row is only markup: fetching and mutating
 * live here, rendering lives there. The list is local state rather than a query
 * because the server hands the initial rows down with the project — this hook
 * only has to keep them in step with the writes it performs.
 *
 * Write failures deliberately leave the list untouched: these are reversible,
 * low-stakes links, and a row that flickers back is a clearer signal than a
 * toast for something the user can simply retry.
 */
export function useProjectRepositories(
  projectId: string,
  initial: ApiRepository[] | undefined
) {
  const [repositories, setRepositories] = useState<ApiRepository[]>(
    initial ?? []
  )
  // Re-sync when the parent hydrates repositories from the API — the standalone
  // project page renders before that response lands.
  useEffect(() => {
    if (initial) setRepositories(initial)
  }, [initial])

  const [linking, setLinking] = useState<string | null>(null)

  const link = useCallback(
    async (fullName: string) => {
      setLinking(fullName)
      try {
        const data = await apiFetch<{ repository: ApiRepository }>(
          `/api/projects/${projectId}/repositories`,
          { method: 'POST', body: { fullName } }
        )
        setRepositories(prev => [...prev, data.repository])
        return true
      } finally {
        setLinking(null)
      }
    },
    [projectId]
  )

  const setDefault = useCallback(
    async (repoId: string) => {
      try {
        await apiFetch(`/api/projects/${projectId}/repositories/${repoId}`, {
          method: 'PATCH',
          body: { isDefault: true },
        })
        setRepositories(prev =>
          prev.map(r => ({ ...r, isDefault: r.id === repoId }))
        )
      } catch {
        // Leave the list as-is; the star simply doesn't move.
      }
    },
    [projectId]
  )

  const unlink = useCallback(
    async (repoId: string) => {
      try {
        await apiFetch(`/api/projects/${projectId}/repositories/${repoId}`, {
          method: 'DELETE',
        })
        setRepositories(prev => prev.filter(r => r.id !== repoId))
      } catch {
        // Leave the list as-is; the row stays.
      }
    },
    [projectId]
  )

  return { repositories, linking, link, setDefault, unlink }
}
