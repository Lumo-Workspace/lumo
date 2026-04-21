'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiProject } from '../types'
import { readCache, writeCache } from '../cache'
import { CACHE_KEY } from '../constants'
import { projectsClient } from '@/lib/api-client'
import { usePusherEvent } from './usePusher'

/**
 * Read-and-refresh hook shared by `ProjectsSidebarGroup`. It works in every
 * shell that renders `<AppSidebar>` — `WorkspaceApp`, `TaskDetailPage`,
 * `ProjectDetailStandalonePage` — without hoisting `useProjects` into each.
 *
 * - Seeds from the same `lumo:projects` localStorage cache that `useProjects`
 *   writes to, so the list is visible on first render when available.
 * - Fetches in the background on mount to pick up fresh data.
 * - Subscribes to Pusher `workspace-{slug}` `workspace-update` events and
 *   re-sorts locally when another member reorders.
 */
export function useSidebarProjects(workspaceSlug: string | null) {
  const [projects, setProjects] = useState<ApiProject[]>(
    () => readCache<ApiProject[]>(CACHE_KEY.projects) ?? []
  )
  const didInit = useRef(false)

  useEffect(() => {
    if (didInit.current) return
    didInit.current = true
    projectsClient
      .list<{ projects: ApiProject[] }>()
      .then(data => {
        setProjects(data.projects)
        writeCache(CACHE_KEY.projects, data.projects)
      })
      .catch(() => {
        // keep the cached list; error is non-fatal for the sidebar.
      })
  }, [])

  // Apply a remote reorder: reshuffle the known projects to match the event.
  const applyRemoteOrder = useCallback(
    (event: { type: string; orderedIds?: string[] }) => {
      if (event.type !== 'projects-reordered' || !event.orderedIds) return
      setProjects(prev => {
        const byId = new Map(prev.map(p => [p.id, p]))
        const sorted: ApiProject[] = []
        const seen = new Set<string>()
        for (const id of event.orderedIds!) {
          const p = byId.get(id)
          if (p) {
            sorted.push(p)
            seen.add(id)
          }
        }
        // Append any project the server did not reorder (e.g., local-only
        // optimistic entry) at the end so nothing disappears.
        for (const p of prev) {
          if (!seen.has(p.id)) sorted.push(p)
        }
        writeCache(CACHE_KEY.projects, sorted)
        return sorted
      })
    },
    []
  )

  usePusherEvent<{ type: string; orderedIds?: string[] }>(
    workspaceSlug ? `workspace-${workspaceSlug}` : null,
    'workspace-update',
    applyRemoteOrder
  )

  return { projects, setProjects }
}
