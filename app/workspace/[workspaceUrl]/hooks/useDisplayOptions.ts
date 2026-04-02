'use client'

import { useState, useEffect, useCallback } from 'react'
import type { CompletedFilter } from '../utils/filterCompletedTasks'

export interface DisplayOptions {
  completedFilter: CompletedFilter
}

const DEFAULT_OPTIONS: DisplayOptions = { completedFilter: 'none' }
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

  return { options, setCompletedFilter }
}
