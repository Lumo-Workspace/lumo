'use client'

import { useState, useEffect, useCallback } from 'react'

const STORAGE_KEY = 'lumo:docTocCollapsed'

function readInitial(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return window.localStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

/**
 * Persisted boolean for whether the document table-of-contents sidebar is
 * collapsed. Mirrors `useDocTreeCollapsed` but without the global keyboard
 * shortcut, since the TOC is per-document chrome rather than workspace chrome.
 */
export function useDocTocCollapsed(): {
  collapsed: boolean
  toggle: () => void
} {
  const [collapsed, setCollapsedState] = useState<boolean>(readInitial)

  const toggle = useCallback(() => {
    setCollapsedState(prev => {
      const next = !prev
      try {
        window.localStorage.setItem(STORAGE_KEY, next ? '1' : '0')
      } catch {
        /* ignore */
      }
      return next
    })
  }, [])

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) setCollapsedState(e.newValue === '1')
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  return { collapsed, toggle }
}
