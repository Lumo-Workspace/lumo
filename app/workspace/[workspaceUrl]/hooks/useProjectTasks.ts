'use client'

import { useState, useRef, useCallback } from 'react'
import { ApiTask } from '../types'
import { readCache, writeCache } from '../cache'
import { flattenTasks } from '../utils'
import { CACHE_KEY } from '../constants'
import { projectsClient } from '@/lib/api-client'

type NewFormat = { taskIds: string[]; kanbanViewId: string | null }
type LegacyFull = { tasks: ApiTask[]; kanbanViewId: string | null }

export function useProjectTasks(upsertTasks: (tasks: ApiTask[]) => void) {
  const [taskIds, setTaskIds] = useState<string[]>([])
  const [kanbanViewId, setKanbanViewId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const seeded = useRef(false)

  /**
   * Immediately populate state from the per-project cache key.
   * Call this before `fetchProjectTasks` when switching projects.
   * Handles three formats: new ID-only, legacy full-task, legacy array.
   */
  const hydrateForProject = useCallback(
    (projectId: string) => {
      setError(null)
      const raw = readCache<NewFormat | LegacyFull | ApiTask[]>(
        CACHE_KEY.projectTasks(projectId)
      )
      if (!raw) {
        setTaskIds([])
        setKanbanViewId(null)
        seeded.current = false
        return
      }
      if (Array.isArray(raw)) {
        upsertTasks(raw)
        setTaskIds(raw.map(t => t.id))
        setKanbanViewId(null)
      } else if ('tasks' in raw) {
        upsertTasks(raw.tasks)
        setTaskIds(raw.tasks.map(t => t.id))
        setKanbanViewId(raw.kanbanViewId)
      } else {
        setTaskIds(raw.taskIds)
        setKanbanViewId(raw.kanbanViewId)
      }
      seeded.current = true
    },
    // upsertTasks is stable

    [upsertTasks]
  )

  const fetchProjectTasks = useCallback(
    async (projectId: string) => {
      setError(null)
      if (!seeded.current) setLoading(true)
      try {
        const data = await projectsClient.listTasks<{
          tasks: (ApiTask & { children?: ApiTask[] })[]
          kanbanViewId: string
        }>(projectId)
        const flat = flattenTasks(data.tasks)
        upsertTasks(flat)
        const ids = flat.map(t => t.id)
        setTaskIds(ids)
        setKanbanViewId(data.kanbanViewId)
        writeCache(CACHE_KEY.projectTasks(projectId), {
          taskIds: ids,
          kanbanViewId: data.kanbanViewId,
        })
        seeded.current = true
      } catch {
        if (!seeded.current) setError('Could not load tasks.')
      } finally {
        setLoading(false)
      }
    },
    [upsertTasks]
  )

  return {
    taskIds,
    setTaskIds,
    kanbanViewId,
    loading,
    error,
    hydrateForProject,
    fetchProjectTasks,
  }
}
