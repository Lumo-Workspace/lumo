'use client'

import { useCallback, useEffect, useState } from 'react'

/**
 * LUM-1136: a per-viewer "dismissed for this version" flag kept in
 * localStorage under `key`. Dismissing stores `version`; a newer version
 * makes the flag false again so the notice comes back. Storage can be
 * unavailable (private mode, blocked site data) — then dismissal lasts only
 * for this page view.
 */
export function useVersionDismissal(key: string, version: string | null) {
  const [dismissedVersion, setDismissedVersion] = useState<string | null>(null)

  useEffect(() => {
    try {
      setDismissedVersion(window.localStorage.getItem(key))
    } catch {
      // storage unavailable — keep the in-memory default
    }
  }, [key])

  const dismiss = useCallback(() => {
    if (!version) return
    setDismissedVersion(version)
    try {
      window.localStorage.setItem(key, version)
    } catch {
      // storage unavailable — dismissal lasts for this page view
    }
  }, [key, version])

  return {
    dismissed: version !== null && dismissedVersion === version,
    dismiss,
  }
}
