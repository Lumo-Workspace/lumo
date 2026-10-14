'use client'

import { useCallback, useEffect, useState } from 'react'

/**
 * LUM-1136: a per-viewer "dismissed for this version" flag kept in
 * localStorage under `key`. Dismissing stores `version`; a newer version
 * makes the flag false again so the notice comes back. A null version (the
 * latest is unknown) is stored as '' so dismissing still works. Until storage
 * has been read the flag reads as dismissed, so a dismissed notice never
 * flashes on load. Storage can be unavailable (private mode, blocked site
 * data) — then dismissal lasts only for this page view.
 */
export function useVersionDismissal(key: string, version: string | null) {
  // undefined = storage not read yet; null = nothing stored.
  const [dismissedVersion, setDismissedVersion] = useState<
    string | null | undefined
  >(undefined)
  const current = version ?? ''

  useEffect(() => {
    let stored: string | null = null
    try {
      stored = window.localStorage.getItem(key)
    } catch {
      // storage unavailable — treat as nothing stored
    }
    setDismissedVersion(stored)
  }, [key])

  const dismiss = useCallback(() => {
    setDismissedVersion(current)
    try {
      window.localStorage.setItem(key, current)
    } catch {
      // storage unavailable — dismissal lasts for this page view
    }
  }, [key, current])

  return {
    dismissed: dismissedVersion === undefined || dismissedVersion === current,
    dismiss,
  }
}
