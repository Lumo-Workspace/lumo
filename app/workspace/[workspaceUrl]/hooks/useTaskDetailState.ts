'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query'
import { useIntl } from 'react-intl'
import type { TaskDetail, WorkspaceMemberInfo } from '../types'
import { CACHE_KEY } from '../constants'
import { readCache } from '../cache'
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
      : `${base}/project/${slugify(task.project.name)}/tasks/${taskIdentifier}`
  }, [origin, workspaceUrl, from, taskIdentifier, task.project.name])

  // ── Delete dialog ──────────────────────────────────────────────────────
  const [deleteOpen, setDeleteOpen] = useState(false)

  // ── Members + agents (hydrate from cache) ───────────────────
  // Projects are intentionally NOT held here — consumers should read from
  // `ProjectsProvider` via `useProjects()`. Keeping a local copy here used to
  // duplicate the projects cache/state and bypass the Provider (e.g. a stale
  // `projectsClient.list()` on mount could write a deleted project back into
  // the cache).
  const [members, setMembers] = useState<WorkspaceMemberInfo[]>([])
  const [agentActors, setAgentActors] = useState<
    { actorId: string; name: string; avatarColor: string }[]
  >([])

  useEffect(() => {
    const cachedMembers = readCache<WorkspaceMemberInfo[]>(CACHE_KEY.members)
    if (cachedMembers) setMembers(cachedMembers)
    const cachedAgents = readCache<
      { actorId: string; name: string; avatarColor: string }[]
    >(CACHE_KEY.agentActors)
    if (cachedAgents) setAgentActors(cachedAgents)
  }, [])

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
    members,
    setMembers,
    agentActors,
    setAgentActors,
  }
}
