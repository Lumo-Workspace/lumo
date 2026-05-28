'use client'

import { useCallback } from 'react'
import {
  useQuery,
  useQueryClient,
  type QueryClient,
  type Updater,
} from '@tanstack/react-query'
import { sprintsClient, tasksClient } from '@/lib/api-client'
import { queryKeys } from '@/lib/query/keys'
import type { TaskDetail } from '../types'
import type { Sprint, SprintStatus, SprintSummary } from '@prisma/client'

// Mirror each fetched task into the per-task detail cache so detail pages
// can read by id without a re-fetch. Sprint / backlog responses include
// full enough fields to seed a partial TaskDetail.
function seedTaskDetailCache(queryClient: QueryClient, tasks: unknown[]) {
  for (const raw of tasks) {
    const t = raw as { id?: string } & Record<string, unknown>
    if (!t.id) continue
    queryClient.setQueryData<TaskDetail>(
      queryKeys.tasks.detail(t.id),
      prev => ({ ...(prev ?? {}), ...t }) as TaskDetail
    )
  }
}

// ---------------------------------------------------------------------------
// Shared types inferred from the api-client return shapes
// ---------------------------------------------------------------------------

interface SprintProgress {
  total: number
  done: number
}

interface SprintWithProgress {
  sprint: Sprint
  progress: SprintProgress
}

interface SprintListResult {
  sprints: Sprint[]
}

interface TaskListResult {
  tasks: unknown[]
}

// ---------------------------------------------------------------------------
// useSprintsForTeam
// ---------------------------------------------------------------------------

/**
 * Lists sprints for a team, optionally filtered by status.
 * Returns { sprints, setSprints, error, isLoading, refetch }.
 */
export function useSprintsForTeam(
  teamId: string | null,
  status?: SprintStatus
) {
  const queryClient = useQueryClient()
  const queryKey = teamId ? queryKeys.sprints.byTeam(teamId, status) : null

  const query = useQuery<Sprint[]>({
    queryKey: queryKey ?? ['sprints', 'disabled'],
    queryFn: async () => {
      if (!teamId) return []
      const res = (await sprintsClient.listByTeam(
        teamId,
        status ? { status } : {}
      )) as SprintListResult
      return res.sprints
    },
    enabled: !!teamId,
  })

  // Preserve the legacy `setSprints` API so callers (e.g. SprintCards
  // optimistic insert) continue to work without refactor in this phase.
  const setSprints = useCallback(
    (updater: Updater<Sprint[] | undefined, Sprint[] | undefined>) => {
      if (!queryKey) return
      queryClient.setQueryData<Sprint[] | undefined>(queryKey, prev =>
        typeof updater === 'function'
          ? (updater as (prev: Sprint[] | undefined) => Sprint[] | undefined)(
              prev
            )
          : updater
      )
    },
    [queryClient, queryKey]
  )

  return {
    sprints: query.data,
    setSprints,
    error: query.error ?? undefined,
    isLoading: query.isPending && !!teamId,
    refetch: query.refetch,
  }
}

// ---------------------------------------------------------------------------
// useSprint
// ---------------------------------------------------------------------------

/**
 * Fetches a single sprint with its progress stats.
 * Returns { sprint, progress, isLoading, error, refetch }.
 */
export function useSprint(sprintId: string | null) {
  const query = useQuery<SprintWithProgress>({
    queryKey: sprintId
      ? queryKeys.sprints.detail(sprintId)
      : ['sprints', 'detail', 'disabled'],
    queryFn: () =>
      sprintsClient.get(sprintId as string) as Promise<SprintWithProgress>,
    enabled: !!sprintId,
  })

  return {
    sprint: query.data?.sprint,
    progress: query.data?.progress,
    isLoading: query.isPending && !!sprintId,
    error: query.error ?? undefined,
    refetch: query.refetch,
  }
}

// ---------------------------------------------------------------------------
// useSprintByNumber
// ---------------------------------------------------------------------------

/**
 * Like `useSprint`, but looks up the sprint by its workspace-scoped
 * `number` instead of CUID. Used by the detail page whose URL segment is
 * the sprint number (e.g. `/workspace/{url}/sprints/1`).
 */
export function useSprintByNumber(
  workspaceUrl: string | null,
  number: number | null
) {
  const enabled = !!workspaceUrl && !!number
  const query = useQuery<SprintWithProgress>({
    queryKey: enabled
      ? queryKeys.sprints.byNumber(workspaceUrl, number)
      : ['sprints', 'byNumber', 'disabled'],
    queryFn: () =>
      sprintsClient.getByNumber(
        workspaceUrl as string,
        number as number
      ) as Promise<SprintWithProgress>,
    enabled,
  })

  return {
    sprint: query.data?.sprint,
    progress: query.data?.progress,
    isLoading: query.isPending && enabled,
    error: query.error ?? undefined,
    refetch: query.refetch,
  }
}

// ---------------------------------------------------------------------------
// useSprintTasks
// ---------------------------------------------------------------------------

/**
 * Fetches all tasks in a sprint (across all projects in the team).
 * Returns { tasks, isLoading, error, refetch }.
 */
export function useSprintTasks(sprintId: string | null) {
  const queryClient = useQueryClient()
  const query = useQuery<unknown[]>({
    queryKey: sprintId
      ? queryKeys.tasks.bySprint(sprintId)
      : ['tasks', 'bySprint', 'disabled'],
    queryFn: async () => {
      const res = await tasksClient.listBySprint<TaskListResult>(
        sprintId as string
      )
      seedTaskDetailCache(queryClient, res.tasks)
      return res.tasks
    },
    enabled: !!sprintId,
  })

  return {
    tasks: query.data,
    isLoading: query.isPending && !!sprintId,
    error: query.error ?? undefined,
    refetch: query.refetch,
  }
}

// ---------------------------------------------------------------------------
// useBacklogTasks
// ---------------------------------------------------------------------------

/**
 * Fetches backlog tasks (sprintId = null) for a team.
 * Returns { tasks, isLoading, error, refetch }.
 */
export function useBacklogTasks(teamId: string | null) {
  const queryClient = useQueryClient()
  const query = useQuery<unknown[]>({
    queryKey: teamId
      ? queryKeys.tasks.backlog(teamId)
      : ['tasks', 'backlog', 'disabled'],
    queryFn: async () => {
      const res = await tasksClient.listByTeam<TaskListResult>(
        teamId as string,
        { sprintId: null }
      )
      seedTaskDetailCache(queryClient, res.tasks)
      return res.tasks
    },
    enabled: !!teamId,
  })

  return {
    tasks: query.data,
    isLoading: query.isPending && !!teamId,
    error: query.error ?? undefined,
    refetch: query.refetch,
  }
}

// ---------------------------------------------------------------------------
// useSprintSummary
// ---------------------------------------------------------------------------

/**
 * Fetches the retro summary for a sprint.
 * Returns null if the summary has not been generated yet.
 * Returns { summary, isLoading, error, refetch }.
 */
export function useSprintSummary(sprintId: string | null) {
  const query = useQuery<SprintSummary | null>({
    queryKey: sprintId
      ? queryKeys.sprints.summary(sprintId)
      : ['sprints', 'summary', 'disabled'],
    queryFn: async () => {
      const res = (await sprintsClient.getSummary(sprintId as string)) as
        | SprintSummary
        | null
        | undefined
      return res ?? null
    },
    enabled: !!sprintId,
  })

  return {
    summary: query.data,
    isLoading: query.isPending && !!sprintId,
    error: query.error ?? undefined,
    refetch: query.refetch,
  }
}
