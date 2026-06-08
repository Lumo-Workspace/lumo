'use client'

import { useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { tasksClient } from '@/lib/api-client'
import { copyLink } from '@/lib/utils/copyLink'
import { useCopyState } from './useCopyState'
import { taskSourcePath } from '../utils'
import type { TaskDetail } from '../types'

interface UseTaskDetailActionsParams {
  task: TaskDetail
  taskFullUrl: string
  workspaceUrl: string
  /** Breadcrumb source ('my-tasks' or null for a project). Drives the post-delete redirect. */
  from: string | null
  handlePatch: (patch: Record<string, unknown>) => void
}

export function useTaskDetailActions({
  task,
  taskFullUrl,
  workspaceUrl,
  from,
  handlePatch,
}: UseTaskDetailActionsParams) {
  const router = useRouter()

  // ── Copy task link ─────────────────────────────────────────────────────
  const [taskLinkCopied, triggerTaskLinkCopy] = useCopyState()
  const handleCopyTaskLink = useCallback(async () => {
    await copyLink(taskFullUrl)
    triggerTaskLinkCopy()
  }, [taskFullUrl, triggerTaskLinkCopy])

  // ── Delete task ────────────────────────────────────────────────────────
  // Redirect to the source-context parent (my-tasks or the task's project list)
  // rather than `router.back()`. `back()` walks the browser history stack, which
  // on direct-link / deep-link / refresh entry can land on an unrelated page (or
  // re-show the now-deleted task). `taskSourcePath` mirrors the breadcrumb's
  // back-link so the two stay in sync.
  const handleDeleteTask = useCallback(async () => {
    await tasksClient.delete(task.id)
    router.push(taskSourcePath(workspaceUrl, from, task.project.name))
  }, [task.id, task.project.name, workspaceUrl, from, router])

  // ── Commit description ─────────────────────────────────────────────────
  const commitDescription = useCallback(
    (html: string | null) => {
      const next = html?.trim() || null
      if (next === (task.description ?? null)) return
      handlePatch({ description: next })
    },
    [task.description, handlePatch]
  )

  // ── Commit spec ────────────────────────────────────────────────────────
  const commitSpec = useCallback(
    (html: string | null) => {
      const next = html?.trim() || null
      if (next === (task.spec ?? null)) return
      handlePatch({ spec: next })
    },
    [task.spec, handlePatch]
  )

  return {
    taskLinkCopied,
    handleCopyTaskLink,
    handleDeleteTask,
    commitDescription,
    commitSpec,
  }
}
