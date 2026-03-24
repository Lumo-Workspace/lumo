'use client'

import { useState, useCallback } from 'react'
import { ApiTask } from '../types'
import { readCache, writeCache } from '../cache'
import { CACHE_KEY } from '../constants'

export type TaskMap = Record<string, ApiTask>

export function useTaskStore() {
  const [taskMap, setTaskMap] = useState<TaskMap>(() => {
    const cached = readCache<TaskMap>(CACHE_KEY.tasks)
    return cached && typeof cached === 'object' && !Array.isArray(cached)
      ? cached
      : {}
  })

  /** Merge an array of tasks into the map. Preserves existing `project` field
   *  if the incoming task doesn't include it (e.g. project-tasks API omits it). */
  const upsertTasks = useCallback((tasks: ApiTask[]) => {
    setTaskMap(prev => {
      const next = { ...prev }
      for (const t of tasks) {
        const existing = prev[t.id]
        // Keep project info from existing entry if the new data doesn't include it.
        // Use conditional spread to satisfy exactOptionalPropertyTypes.
        const preservedProject =
          t.project === undefined && existing?.project
            ? { project: existing.project }
            : {}
        next[t.id] = { ...t, ...preservedProject }
      }
      writeCache(CACHE_KEY.tasks, next)
      return next
    })
  }, [])

  /** Apply a partial patch to a single task already in the map. */
  const updateTask = useCallback((id: string, patch: Partial<ApiTask>) => {
    setTaskMap(prev => {
      if (!prev[id]) return prev
      const next = { ...prev, [id]: { ...prev[id], ...patch } }
      writeCache(CACHE_KEY.tasks, next)
      return next
    })
  }, [])

  /** Remove a single task from the map. */
  const removeTask = useCallback((id: string) => {
    setTaskMap(prev => {
      if (!prev[id]) return prev
      const next = { ...prev }
      delete next[id]
      writeCache(CACHE_KEY.tasks, next)
      return next
    })
  }, [])

  /** Remove multiple tasks at once (e.g. when a project is deleted). */
  const removeTasks = useCallback((ids: string[]) => {
    if (ids.length === 0) return
    setTaskMap(prev => {
      const next = { ...prev }
      for (const id of ids) delete next[id]
      writeCache(CACHE_KEY.tasks, next)
      return next
    })
  }, [])

  /** Swap a temp optimistic ID for the real server-assigned ID. */
  const replaceTempId = useCallback((tempId: string, realTask: ApiTask) => {
    setTaskMap(prev => {
      if (!prev[tempId]) return prev
      const next = { ...prev }
      delete next[tempId]
      const preservedProject =
        realTask.project === undefined && prev[tempId]?.project
          ? { project: prev[tempId]!.project }
          : {}
      next[realTask.id] = { ...realTask, ...preservedProject }
      writeCache(CACHE_KEY.tasks, next)
      return next
    })
  }, [])

  return {
    taskMap,
    upsertTasks,
    updateTask,
    removeTask,
    removeTasks,
    replaceTempId,
  }
}
