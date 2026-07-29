'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  clearFilterDimension,
  normalizeFilters,
  toggleFilterValue,
  type FilterDimension,
  type TaskFilters,
} from '../utils/filterTasks'

const SYNC_EVENT = 'lumo:task-filters-changed'

/** Filters live beside the scope's display options, under a `:filters` suffix. */
function keyFor(scopeKey: string): string {
  return `${scopeKey}:filters`
}

function read(scopeKey: string): TaskFilters {
  try {
    const raw = localStorage.getItem(keyFor(scopeKey))
    if (!raw) return {}
    return normalizeFilters(JSON.parse(raw))
  } catch {
    return {}
  }
}

/**
 * Per-scope task-board filter selection, persisted the way display options are:
 * one localStorage entry per scope (My Tasks / a project / a sprint / a
 * milestone each keep their own), kept in sync across tabs and across mounted
 * boards sharing the same scope.
 *
 * `scopeKey` is the scope's display-options key — the `:filters` suffix is
 * applied here so callers never have to spell it.
 */
export function useTaskFilters(scopeKey: string) {
  const [filters, setFilters] = useState<TaskFilters>(() => read(scopeKey))

  useEffect(() => {
    setFilters(read(scopeKey))
    const onStorage = (e: StorageEvent) => {
      if (e.key === keyFor(scopeKey)) setFilters(read(scopeKey))
    }
    const onSync = () => setFilters(read(scopeKey))

    window.addEventListener('storage', onStorage)
    window.addEventListener(SYNC_EVENT, onSync)
    return () => {
      window.removeEventListener('storage', onStorage)
      window.removeEventListener(SYNC_EVENT, onSync)
    }
  }, [scopeKey])

  const commit = useCallback(
    (next: TaskFilters) => {
      try {
        if (Object.keys(next).length === 0) {
          localStorage.removeItem(keyFor(scopeKey))
        } else {
          localStorage.setItem(keyFor(scopeKey), JSON.stringify(next))
        }
      } catch {
        // Private-mode / quota failures shouldn't break filtering for this
        // session — the in-memory selection below still applies.
      }
      setFilters(next)
      window.dispatchEvent(new Event(SYNC_EVENT))
    },
    [scopeKey]
  )

  const toggleValue = useCallback(
    (dimension: FilterDimension, value: string) =>
      commit(toggleFilterValue(read(scopeKey), dimension, value)),
    [commit, scopeKey]
  )

  const clearDimension = useCallback(
    (dimension: FilterDimension) =>
      commit(clearFilterDimension(read(scopeKey), dimension)),
    [commit, scopeKey]
  )

  const clearAll = useCallback(() => commit({}), [commit])

  return { filters, toggleValue, clearDimension, clearAll }
}
