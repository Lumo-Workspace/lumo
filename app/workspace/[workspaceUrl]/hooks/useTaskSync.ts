'use client'

import { useState, useEffect } from 'react'
import type { TaskDetail } from '../types'
import { tasksClient, apiFetch } from '@/lib/api-client'
import { usePusherEvent } from './usePusher'
import type { TaskEvent } from '@/lib/integrations/pusher'

// ── Types ───────────────────────────────────────────────────────────────────

interface UseTaskSyncOptions {
  initialTaskId: string
  setTask: React.Dispatch<React.SetStateAction<TaskDetail>>
  /** Called when description is loaded/updated from API */
  onDescriptionFetched: (description: string | null) => void
  /** Called when loading is complete (in .finally()) */
  onLoadingDone: () => void
  /** Called to refresh comments after Pusher event */
  fetchComments: () => Promise<void>
}

interface RelatedDoc {
  id: string
  slug: string
  title: string
  emoji: string | null
  updatedAt: string
}

// ── Hook ────────────────────────────────────────────────────────────────────

export function useTaskSync({
  initialTaskId,
  setTask,
  onDescriptionFetched,
  onLoadingDone,
  fetchComments,
}: UseTaskSyncOptions) {
  const [relatedDocs, setRelatedDocs] = useState<RelatedDoc[]>([])

  // DnD / bulk / Pusher updates now flow directly into the per-task cache
  // (tasks.detail(id)) via useWorkspaceTaskHandlers + the workspace Pusher
  // handler. The detail page reads from that cache, so a separate liveTask
  // bridge effect is no longer needed.

  // ── Fetch full task detail on mount ─────────────────────────────────────
  useEffect(() => {
    tasksClient
      .getById<{ task: TaskDetail | null }>(initialTaskId)
      .then(taskData => {
        if (taskData.task) {
          const t = taskData.task as TaskDetail
          setTask(prev => ({
            ...prev,
            description: t.description,
            project: t.project,
            assignee: t.assignee,
            number: t.number,
            teamIdentifier: t.teamIdentifier,
            pullRequests: t.pullRequests ?? [],
            branches: t.branches ?? [],
            dueDate: t.dueDate ?? null,
          }))
          onDescriptionFetched(t.description ?? null)
        }
      })
      .catch(() => {})
      .finally(() => {
        onLoadingDone()
      })

    fetchComments()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialTaskId])

  // ── Related documents ──────────────────────────────────────────────────
  useEffect(() => {
    if (!initialTaskId) return
    apiFetch<{
      documents?: RelatedDoc[]
    }>(`/api/tasks/${initialTaskId}/documents`)
      .then(data => setRelatedDocs(data.documents ?? []))
      .catch(() => {})
  }, [initialTaskId])

  // ── Pusher: real-time task & comment updates ───────────────────────────
  usePusherEvent<TaskEvent>(`task-${initialTaskId}`, 'task-update', event => {
    if (
      event.type === 'comment:created' ||
      event.type === 'comment:updated' ||
      event.type === 'comment:deleted'
    ) {
      fetchComments()
    }
    if (event.type === 'task:updated') {
      tasksClient
        .getById<{ task: TaskDetail }>(initialTaskId)
        .then(data => {
          if (data?.task) {
            const t = data.task
            setTask(prev => ({
              ...prev,
              description: t.description,
              project: t.project,
              assignee: t.assignee,
              pullRequests: t.pullRequests ?? [],
              branches: t.branches ?? [],
            }))
            onDescriptionFetched(t.description ?? null)
          }
        })
        .catch(() => {})
    }
  })

  return { relatedDocs }
}
