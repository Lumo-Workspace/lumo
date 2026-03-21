'use client'

import { useState, useRef, useCallback } from 'react'
import { ApiTask } from '../types'
import { readCache, writeCache } from '../cache'
import { flattenTasks } from '../utils'

export function useProjectTasks() {
  const [tasks, setTasks] = useState<ApiTask[]>([])
  const [kanbanViewId, setKanbanViewId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const seeded = useRef(false)

  /**
   * Immediately populate state from the per-project cache key.
   * Call this before `fetchProjectTasks` when switching projects.
   */
  const hydrateForProject = useCallback((projectId: string) => {
    setError(null)
    const cached = readCache<
      { tasks: ApiTask[]; kanbanViewId: string | null } | ApiTask[]
    >(`lumo:projectTasks:${projectId}`)
    if (cached) {
      if (Array.isArray(cached)) {
        // Legacy format — migrate silently
        setTasks(cached)
        setKanbanViewId(null)
      } else {
        setTasks(cached.tasks ?? [])
        setKanbanViewId(cached.kanbanViewId)
      }
      seeded.current = true
    } else {
      setTasks([])
      setKanbanViewId(null)
      seeded.current = false
    }
  }, [])

  const fetchProjectTasks = useCallback(async (projectId: string) => {
    setError(null)
    try {
      const res = await fetch(`/api/projects/${projectId}/tasks`)
      if (!res.ok) throw new Error('Failed to load tasks')
      const data = (await res.json()) as {
        tasks: (ApiTask & { children?: ApiTask[] })[]
        kanbanViewId: string
      }
      const flat = flattenTasks(data.tasks)
      setTasks(flat)
      setKanbanViewId(data.kanbanViewId)
      writeCache(`lumo:projectTasks:${projectId}`, {
        tasks: flat,
        kanbanViewId: data.kanbanViewId,
      })
      seeded.current = true
    } catch {
      if (!seeded.current) setError('Could not load tasks.')
    } finally {
      setLoading(false)
    }
  }, [])

  return {
    tasks,
    setTasks,
    kanbanViewId,
    loading,
    error,
    hydrateForProject,
    fetchProjectTasks,
  }
}
