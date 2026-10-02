'use client'

import { useEffect, useState } from 'react'
import { IntlProviderWrapper } from '@/lib/i18n/IntlProviderWrapper'
import { usePreferences } from '@/app/workspace/[workspaceUrl]/hooks/usePreferences'

/**
 * Locale boundary for /sessions: same preferences-driven locale as the
 * workspace shell, without the projects store.
 */
export function SessionsIntl({ children }: { children: React.ReactNode }) {
  const { prefs } = usePreferences()
  const [mounted, setMounted] = useState(false)

  useEffect(() => setMounted(true), [])

  // Default locale during SSR/hydration to avoid a mismatch, then the
  // user's preferred locale after mount.
  const locale = mounted ? prefs.locale : 'en'

  return <IntlProviderWrapper locale={locale}>{children}</IntlProviderWrapper>
}
