'use client'

import { useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTheme } from 'next-themes'
import { toast } from 'sonner'
import { apiFetch } from '@/lib/api-client'
import { CACHE_KEY } from '../constants'
import { queryKeys } from '@/lib/query/keys'
import type { SupportedLocale } from '@/lib/i18n/locales'

export interface Preferences {
  theme: 'light' | 'dark' | 'system'
  locale: SupportedLocale
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

function loadFromStorage(): Preferences {
  if (typeof window === 'undefined') return DEFAULTS
  try {
    const raw = localStorage.getItem(CACHE_KEY.preferences)
    if (!raw) return DEFAULTS
    return { ...DEFAULTS, ...JSON.parse(raw) }
  } catch {
    return DEFAULTS
  }
}

function writeToStorage(prefs: Preferences): void {
  try {
    localStorage.setItem(CACHE_KEY.preferences, JSON.stringify(prefs))
  } catch {
    // quota exceeded — non-critical
  }
}

export function usePreferences() {
  const queryClient = useQueryClient()
  const queryKey = queryKeys.preferences()
  const { setTheme } = useTheme()

  const query = useQuery<Preferences>({
    queryKey,
    queryFn: async () => {
      const data = await apiFetch<Preferences>('/api/users/preferences')
      writeToStorage(data)
      return data
    },
    initialData: loadFromStorage,
    // The localStorage seed may be stale, so mark it as fetched-at-epoch: the
    // first mount always refetches to freshen. A long staleTime then dedupes
    // redundant refetches — preferences change rarely, and the cache is kept
    // live by optimistic mutation writes plus the cross-tab `storage` sync
    // below, so revisiting settings pages needn't hit the network each time.
    initialDataUpdatedAt: 0,
    staleTime: 5 * 60_000,
  })

  // Cross-tab sync — when another tab writes to localStorage, broadcast that
  // payload into the query cache so all useQuery subscribers re-render.
  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key !== CACHE_KEY.preferences || !e.newValue) return
      try {
        const next = { ...DEFAULTS, ...JSON.parse(e.newValue) } as Preferences
        queryClient.setQueryData<Preferences>(queryKey, next)
      } catch {
        // malformed JSON — ignore
      }
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
    // queryKey is a tuple constructed fresh each render; we depend on
    // queryClient instead, which is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryClient])

  // One-time migration from the legacy `lumo:darkMode` localStorage key.
  // Mounted as an effect so it only runs once per app session.
  useEffect(() => {
    const oldDarkMode = localStorage.getItem('lumo:darkMode')
    if (oldDarkMode === null) return
    localStorage.removeItem('lumo:darkMode')
    const migrated: Preferences['theme'] =
      oldDarkMode === 'true' ? 'dark' : 'light'
    queryClient.setQueryData<Preferences>(queryKey, prev =>
      prev ? { ...prev, theme: migrated } : { ...DEFAULTS, theme: migrated }
    )
    writeToStorage({ ...(query.data ?? DEFAULTS), theme: migrated })
    apiFetch('/api/users/preferences', {
      method: 'PATCH',
      body: { theme: migrated },
    }).catch(() => {})
    // Run on mount only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Apply theme whenever prefs.theme changes.
  useEffect(() => {
    if (query.data?.theme) setTheme(query.data.theme)
  }, [query.data?.theme, setTheme])

  const updateMutation = useMutation<
    void,
    Error,
    Partial<Preferences>,
    { prev: Preferences | undefined }
  >({
    mutationFn: patch =>
      apiFetch<void>('/api/users/preferences', {
        method: 'PATCH',
        body: patch,
      }),
    onMutate: async patch => {
      await queryClient.cancelQueries({ queryKey })
      const prev = queryClient.getQueryData<Preferences>(queryKey)
      if (prev) {
        const next = { ...prev, ...patch }
        queryClient.setQueryData<Preferences>(queryKey, next)
        writeToStorage(next)
      }
      return { prev }
    },
    onError: (err, _patch, context) => {
      if (context?.prev) {
        queryClient.setQueryData<Preferences>(queryKey, context.prev)
        writeToStorage(context.prev)
      }
      toast.error(
        err instanceof Error ? err.message : 'Failed to save preference'
      )
    },
  })

  const updatePreferences = async (patch: Partial<Preferences>) => {
    await updateMutation.mutateAsync(patch)
  }

  return {
    prefs: query.data ?? DEFAULTS,
    loading: query.isLoading,
    updatePreferences,
  }
}
