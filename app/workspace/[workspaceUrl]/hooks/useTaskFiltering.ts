'use client'

import { useMemo } from 'react'
import { useNow } from '@/hooks/use-now'
import { filterTasks, type FilterableTask } from '../utils/filterTasks'
import { useTaskFilters } from './useTaskFilters'

/**
 * Everything a task board needs to filter itself: the persisted selection, the
 * mutators the menu/chips call, a stable `now` for due-date bucketing, and the
 * narrowed task list.
 *
 * `now` comes from `useNow` rather than a render-time `new Date()` so the
 * `filteredTasks` memo stays a pure function of its inputs.
 */
export function useTaskFiltering<T extends FilterableTask>({
  tasks,
  scopeKey,
}: {
  /** The scope's full task list, before filtering. */
  tasks: T[]
  /** The scope's display-options key; filters are stored alongside it. */
  scopeKey: string
}) {
  const now = useNow()
  const { filters, toggleValue, clearDimension, clearAll } =
    useTaskFilters(scopeKey)

  const filteredTasks = useMemo(
    () => filterTasks(tasks, filters, now),
    [tasks, filters, now]
  )

  return { now, filters, toggleValue, clearDimension, clearAll, filteredTasks }
}
