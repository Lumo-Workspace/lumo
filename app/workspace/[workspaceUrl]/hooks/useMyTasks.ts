'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { ApiTask, MyTask } from '../types'
import { readCache, writeCache } from '../cache'
import { CACHE_KEY } from '../constants'
import { tasksClient } from '@/lib/api-client'

type NewFormat = { taskIds: string[]; myTasksViewId: string | null }
type LegacyFull = { tasks: MyTask[]; myTasksViewId: string | null }

export function useMyTasks(
  upsertTasks: (tasks: ApiTask[]) => void,
  opts: { sprintIds?: string[] } = {}
) {
  const [taskIds, setTaskIds] = useState<string[]>([])
  const [myTasksViewId, setMyTasksViewId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const seeded = useRef(false)
  // Monotonic token: every fetchMyTasks invocation bumps this; only the
  // latest invocation's result is allowed to commit to state. Prevents
  // stale in-flight API responses from overwriting a fresher short-circuit
  // result when the sprint filter toggles.
  const fetchTokenRef = useRef(0)

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

  // Stable key so useCallback doesn't get a new array reference each render
  const sprintIdsKey = opts.sprintIds?.join(',') ?? ''

  // Distinguish "caller passed an empty sprintIds list" (match nothing)
  // from "caller passed nothing at all" (no sprint filter). Empty array means
  // the user toggled "current sprint only" but has no active sprint — we should
  // show zero tasks, not fall through to "all tasks".
  const sprintFilterProvided = opts.sprintIds !== undefined
  const sprintFilterEmpty = sprintFilterProvided && opts.sprintIds!.length === 0

  const fetchMyTasks = useCallback(async () => {
    const myToken = ++fetchTokenRef.current
    const isLatest = () => myToken === fetchTokenRef.current

    if (!seeded.current) setLoading(true)
    setError(null)

    // Short-circuit: user asked for current-sprint-only tasks but has no
    // active sprint. Render an empty list without hitting the API.
    if (sprintFilterEmpty) {
      if (!isLatest()) return
      upsertTasks([])
      setTaskIds([])
      writeCache(CACHE_KEY.myTasks, {
        taskIds: [],
        myTasksViewId,
      })
      seeded.current = true
      setLoading(false)
      return
    }

    try {
      const sprintIds = sprintIdsKey ? sprintIdsKey.split(',') : undefined
      const data = await tasksClient.listMine<{
        tasks: MyTask[]
        myTasksViewId: string
      }>(sprintIds ? { sprintIds } : {})
      if (!isLatest()) return
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
      if (!isLatest()) return
      if (!seeded.current) setError('Could not load your tasks.')
    } finally {
      if (isLatest()) setLoading(false)
    }
  }, [upsertTasks, sprintIdsKey, sprintFilterEmpty, myTasksViewId])

  return { taskIds, setTaskIds, myTasksViewId, loading, error, fetchMyTasks }
}
