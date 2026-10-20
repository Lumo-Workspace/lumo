'use client'

import { useCallback } from 'react'
import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
  type Updater,
} from '@tanstack/react-query'
import { sprintsClient, tasksClient } from '@/lib/api-client'
import type {
  SprintAttentionResponse,
  SprintAttentionScope,
  SprintBurnupResponse,
} from '@/lib/api-client/sprints'
import { queryKeys } from '@/lib/query/keys'
import type { TaskDetail } from '../types'
import type { Sprint, SprintStatus, SprintSummary } from '@prisma/client'
import type { TopBlockers } from '@/types/summary'

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
  /** 同类历史基线:该 team 已完成 sprint 的完成率样本(0..1)。空=暂无基线。 */
  priorCompletionRates: number[]
}

interface SprintWithProgress {
  sprint: Sprint
  progress: SprintProgress
  topBlockers?: TopBlockers
  // The by-number response bundles the sprint's tasks so we can seed the
  // tasks.bySprint cache and avoid the serial sprint→tasks waterfall (LUM-200).
  tasks?: unknown[]
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
 *
 * `enabled` (default true) lets callers defer the fetch — e.g. the task-field
 * dropdown gates it on `open` so the full option list isn't pulled on first
 * paint, only when the user actually opens the selector (LUM-190).
 *
 * Returns { sprints, setSprints, error, isLoading, refetch }.
 */
export function useSprintsForTeam(
  teamId: string | null,
  status?: SprintStatus,
  enabled = true
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
    enabled: !!teamId && enabled,
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
    // `isLoading` (not `isPending`) so a deferred/disabled query — gated off
    // until the dropdown opens (LUM-190) — reads as not-loading instead of a
    // perpetual pending, which would otherwise pin the field skeleton (LUM-191).
    isLoading: query.isLoading && !!teamId,
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
  const queryClient = useQueryClient()
  const enabled = !!workspaceUrl && !!number
  const query = useQuery<SprintWithProgress>({
    queryKey: enabled
      ? queryKeys.sprints.byNumber(workspaceUrl, number)
      : ['sprints', 'byNumber', 'disabled'],
    queryFn: async () => {
      const data = (await sprintsClient.getByNumber(
        workspaceUrl as string,
        number as number
      )) as SprintWithProgress
      // Seed the tasks.bySprint cache from the bundled tasks so the gated
      // useSprintTasks(sprint.id) call below is an instant cache hit instead
      // of a second serial request (LUM-200). Within the 30s default
      // staleTime it won't even background-refetch.
      if (data.sprint?.id && Array.isArray(data.tasks)) {
        queryClient.setQueryData(
          queryKeys.tasks.bySprint(data.sprint.id),
          data.tasks
        )
        seedTaskDetailCache(queryClient, data.tasks)
      }
      return data
    },
    enabled,
  })

  return {
    sprint: query.data?.sprint,
    progress: query.data?.progress,
    topBlockers: query.data?.topBlockers,
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

/** How long to give the server-side generation before re-reading. */
const RETRO_RETRY_SETTLE_MS = 2000

/**
 * LUM-1281 — re-trigger retro generation for a closed sprint (the retired
 * RetroPanel's path): POST retry, give the async job a moment, then re-read
 * the summary.
 */
export function useRetrySprintSummary(sprintId: string | null) {
  const queryClient = useQueryClient()
  const mutation = useMutation<void, Error>({
    mutationFn: async () => {
      await sprintsClient.retrySummary(sprintId as string)
      await new Promise(resolve => setTimeout(resolve, RETRO_RETRY_SETTLE_MS))
    },
    onSettled: () => {
      if (!sprintId) return
      void queryClient.invalidateQueries({
        queryKey: queryKeys.sprints.summary(sprintId),
      })
    },
  })

  return {
    retry: () => {
      if (sprintId) mutation.mutate()
    },
    retrying: mutation.isPending,
    retryError: mutation.error ?? undefined,
  }
}

// ---------------------------------------------------------------------------
// useSprintBurnup
// ---------------------------------------------------------------------------

/**
 * Fetches the reconstructed burnup (scope/completed/projected) series for a sprint.
 * Returns { burnup, isLoading, error }.
 */
export function useSprintBurnup(sprintId: string | null) {
  const query = useQuery<SprintBurnupResponse | null>({
    queryKey: sprintId
      ? queryKeys.sprints.burnup(sprintId)
      : ['sprints', 'burnup', 'disabled'],
    queryFn: async () => {
      const res = await sprintsClient.getBurnup(sprintId as string)
      return res ?? null
    },
    enabled: !!sprintId,
  })

  return {
    burnup: query.data ?? null,
    isLoading: query.isPending && !!sprintId,
    error: query.error ?? undefined,
  }
}

// ---------------------------------------------------------------------------
// useSprintAttention
// ---------------------------------------------------------------------------

/**
 * LUM-1278 — the attention-first Sprint page's single read: queue, per-task
 * trust + verified, stages and cost. `scope` picks team-wide or "mine".
 */
export function useSprintAttention(
  sprintId: string | null,
  scope: SprintAttentionScope = 'team'
) {
  const query = useQuery<SprintAttentionResponse | null>({
    queryKey: sprintId
      ? queryKeys.sprints.attention(sprintId, scope)
      : ['sprints', 'attention', 'disabled'],
    queryFn: async () => {
      const res = await sprintsClient.getAttention(sprintId as string, scope)
      return res ?? null
    },
    enabled: !!sprintId,
  })

  return {
    attention: query.data ?? null,
    isLoading: query.isPending && !!sprintId,
    error: query.error ?? undefined,
  }
}
