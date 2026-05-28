'use client'

import { useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { tasksClient } from '@/lib/api-client'
import { copyLink } from '@/lib/utils/copyLink'
import { useCopyState } from './useCopyState'
import type { TaskDetail } from '../types'

interface UseTaskDetailActionsParams {
  task: TaskDetail
  taskFullUrl: string
  handlePatch: (patch: Record<string, unknown>) => void
}

export function useTaskDetailActions({
  task,
  taskFullUrl,
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
  const handleDeleteTask = useCallback(async () => {
    await tasksClient.delete(task.id)
    router.back()
  }, [task.id, router])

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
