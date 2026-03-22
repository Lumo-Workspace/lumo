'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { MyTask } from '../types'
import { readCache, writeCache } from '../cache'
import { API, CACHE_KEY } from '../constants'

export function useMyTasks() {
  const [myTasks, setMyTasks] = useState<MyTask[]>([])
  const [myTasksViewId, setMyTasksViewId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const seeded = useRef(false)

  // Hydrate from localStorage on mount so data shows immediately on refresh
  useEffect(() => {
    const cached = readCache<
      { tasks: MyTask[]; myTasksViewId: string | null } | MyTask[]
    >(CACHE_KEY.myTasks)
    if (cached) {
      if (Array.isArray(cached)) {
        // Legacy format — migrate silently
        setMyTasks(cached)
      } else {
        setMyTasks(cached.tasks ?? [])
        setMyTasksViewId(cached.myTasksViewId)
      }
      seeded.current = true
    }
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
      setMyTasks(data.tasks)
      setMyTasksViewId(data.myTasksViewId)
      writeCache(CACHE_KEY.myTasks, {
        tasks: data.tasks,
        myTasksViewId: data.myTasksViewId,
      })
      seeded.current = true
    } catch {
      if (!seeded.current) setError('Could not load your tasks.')
    } finally {
      setLoading(false)
    }
  }, [])

  return { myTasks, setMyTasks, myTasksViewId, loading, error, fetchMyTasks }
}
