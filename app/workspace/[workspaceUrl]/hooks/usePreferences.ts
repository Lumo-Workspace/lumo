import { useState, useEffect, useCallback, useRef } from 'react'
import { useTheme } from 'next-themes'
import { apiFetch } from '../utils'
import { CACHE_KEY } from '../constants'
import { toast } from 'sonner'

export interface Preferences {
  theme: 'light' | 'dark' | 'system'
  locale: 'en' | 'zh'
  timezone: string
  notifyInAppAssigned: boolean
  notifyInAppComment: boolean
  notifyInAppAgentDone: boolean
  notifyInAppAgentInput: boolean
  notifyInAppMention: boolean
  notifySlackAssigned: boolean
  notifySlackComment: boolean
  notifySlackAgentDone: boolean
  notifySlackAgentInput: boolean
  notifySlackMention: boolean
}

const DEFAULTS: Preferences = {
  theme: 'system',
  locale: 'en',
  timezone: 'auto',
  notifyInAppAssigned: true,
  notifyInAppComment: true,
  notifyInAppAgentDone: true,
  notifyInAppAgentInput: true,
  notifyInAppMention: true,
  notifySlackAssigned: true,
  notifySlackComment: true,
  notifySlackAgentDone: true,
  notifySlackAgentInput: true,
  notifySlackMention: true,
}

function loadCache(): Preferences {
  if (typeof window === 'undefined') return DEFAULTS
  try {
    const raw = localStorage.getItem(CACHE_KEY.preferences)
    if (!raw) return DEFAULTS
    return { ...DEFAULTS, ...JSON.parse(raw) }
  } catch {
    return DEFAULTS
  }
}

function saveCache(prefs: Preferences): void {
  try {
    localStorage.setItem(CACHE_KEY.preferences, JSON.stringify(prefs))
  } catch {
    // localStorage may be full — non-critical
  }
}

export function usePreferences() {
  const [prefs, setPrefs] = useState<Preferences>(loadCache)
  const [loading, setLoading] = useState(true)
  const { setTheme } = useTheme()
  const mountedRef = useRef(true)

  // Fetch from API on mount, update cache if different
  useEffect(() => {
    mountedRef.current = true
    let cancelled = false

    async function fetchPrefs() {
      try {
        const res = await apiFetch('/api/users/preferences')
        if (!res.ok) return
        const data = (await res.json()) as Preferences
        if (cancelled) return
        setPrefs(data)
        saveCache(data)
        setTheme(data.theme)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    fetchPrefs()
    return () => {
      cancelled = true
      mountedRef.current = false
    }
  }, [setTheme])

  // Apply theme whenever prefs.theme changes
  useEffect(() => {
    setTheme(prefs.theme)
  }, [prefs.theme, setTheme])

  // Optimistic update: change local state + cache immediately, PATCH in background
  const updatePreferences = useCallback(
    async (patch: Partial<Preferences>) => {
      const prev = prefs
      const next = { ...prev, ...patch }
      setPrefs(next)
      saveCache(next)

      try {
        const res = await apiFetch('/api/users/preferences', {
          method: 'PATCH',
          body: patch,
        })
        if (!res.ok) {
          const data = await res.json().catch(() => ({}))
          throw new Error((data as { error?: string }).error ?? 'Save failed')
        }
      } catch (err) {
        // Revert on failure
        setPrefs(prev)
        saveCache(prev)
        toast.error(
          err instanceof Error ? err.message : 'Failed to save preference'
        )
      }
    },
    [prefs]
  )

  return { prefs, loading, updatePreferences }
}
