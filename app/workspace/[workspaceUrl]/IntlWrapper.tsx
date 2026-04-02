'use client'

import { useEffect, useState } from 'react'
import { IntlProviderWrapper } from '@/lib/i18n/IntlProviderWrapper'
import { usePreferences } from './hooks/usePreferences'

export function IntlWrapper({ children }: { children: React.ReactNode }) {
  const { prefs } = usePreferences()
  const [mounted, setMounted] = useState(false)

  useEffect(() => setMounted(true), [])

  // Use default locale during SSR/hydration to avoid mismatch,
  // then switch to user's preferred locale after mount.
  const locale = mounted ? prefs.locale : 'en'

  return <IntlProviderWrapper locale={locale}>{children}</IntlProviderWrapper>
}
