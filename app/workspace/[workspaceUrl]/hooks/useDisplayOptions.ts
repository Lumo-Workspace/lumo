'use client'

import { useState, useEffect, useCallback } from 'react'
import type { CompletedFilter } from '../utils/filterCompletedTasks'
import type { TaskOrdering } from '../utils/sortTasks'

export interface DisplayOptions {
  completedFilter: CompletedFilter
  ordering: TaskOrdering
  showSubtasks: boolean
}

const DEFAULT_OPTIONS: DisplayOptions = {
  completedFilter: 'none',
  ordering: 'priority',
  showSubtasks: true,
}
const SYNC_EVENT = 'lumo:display-options-changed'

function read(key: string): DisplayOptions {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return DEFAULT_OPTIONS
    return { ...DEFAULT_OPTIONS, ...JSON.parse(raw) }
  } catch {
    return DEFAULT_OPTIONS
  }
}

export function useDisplayOptions(storageKey: string) {
  const [options, setOptions] = useState<DisplayOptions>(() => read(storageKey))

  // Sync across tabs
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === storageKey) setOptions(read(storageKey))
    }
    const onSync = () => setOptions(read(storageKey))

    window.addEventListener('storage', onStorage)
    window.addEventListener(SYNC_EVENT, onSync)
    return () => {
      window.removeEventListener('storage', onStorage)
      window.removeEventListener(SYNC_EVENT, onSync)
    }
  }, [storageKey])

  const setCompletedFilter = useCallback(
    (value: CompletedFilter) => {
      const next = { ...read(storageKey), completedFilter: value }
      localStorage.setItem(storageKey, JSON.stringify(next))
      setOptions(next)
      window.dispatchEvent(new Event(SYNC_EVENT))
    },
    [storageKey]
  )

  const setOrdering = useCallback(
    (value: TaskOrdering) => {
      const next = { ...read(storageKey), ordering: value }
      localStorage.setItem(storageKey, JSON.stringify(next))
      setOptions(next)
      window.dispatchEvent(new Event(SYNC_EVENT))
    },
    [storageKey]
  )

  const setShowSubtasks = useCallback(
    (value: boolean) => {
      const next = { ...read(storageKey), showSubtasks: value }
      localStorage.setItem(storageKey, JSON.stringify(next))
      setOptions(next)
      window.dispatchEvent(new Event(SYNC_EVENT))
    },
    [storageKey]
  )

  return { options, setCompletedFilter, setOrdering, setShowSubtasks }
}
