'use client'

import { useState, useEffect, useMemo } from 'react'
import { useIntl } from 'react-intl'
import type { TaskDetail, WorkspaceMemberInfo, ApiProject } from '../types'
import { CACHE_KEY } from '../constants'
import { readCache } from '../cache'
import { slugify } from '@/lib/utils/slugify'

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

  // ── Task state ─────────────────────────────────────────────────────────
  const [task, setTask] = useState<TaskDetail>(initialTask)

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

  // ── Create branch dialog ───────────────────────────────────────────────
  const [createBranchOpen, setCreateBranchOpen] = useState(false)

  // ── Branch copy feedback ───────────────────────────────────────────────
  const [copiedBranchId, setCopiedBranchId] = useState<string | null>(null)

  // ── Members + agents + projects (hydrate from cache) ───────────────────
  const [members, setMembers] = useState<WorkspaceMemberInfo[]>([])
  const [agentActors, setAgentActors] = useState<
    { actorId: string; name: string; avatarColor: string }[]
  >([])
  const [projects, setProjects] = useState<ApiProject[]>([])

  useEffect(() => {
    const cachedMembers = readCache<WorkspaceMemberInfo[]>(CACHE_KEY.members)
    if (cachedMembers) setMembers(cachedMembers)
    const cachedAgents = readCache<
      { actorId: string; name: string; avatarColor: string }[]
    >(CACHE_KEY.agentActors)
    if (cachedAgents) setAgentActors(cachedAgents)
    const cachedProjects = readCache<ApiProject[]>(CACHE_KEY.projects)
    if (cachedProjects) setProjects(cachedProjects)
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
    createBranchOpen,
    setCreateBranchOpen,
    copiedBranchId,
    setCopiedBranchId,
    members,
    setMembers,
    agentActors,
    setAgentActors,
    projects,
    setProjects,
  }
}
