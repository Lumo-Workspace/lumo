'use client'

import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import { toast } from 'sonner'
import { useIntl } from 'react-intl'
import { GitHubIntegrationCard } from '../GitHubIntegrationCard'
import { SlackIntegrationCard } from '../SlackIntegrationCard'
import { SentryIntegrationCard } from '../SentryIntegrationCard'
import { FigmaIntegrationCard } from '../FigmaIntegrationCard'
import { GoogleDriveIntegrationCard } from '../GoogleDriveIntegrationCard'

export function IntegrationsPage({ isOwner }: { isOwner: boolean }) {
  const intl = useIntl()
  const { workspaceUrl } = useParams<{ workspaceUrl: string }>()

  const [connectedMap, setConnectedMap] = useState<Record<string, boolean>>({})

  const reporters = useMemo(
    () => ({
      github: (c: boolean) =>
        setConnectedMap(p => (p.github === c ? p : { ...p, github: c })),
      slack: (c: boolean) =>
        setConnectedMap(p => (p.slack === c ? p : { ...p, slack: c })),
      sentry: (c: boolean) =>
        setConnectedMap(p => (p.sentry === c ? p : { ...p, sentry: c })),
      figma: (c: boolean) =>
        setConnectedMap(p => (p.figma === c ? p : { ...p, figma: c })),
      googleDrive: (c: boolean) =>
        setConnectedMap(p =>
          p.googleDrive === c ? p : { ...p, googleDrive: c }
        ),
    }),
    []
  )

  useEffect(() => {
    // Handle error redirect from OAuth callback
    const params = new URLSearchParams(window.location.search)
    if (params.get('github_error')) {
      toast.error(intl.formatMessage({ id: 'github.connectFailed' }))
      window.history.replaceState({}, '', window.location.pathname)
    }
  }, [intl])

  return (
    <div className='h-full overflow-y-auto'>
      <div className='max-w-2xl mx-auto px-8 py-10'>
        <h1 className='text-xl font-semibold text-zinc-900 dark:text-zinc-100 mb-1'>
          {intl.formatMessage({ id: 'integrations.title' })}
        </h1>
        <p className='text-sm text-zinc-500 dark:text-zinc-400 mb-8'>
          {intl.formatMessage({ id: 'integrations.description' })}
        </p>

        <div className='flex flex-col gap-4'>
          <div style={{ order: (connectedMap.github ? 0 : 100) + 0 }}>
            <GitHubIntegrationCard
              workspaceUrl={workspaceUrl}
              isOwner={isOwner}
              onConnectedChange={reporters.github}
            />
          </div>
          <div style={{ order: (connectedMap.slack ? 0 : 100) + 1 }}>
            <SlackIntegrationCard
              isOwner={isOwner}
              onConnectedChange={reporters.slack}
            />
          </div>
          <div style={{ order: (connectedMap.sentry ? 0 : 100) + 2 }}>
            <SentryIntegrationCard
              isOwner={isOwner}
              onConnectedChange={reporters.sentry}
            />
          </div>
          <div style={{ order: (connectedMap.figma ? 0 : 100) + 3 }}>
            <FigmaIntegrationCard onConnectedChange={reporters.figma} />
          </div>
          <div style={{ order: (connectedMap.googleDrive ? 0 : 100) + 4 }}>
            <GoogleDriveIntegrationCard
              onConnectedChange={reporters.googleDrive}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
