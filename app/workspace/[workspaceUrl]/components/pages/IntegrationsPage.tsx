'use client'

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useParams } from 'next/navigation'
import { toast } from 'sonner'
import { useIntl } from 'react-intl'
import {
  INTEGRATIONS,
  type IntegrationId,
  type IntegrationKind,
} from '@/lib/integrations/registry'
import { GitHubIntegrationCard } from '../GitHubIntegrationCard'
import { SlackIntegrationCard } from '../SlackIntegrationCard'
import { SentryIntegrationCard } from '../SentryIntegrationCard'
import { FigmaIntegrationCard } from '../FigmaIntegrationCard'
import { GoogleDriveIntegrationCard } from '../GoogleDriveIntegrationCard'

// Sections render top-to-bottom in this fixed order. Integrations within a
// section follow the registry's declaration order, then connected cards float
// to the top via CSS `order` (see the per-card wrapper below).
const KIND_ORDER: readonly IntegrationKind[] = ['TEAM', 'PERSONAL']

// Maps a kind to the i18n key prefix for its section header copy.
const SECTION_KEY: Record<IntegrationKind, string> = {
  TEAM: 'team',
  PERSONAL: 'personal',
}

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

  // Each integration owns its card markup (the cards take heterogeneous props
  // and self-title via their own i18n keys); the registry only decides which
  // section a card lands in.
  const cards: Record<IntegrationId, ReactNode> = {
    github: (
      <GitHubIntegrationCard
        workspaceUrl={workspaceUrl}
        isOwner={isOwner}
        onConnectedChange={reporters.github}
      />
    ),
    slack: (
      <SlackIntegrationCard
        isOwner={isOwner}
        onConnectedChange={reporters.slack}
      />
    ),
    sentry: (
      <SentryIntegrationCard
        isOwner={isOwner}
        onConnectedChange={reporters.sentry}
      />
    ),
    figma: <FigmaIntegrationCard onConnectedChange={reporters.figma} />,
    googleDrive: (
      <GoogleDriveIntegrationCard onConnectedChange={reporters.googleDrive} />
    ),
  }

  // Group integration ids by kind from the registry (single source of truth).
  const idsByKind = useMemo(() => {
    const groups: Record<IntegrationKind, IntegrationId[]> = {
      TEAM: [],
      PERSONAL: [],
    }
    for (const { id, kind } of Object.values(INTEGRATIONS)) {
      groups[kind].push(id)
    }
    return groups
  }, [])

  return (
    <div className='h-full overflow-y-auto'>
      <div className='max-w-2xl mx-auto px-8 py-10'>
        <h1 className='text-xl font-semibold text-zinc-900 dark:text-zinc-100 mb-1'>
          {intl.formatMessage({ id: 'integrations.title' })}
        </h1>
        <p className='text-sm text-zinc-500 dark:text-zinc-400 mb-8'>
          {intl.formatMessage({ id: 'integrations.description' })}
        </p>

        <div className='flex flex-col gap-10'>
          {KIND_ORDER.map(kind => {
            const ids = idsByKind[kind]
            if (ids.length === 0) return null
            const section = SECTION_KEY[kind]
            return (
              <section key={kind}>
                <h2 className='text-sm font-medium text-foreground mb-1'>
                  {intl.formatMessage({ id: `integrations.${section}.title` })}
                </h2>
                <p className='text-sm text-muted-foreground mb-4'>
                  {intl.formatMessage({
                    id: `integrations.${section}.description`,
                  })}
                </p>
                <div className='flex flex-col gap-4'>
                  {ids.map((id, index) => (
                    <div
                      key={id}
                      style={{ order: (connectedMap[id] ? 0 : 100) + index }}
                    >
                      {cards[id]}
                    </div>
                  ))}
                </div>
              </section>
            )
          })}
        </div>
      </div>
    </div>
  )
}
