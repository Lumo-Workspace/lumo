'use client'

import { useState, useEffect, useCallback } from 'react'
import type { TaskDetail, ApiTask } from '../types'
import { tasksClient, apiFetch } from '@/lib/api-client'
import { readCache, writeCache } from '../cache'
import { CACHE_KEY } from '../constants'
import { usePusherEvent } from './usePusher'
import type { TaskEvent } from '@/lib/integrations/pusher'

// ── Types ───────────────────────────────────────────────────────────────────

interface UseTaskSyncOptions {
  initialTaskId: string
  /** Live task from the normalized store — used to sync external updates (drag, etc.) */
  liveTask?: ApiTask | undefined
  setTask: React.Dispatch<React.SetStateAction<TaskDetail>>
  /** Called when description is loaded/updated from API */
  onDescriptionFetched: (description: string | null) => void
  /** Called when loading is complete (in .finally()) */
  onLoadingDone: () => void
  /** Called when task detail refreshes (e.g. after subtask creation) */
  onTasksChanged?: (() => void) | undefined
  /** Called to refresh comments after Pusher event */
  fetchComments: () => Promise<void>
}

interface RelatedDoc {
  id: string
  title: string
  emoji: string | null
  updatedAt: string
}

// ── Hook ────────────────────────────────────────────────────────────────────

export function useTaskSync({
  initialTaskId,
  liveTask,
  setTask,
  onDescriptionFetched,
  onLoadingDone,
  onTasksChanged,
  fetchComments,
}: UseTaskSyncOptions) {
  const [relatedDocs, setRelatedDocs] = useState<RelatedDoc[]>([])

  // ── Sync external updates (e.g. drag-and-drop status change) ────────────
  useEffect(() => {
    if (!liveTask) return
    setTask(prev => {
      if (
        prev.title === liveTask.title &&
        prev.status === liveTask.status &&
        prev.priority === liveTask.priority &&
        prev.assigneeActorId === liveTask.assigneeActorId &&
        prev.projectId === liveTask.projectId &&
        prev.dueDate === (liveTask.dueDate ?? null)
      )
        return prev
      return {
        ...prev,
        title: liveTask.title,
        status: liveTask.status,
        priority: liveTask.priority,
        assigneeActorId: liveTask.assigneeActorId,
        projectId: liveTask.projectId,
        dueDate: liveTask.dueDate ?? null,
      }
    })
  }, [liveTask]) // eslint-disable-line react-hooks/exhaustive-deps

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
            children: t.children ?? [],
            parent: t.parent ?? null,
            dueDate: t.dueDate ?? null,
          }))
          onDescriptionFetched(t.description ?? null)
          // Sync task to cache
          const taskMap =
            readCache<Record<string, ApiTask>>(CACHE_KEY.tasks) ?? {}
          writeCache(CACHE_KEY.tasks, { ...taskMap, [t.id]: t })
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
            // Sync task to cache
            const taskMap =
              readCache<Record<string, ApiTask>>(CACHE_KEY.tasks) ?? {}
            writeCache(CACHE_KEY.tasks, { ...taskMap, [t.id]: t })
          }
        })
        .catch(() => {})
    }
  })

  // ── Re-fetch task detail (used after subtask creation) ──────────────────
  const refreshDetail = useCallback(async () => {
    try {
      const data = await tasksClient.getById<{ task: TaskDetail }>(
        initialTaskId
      )
      if (data?.task) {
        const t = data.task as TaskDetail
        setTask(prev => ({
          ...prev,
          description: t.description,
          project: t.project,
          assignee: t.assignee,
          number: t.number,
          teamIdentifier: t.teamIdentifier,
          pullRequests: t.pullRequests ?? [],
          branches: t.branches ?? [],
          children: t.children ?? [],
          parent: t.parent ?? null,
        }))
        // Notify parent to refresh the task list so new subtasks appear
        onTasksChanged?.()
      }
    } catch {
      // Network error — silently ignore, user can refresh manually
    }
  }, [initialTaskId, onTasksChanged]) // eslint-disable-line react-hooks/exhaustive-deps

  return { relatedDocs, refreshDetail }
}
