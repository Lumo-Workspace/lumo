'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from 'react'
import { useParams } from 'next/navigation'
import type { ApiProject } from '../types'
import { readCache, writeCache } from '../cache'
import { CACHE_KEY } from '../constants'
import { projectsClient } from '@/lib/api-client'
import { usePusherEvent } from './usePusher'
import type { WorkspaceEvent } from '@/lib/integrations/pusher/types'

/**
 * Workspace-wide single source of truth for the projects list.
 *
 * Installed once at the workspace layout boundary so every shell that renders
 * underneath — `WorkspaceApp`, `TaskDetailPage`, `ProjectDetailStandalonePage`,
 * `SprintDetailClient` — reads the same state. Creating a project only has to
 * call `setProjects` once; the sidebar and the projects list update together
 * (no pusher round-trip to self just to sync two local copies).
 *
 * Pusher is still subscribed to — but only for its legitimate use: updates
 * that originate *outside* this tab (another member in the workspace, or
 * another tab of the same user). `project-created` is short-circuited when the
 * project id is already present locally so the creator's tab doesn't refetch
 * unnecessarily.
 */
interface ProjectsContextValue {
  projects: ApiProject[]
  setProjects: Dispatch<SetStateAction<ApiProject[]>>
  loading: boolean
  error: string | null
  fetchProjects: () => Promise<void>
}

const ProjectsContext = createContext<ProjectsContextValue | null>(null)

export function ProjectsProvider({ children }: { children: ReactNode }) {
  const params = useParams<{ workspaceUrl: string }>()
  const workspaceSlug = params?.workspaceUrl ?? null

  // Seed from localStorage in an effect (not a useState initializer) so the
  // server-rendered HTML stays deterministic — avoids hydration mismatch when
  // the cache is populated.
  const [projects, setProjects] = useState<ApiProject[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const seeded = useRef(false)

  useEffect(() => {
    const cached = readCache<ApiProject[]>(CACHE_KEY.projects)
    if (cached && cached.length > 0) {
      setProjects(cached)
      seeded.current = true
    }
  }, [])

  // Ref mirror so the pusher callback reads the latest projects without
  // depending on them (keeps the subscription stable).
  const projectsRef = useRef(projects)
  useEffect(() => {
    projectsRef.current = projects
  }, [projects])

  const fetchProjects = useCallback(async () => {
    if (!seeded.current) setLoading(true)
    setError(null)
    try {
      const data = await projectsClient.list<{ projects: ApiProject[] }>()
      setProjects(data.projects)
      writeCache(CACHE_KEY.projects, data.projects)
      seeded.current = true
    } catch {
      if (!seeded.current) setError('Could not load projects.')
    } finally {
      setLoading(false)
    }
  }, [])

  // Initial fetch on mount / when workspace changes.
  useEffect(() => {
    void fetchProjects()
  }, [workspaceSlug, fetchProjects])

  const handleWorkspaceEvent = useCallback(
    (event: WorkspaceEvent) => {
      if (event.type === 'project-created') {
        // Same-tab creator already inserted it via setProjects (optimistic);
        // cross-user/cross-tab hasn't — refetch for them.
        if (projectsRef.current.some(p => p.id === event.projectId)) return
        void fetchProjects()
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
        // Preserve anything the server didn't reorder (local-only optimistic
        // entries) so nothing disappears mid-request.
        for (const p of prev) {
          if (!seen.has(p.id)) sorted.push(p)
        }
        setProjects(sorted)
        writeCache(CACHE_KEY.projects, sorted)
      }
    },
    [fetchProjects]
  )

  usePusherEvent<WorkspaceEvent>(
    workspaceSlug ? `workspace-${workspaceSlug}` : null,
    'workspace-update',
    handleWorkspaceEvent
  )

  const value = useMemo<ProjectsContextValue>(
    () => ({ projects, setProjects, loading, error, fetchProjects }),
    [projects, loading, error, fetchProjects]
  )

  return (
    <ProjectsContext.Provider value={value}>
      {children}
    </ProjectsContext.Provider>
  )
}

export function useProjects(): ProjectsContextValue {
  const ctx = useContext(ProjectsContext)
  if (!ctx) {
    throw new Error('useProjects must be used within a ProjectsProvider')
  }
  return ctx
}
