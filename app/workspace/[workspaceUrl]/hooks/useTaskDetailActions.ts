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
  setCopiedBranchId: (id: string | null) => void
  handlePatch: (patch: Record<string, unknown>) => void
}

export function useTaskDetailActions({
  task,
  taskFullUrl,
  setCopiedBranchId,
  handlePatch,
}: UseTaskDetailActionsParams) {
  const router = useRouter()

  // ── Copy branch name ───────────────────────────────────────────────────
  const handleCopyBranch = useCallback(
    async (id: string, name: string) => {
      await navigator.clipboard.writeText(name)
      setCopiedBranchId(id)
      setTimeout(() => setCopiedBranchId(null), 1500)
    },
    [setCopiedBranchId]
  )

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
    handleCopyBranch,
    taskLinkCopied,
    handleCopyTaskLink,
    handleDeleteTask,
    commitDescription,
    commitSpec,
  }
}
