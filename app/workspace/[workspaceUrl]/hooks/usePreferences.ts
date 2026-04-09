import { useState, useEffect, useCallback, useRef } from 'react'
import { useTheme } from 'next-themes'
import { apiFetch } from '@/lib/api-client'
import { CACHE_KEY } from '../constants'
import { toast } from 'sonner'

export interface Preferences {
  theme: 'light' | 'dark' | 'system'
  locale:
    | 'en'
    | 'zh-CN'
    | 'zh-TW'
    | 'en-GB'
    | 'en-AU'
    | 'es-ES'
    | 'es-419'
    | 'fr'
    | 'de'
    | 'ja'
    | 'ko'
    | 'hi'
    | 'ru'
    | 'vi'
    | 'id'
    | 'ms'
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

const PREFS_CHANGED_EVENT = 'lumo:preferences-changed'

function saveCache(prefs: Preferences): void {
  try {
    localStorage.setItem(CACHE_KEY.preferences, JSON.stringify(prefs))
    // Notify other hook instances in the same tab
    window.dispatchEvent(
      new CustomEvent(PREFS_CHANGED_EVENT, { detail: prefs })
    )
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

    // One-time migration from old darkMode localStorage key
    const oldDarkMode = localStorage.getItem('lumo:darkMode')
    if (oldDarkMode !== null) {
      localStorage.removeItem('lumo:darkMode')
      const migrated = oldDarkMode === 'true' ? 'dark' : 'light'
      setPrefs(prev => {
        const next = { ...prev, theme: migrated as Preferences['theme'] }
        saveCache(next)
        return next
      })
      setTheme(migrated)
      // Fire-and-forget API update
      apiFetch('/api/users/preferences', {
        method: 'PATCH',
        body: { theme: migrated },
      }).catch(() => {})
    }

    async function fetchPrefs() {
      try {
        const data = await apiFetch<Preferences>('/api/users/preferences')
        if (cancelled) return
        setPrefs(data)
        saveCache(data)
        setTheme(data.theme)
      } catch {
        // Failed to load preferences — keep defaults
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

  // Sync across hook instances (same tab via custom event, cross tab via storage)
  useEffect(() => {
    function apply(updated: Preferences) {
      setPrefs(updated)
      setTheme(updated.theme)
    }
    function onCustom(e: Event) {
      const prefs = (e as CustomEvent<Preferences>).detail
      if (prefs) apply(prefs)
    }
    function onStorage(e: StorageEvent) {
      if (e.key !== CACHE_KEY.preferences || !e.newValue) return
      try {
        apply({ ...DEFAULTS, ...JSON.parse(e.newValue) } as Preferences)
      } catch {
        // malformed JSON — ignore
      }
    }
    window.addEventListener(PREFS_CHANGED_EVENT, onCustom)
    window.addEventListener('storage', onStorage)
    return () => {
      window.removeEventListener(PREFS_CHANGED_EVENT, onCustom)
      window.removeEventListener('storage', onStorage)
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
        await apiFetch<void>('/api/users/preferences', {
          method: 'PATCH',
          body: patch,
        })
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
