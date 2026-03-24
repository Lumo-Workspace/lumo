'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { ApiTask, MyTask } from '../types'
import { readCache, writeCache } from '../cache'
import { API, CACHE_KEY } from '../constants'

type NewFormat = { taskIds: string[]; myTasksViewId: string | null }
type LegacyFull = { tasks: MyTask[]; myTasksViewId: string | null }

export function useMyTasks(upsertTasks: (tasks: ApiTask[]) => void) {
  const [taskIds, setTaskIds] = useState<string[]>([])
  const [myTasksViewId, setMyTasksViewId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const seeded = useRef(false)

  // Hydrate from localStorage on mount so data shows immediately on refresh.
  // Handles three cache formats:
  //   1. new:    { taskIds, myTasksViewId }
  //   2. legacy: { tasks: MyTask[], myTasksViewId }
  //   3. oldest: MyTask[]
  useEffect(() => {
    const raw = readCache<NewFormat | LegacyFull | MyTask[]>(CACHE_KEY.myTasks)
    if (!raw) return
    if (Array.isArray(raw)) {
      // Oldest legacy: plain array
      upsertTasks(raw)
      setTaskIds(raw.map(t => t.id))
    } else if ('tasks' in raw) {
      // Legacy full format
      upsertTasks(raw.tasks)
      setTaskIds(raw.tasks.map(t => t.id))
      setMyTasksViewId(raw.myTasksViewId)
    } else {
      // New ID-only format — task data lives in lumo:tasks
      setTaskIds(raw.taskIds)
      setMyTasksViewId(raw.myTasksViewId)
    }
    seeded.current = true
    // upsertTasks is stable (wrapped in useCallback)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const fetchMyTasks = useCallback(async () => {
    if (!seeded.current) setLoading(true)
    setError(null)
    try {
      const res = await fetch(API.tasks.me)
      if (!res.ok) throw new Error('Failed to load tasks')
      const data = (await res.json()) as {
        tasks: MyTask[]
        myTasksViewId: string
      }
      upsertTasks(data.tasks)
      const ids = data.tasks.map(t => t.id)
      setTaskIds(ids)
      setMyTasksViewId(data.myTasksViewId)
      writeCache(CACHE_KEY.myTasks, {
        taskIds: ids,
        myTasksViewId: data.myTasksViewId,
      })
      seeded.current = true
    } catch {
      if (!seeded.current) setError('Could not load your tasks.')
    } finally {
      setLoading(false)
    }
  }, [upsertTasks])

  return { taskIds, setTaskIds, myTasksViewId, loading, error, fetchMyTasks }
}
