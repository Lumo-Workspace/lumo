'use client'

import { useState, useEffect, useCallback } from 'react'

const STORAGE_KEY = 'lumo:docTreeCollapsed'

function readInitial(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return window.localStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

/**
 * Persisted boolean for whether the global document tree sidebar is collapsed.
 *
 * - State is mirrored to localStorage so it survives reloads and syncs across
 *   tabs via the `storage` event.
 * - Registers a global keyboard shortcut: `Cmd+\` (mac) / `Ctrl+\` (others)
 *   toggles the sidebar, matching Notion.
 */
export function useDocTreeCollapsed(): {
  collapsed: boolean
  toggle: () => void
  setCollapsed: (next: boolean) => void
} {
  const [collapsed, setCollapsedState] = useState<boolean>(readInitial)

  const setCollapsed = useCallback((next: boolean) => {
    setCollapsedState(next)
    try {
      window.localStorage.setItem(STORAGE_KEY, next ? '1' : '0')
    } catch {
      /* storage unavailable — keep in-memory state only */
    }
  }, [])

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

  // Sync across tabs
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) setCollapsedState(e.newValue === '1')
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  // Cmd/Ctrl + \ → toggle (Notion convention)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const isMac = /Mac|iPhone|iPad/i.test(navigator.platform)
      const modPressed = isMac ? e.metaKey : e.ctrlKey
      if (modPressed && e.key === '\\') {
        e.preventDefault()
        toggle()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [toggle])

  return { collapsed, toggle, setCollapsed }
}
