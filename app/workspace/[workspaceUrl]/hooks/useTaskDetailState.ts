'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query'
import { useIntl } from 'react-intl'
import type { TaskDetail } from '../types'
import { queryKeys } from '@/lib/query/keys'
import { slugify } from '@/lib/utils/slugify'

type TaskUpdater = TaskDetail | ((prev: TaskDetail) => TaskDetail)

function applyTaskUpdate(
  queryClient: QueryClient,
  taskId: string,
  fallback: TaskDetail,
  updater: TaskUpdater
) {
  queryClient.setQueryData<TaskDetail>(queryKeys.tasks.detail(taskId), prev => {
    const base = prev ?? fallback
    return typeof updater === 'function'
      ? (updater as (prev: TaskDetail) => TaskDetail)(base)
      : updater
  })
}

interface UseTaskDetailStateParams {
  initialTask: TaskDetail
  workspaceUrl: string
  sourceProp: string | undefined
}

export function useTaskDetailState({
  initialTask,
  workspaceUrl,
  sourceProp,
}: UseTaskDetailStateParams) {
  const intl = useIntl()
  // ── Breadcrumb source ──────────────────────────────────────────────────
  const [from, setFrom] = useState<string | null>(sourceProp ?? null)
  useEffect(() => {
    if (sourceProp) return
    const stored = sessionStorage.getItem('lumo:taskSource')
    if (stored) {
      setFrom(stored)
      sessionStorage.removeItem('lumo:taskSource')
    }
  }, [sourceProp])

  const sourceLabel =
    from === 'my-tasks'
      ? intl.formatMessage({ id: 'sidebar.myTasks' })
      : (initialTask.project?.name ??
        intl.formatMessage({ id: 'common.project' }))

  // ── Task state (TanStack-backed) ──────────────────────────────────────
  // Read the live task from the per-task detail cache so mutations and
  // realtime updates flow through a single source of truth. `initialData`
  // seeds the cache on first mount.
  const queryClient = useQueryClient()
  const queryKey = queryKeys.tasks.detail(initialTask.id)
  const taskQuery = useQuery<TaskDetail>({
    queryKey,
    initialData: initialTask,
    enabled: false,
  })
  const task = taskQuery.data ?? initialTask
  const setTask = useCallback(
    (updater: TaskUpdater) => {
      applyTaskUpdate(queryClient, initialTask.id, initialTask, updater)
    },
    [queryClient, initialTask]
  )

  // ── Window origin (client only) ────────────────────────────────────────
  const [origin, setOrigin] = useState('')
  useEffect(() => setOrigin(window.location.origin), [])

  // ── Task URL ───────────────────────────────────────────────────────────
  const taskIdentifier = `${task.teamIdentifier}-${task.number}`
  const taskFullUrl = useMemo(() => {
    const base = `${origin}/workspace/${workspaceUrl}`
    return from === 'my-tasks'
      ? `${base}/my-tasks/${taskIdentifier}`
      : `${base}/projects/${slugify(task.project.name)}/tasks/${taskIdentifier}`
  }, [origin, workspaceUrl, from, taskIdentifier, task.project.name])

  // ── Delete dialog ──────────────────────────────────────────────────────
  const [deleteOpen, setDeleteOpen] = useState(false)

  // Members + agents are NOT held here — consumers read them from the shared
  // workspace-global `useMembers()` cache. Likewise projects come from
  // `ProjectsProvider` via `useProjects()`. Keeping local copies here used to
  // duplicate the shared cache and bypass it (a stale list resolving after a
  // concurrent mutation could write deleted data back).

  return {
    from,
    sourceLabel,
    task,
    setTask,
    origin,
    taskIdentifier,
    taskFullUrl,
    deleteOpen,
    setDeleteOpen,
  }
}
