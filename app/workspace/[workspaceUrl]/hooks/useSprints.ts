'use client'

import { useEffect, useState, useCallback } from 'react'
import { sprintsClient, tasksClient } from '@/lib/api-client'
import type { Sprint, SprintStatus, SprintSummary } from '@prisma/client'

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
 * Returns { sprints, isLoading, error, refetch }.
 */
export function useSprintsForTeam(
  teamId: string | null,
  status?: SprintStatus
) {
  const [sprints, setSprints] = useState<Sprint[] | undefined>(undefined)
  const [error, setError] = useState<Error | undefined>(undefined)
  const [isLoading, setIsLoading] = useState(false)
  const [tick, setTick] = useState(0)

  const refetch = useCallback(() => setTick(t => t + 1), [])

  useEffect(() => {
    if (!teamId) {
      setSprints(undefined)
      return
    }
    let cancelled = false
    setIsLoading(true)
    setError(undefined)
    sprintsClient
      .listByTeam(teamId, status ? { status } : {})
      .then((res: SprintListResult) => {
        if (!cancelled) setSprints(res.sprints)
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err)
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [teamId, status, tick])

  return { sprints, error, isLoading, refetch }
}

// ---------------------------------------------------------------------------
// useSprint
// ---------------------------------------------------------------------------

/**
 * Fetches a single sprint with its progress stats.
 * Returns { sprint, progress, isLoading, error, refetch }.
 */
export function useSprint(sprintId: string | null) {
  const [data, setData] = useState<SprintWithProgress | undefined>(undefined)
  const [error, setError] = useState<Error | undefined>(undefined)
  const [isLoading, setIsLoading] = useState(false)
  const [tick, setTick] = useState(0)

  const refetch = useCallback(() => setTick(t => t + 1), [])

  useEffect(() => {
    if (!sprintId) {
      setData(undefined)
      return
    }
    let cancelled = false
    setIsLoading(true)
    setError(undefined)
    sprintsClient
      .get(sprintId)
      .then((res: SprintWithProgress) => {
        if (!cancelled) setData(res)
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err)
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [sprintId, tick])

  return {
    sprint: data?.sprint,
    progress: data?.progress,
    isLoading,
    error,
    refetch,
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
  const [tasks, setTasks] = useState<unknown[] | undefined>(undefined)
  const [error, setError] = useState<Error | undefined>(undefined)
  const [isLoading, setIsLoading] = useState(false)
  const [tick, setTick] = useState(0)

  const refetch = useCallback(() => setTick(t => t + 1), [])

  useEffect(() => {
    if (!sprintId) {
      setTasks(undefined)
      return
    }
    let cancelled = false
    setIsLoading(true)
    setError(undefined)
    tasksClient
      .listBySprint<TaskListResult>(sprintId)
      .then((res: TaskListResult) => {
        if (!cancelled) setTasks(res.tasks)
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err)
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [sprintId, tick])

  return { tasks, isLoading, error, refetch }
}

// ---------------------------------------------------------------------------
// useBacklogTasks
// ---------------------------------------------------------------------------

/**
 * Fetches backlog tasks (sprintId = null) for a team.
 * Returns { tasks, isLoading, error, refetch }.
 */
export function useBacklogTasks(teamId: string | null) {
  const [tasks, setTasks] = useState<unknown[] | undefined>(undefined)
  const [error, setError] = useState<Error | undefined>(undefined)
  const [isLoading, setIsLoading] = useState(false)
  const [tick, setTick] = useState(0)

  const refetch = useCallback(() => setTick(t => t + 1), [])

  useEffect(() => {
    if (!teamId) {
      setTasks(undefined)
      return
    }
    let cancelled = false
    setIsLoading(true)
    setError(undefined)
    tasksClient
      .listByTeam<TaskListResult>(teamId, { sprintId: null })
      .then((res: TaskListResult) => {
        if (!cancelled) setTasks(res.tasks)
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err)
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [teamId, tick])

  return { tasks, isLoading, error, refetch }
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
  const [summary, setSummary] = useState<SprintSummary | null | undefined>(
    undefined
  )
  const [error, setError] = useState<Error | undefined>(undefined)
  const [isLoading, setIsLoading] = useState(false)
  const [tick, setTick] = useState(0)

  const refetch = useCallback(() => setTick(t => t + 1), [])

  useEffect(() => {
    if (!sprintId) {
      setSummary(undefined)
      return
    }
    let cancelled = false
    setIsLoading(true)
    setError(undefined)
    sprintsClient
      .getSummary(sprintId)
      .then((res: SprintSummary) => {
        if (!cancelled) setSummary(res ?? null)
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err)
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [sprintId, tick])

  return { summary, isLoading, error, refetch }
}
