'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { ApiProject } from '../types'
import { readCache, writeCache } from '../cache'
import { CACHE_KEY } from '../constants'
import { projectsClient } from '@/lib/api-client'
import { usePusherEvent } from './usePusher'
import type { WorkspaceEvent } from '@/lib/integrations/pusher/types'

/**
 * Read-and-refresh hook shared by `ProjectsSidebarGroup`. It works in every
 * shell that renders `<AppSidebar>` — `WorkspaceApp`, `TaskDetailPage`,
 * `ProjectDetailStandalonePage` — without hoisting `useProjects` into each.
 *
 * - Seeds from the same `lumo:projects` localStorage cache that `useProjects`
 *   writes to, so the list is visible on first render when available.
 * - Re-fetches whenever `workspaceSlug` changes.
 * - Subscribes to Pusher `workspace-{slug}` `workspace-update` events:
 *     - `projects-reordered` — re-sorts the local list idempotently.
 *     - `project-created`    — refetches the list so the new project
 *       appears in the sidebar (including in the creator's own tab,
 *       whose optimistic state lives in `WorkspaceApp` and is not shared
 *       with this hook).
 */
export function useSidebarProjects(workspaceSlug: string | null) {
  const [projects, setProjects] = useState<ApiProject[]>(
    () => readCache<ApiProject[]>(CACHE_KEY.projects) ?? []
  )

  // Ref mirror so the pusher callback can read the latest projects without
  // depending on them (kept out of useCallback deps for stable subscription).
  const projectsRef = useRef(projects)
  useEffect(() => {
    projectsRef.current = projects
  }, [projects])

  const refetch = useCallback(() => {
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

  useEffect(() => {
    refetch()
  }, [workspaceSlug, refetch])

  const handleWorkspaceEvent = useCallback(
    (event: WorkspaceEvent) => {
      if (event.type === 'project-created') {
        // If we already have it (e.g., creator's own WorkspaceApp pushed it
        // into our cache), skip the refetch round-trip.
        if (projectsRef.current.some(p => p.id === event.projectId)) return
        refetch()
        return
      }
      if (event.type === 'projects-reordered') {
        const prev = projectsRef.current
        const byId = new Map(prev.map(p => [p.id, p]))
        const sorted: ApiProject[] = []
        const seen = new Set<string>()
        for (const id of event.orderedIds) {
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
        setProjects(sorted)
        writeCache(CACHE_KEY.projects, sorted)
      }
    },
    [refetch]
  )

  usePusherEvent<WorkspaceEvent>(
    workspaceSlug ? `workspace-${workspaceSlug}` : null,
    'workspace-update',
    handleWorkspaceEvent
  )

  return { projects, setProjects }
}
