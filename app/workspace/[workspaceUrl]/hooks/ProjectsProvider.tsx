'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from 'react'
import { useParams } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { ApiProject } from '../types'
import { readCache, writeCache } from '../cache'
import { CACHE_KEY } from '../constants'
import { projectsClient } from '@/lib/api-client'
import { queryKeys } from '@/lib/query/keys'
import { usePusherEvent } from './usePusher'
import type { WorkspaceEvent } from '@/lib/integrations/pusher/types'

/**
 * Workspace-wide single source of truth for the projects list.
 *
 * Installed once at the workspace layout boundary so every shell that renders
 * underneath — `WorkspaceApp`, `TaskDetailPage`, `SprintDetailClient` —
 * reads the same state via TanStack Query's shared
 * cache. The Provider exists for two reasons: (a) it centralizes the
 * workspace-scoped pusher subscription, and (b) it preserves the
 * `{projects, setProjects, loading, error, fetchProjects}` shape that
 * existing callers rely on.
 *
 * Pusher is still subscribed to for updates originating *outside* this tab
 * (another member, or another tab of the same user). `project-created` is
 * short-circuited when the project id is already present locally so the
 * creator's tab doesn't refetch unnecessarily.
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
  const queryClient = useQueryClient()
  const queryKey = queryKeys.projects.all()

  const query = useQuery<ApiProject[]>({
    queryKey,
    queryFn: async () => {
      const data = await projectsClient.list<{ projects: ApiProject[] }>()
      writeCache(CACHE_KEY.projects, data.projects)
      return data.projects
    },
    // Hydrate from localStorage so the list paints instantly on remount.
    // initialData is also written through to the cache so subsequent reads
    // (e.g. setQueryData) see a real prev value.
    initialData: () => {
      if (typeof window === 'undefined') return undefined
      const cached = readCache<ApiProject[]>(CACHE_KEY.projects)
      return cached && cached.length > 0 ? cached : undefined
    },
    // The localStorage seed may be stale, so mark it as fetched-at-epoch: the
    // first mount always refetches to freshen. A long staleTime then dedupes
    // redundant refetches — projects change rarely and the workspace Pusher
    // subscription below pushes live create/delete/update/reorder events, so
    // cross-tab/cross-user changes arrive without polling on every remount.
    initialDataUpdatedAt: 0,
    staleTime: 5 * 60_000,
  })

  // Memoize so `[]` doesn't get a fresh identity each render — keeps
  // downstream useEffect/useMemo deps stable when the list is empty.
  const projects = useMemo<ApiProject[]>(() => query.data ?? [], [query.data])

  // Ref mirror so the pusher callback reads the latest projects without
  // depending on them (keeps the subscription handler stable).
  const projectsRef = useRef(projects)
  useEffect(() => {
    projectsRef.current = projects
  }, [projects])

  const setProjects = useCallback<Dispatch<SetStateAction<ApiProject[]>>>(
    action => {
      queryClient.setQueryData<ApiProject[]>(queryKey, prev => {
        const prevList = prev ?? []
        const next =
          typeof action === 'function'
            ? (action as (prev: ApiProject[]) => ApiProject[])(prevList)
            : action
        writeCache(CACHE_KEY.projects, next)
        return next
      })
    },
    // queryKey is a fresh tuple per render; we depend on queryClient instead.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [queryClient]
  )

  const fetchProjects = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryClient])

  // Refetch when the workspace changes. TanStack handles the initial fetch
  // via the queryFn, so skip the first run (it would be a redundant
  // invalidate on top of that fetch) and only refetch on an actual switch.
  const lastSlugRef = useRef(workspaceSlug)
  useEffect(() => {
    if (lastSlugRef.current === workspaceSlug) return
    lastSlugRef.current = workspaceSlug
    void fetchProjects()
  }, [workspaceSlug, fetchProjects])

  const handleWorkspaceEvent = useCallback(
    (event: WorkspaceEvent) => {
      if (event.type === 'project-created') {
        // Same-tab creator already inserted optimistically; cross-user/tab
        // hasn't — refetch in that case.
        if (projectsRef.current.some(p => p.id === event.projectId)) return
        void fetchProjects()
        return
      }
      if (event.type === 'project-deleted') {
        if (!projectsRef.current.some(p => p.id === event.projectId)) return
        setProjects(prev => prev.filter(p => p.id !== event.projectId))
        return
      }
      if (event.type === 'project-updated') {
        // Refetch to pick up the latest fields. Cheap and correct.
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
      }
    },
    [fetchProjects, setProjects]
  )

  usePusherEvent<WorkspaceEvent>(
    workspaceSlug ? `workspace-${workspaceSlug}` : null,
    'workspace-update',
    handleWorkspaceEvent
  )

  const loading = query.isLoading
  const error = query.error
    ? ((query.error as Error).message ?? 'Could not load projects.')
    : null

  const value = useMemo<ProjectsContextValue>(
    () => ({ projects, setProjects, loading, error, fetchProjects }),
    [projects, setProjects, loading, error, fetchProjects]
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
