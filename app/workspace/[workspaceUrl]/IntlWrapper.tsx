'use client'

import { useEffect, useState } from 'react'
import { IntlProviderWrapper } from '@/lib/i18n/IntlProviderWrapper'
import { usePreferences } from './hooks/usePreferences'
import { ProjectsProvider } from './hooks/ProjectsProvider'

/**
 * Client-side boundary for the workspace route tree. Composes the shared
 * client providers every shell needs — i18n and the projects store — so
 * consumers (WorkspaceApp, TaskDetailPage, ProjectDetailStandalonePage,
 * SprintDetailClient, AppSidebar) all read the same projects state.
 */
export function IntlWrapper({ children }: { children: React.ReactNode }) {
  const { prefs } = usePreferences()
  const [mounted, setMounted] = useState(false)

  useEffect(() => setMounted(true), [])

  // Use default locale during SSR/hydration to avoid mismatch,
  // then switch to user's preferred locale after mount.
  const locale = mounted ? prefs.locale : 'en'

  return (
    <IntlProviderWrapper locale={locale}>
      <ProjectsProvider>{children}</ProjectsProvider>
    </IntlProviderWrapper>
  )
}
