'use client'

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useParams } from 'next/navigation'
import { toast } from 'sonner'
import { useIntl } from 'react-intl'
import {
  INTEGRATIONS,
  getIntegrationKind,
  type IntegrationId,
  type IntegrationKind,
} from '@/lib/integrations/registry'
import { GitHubIntegrationCard } from '../GitHubIntegrationCard'
import { GitHubAccountCard } from '../GitHubAccountCard'
import { SlackIntegrationCard } from '../SlackIntegrationCard'
import { SentryIntegrationCard } from '../SentryIntegrationCard'
import { FigmaIntegrationCard } from '../FigmaIntegrationCard'
import { GoogleDriveIntegrationCard } from '../GoogleDriveIntegrationCard'

// Sections render top-to-bottom in this fixed order. Within a section, cards
// are ordered by connection status first (connected on top) then alphabetically
// by display name — both expressed via CSS `order` (see the per-card wrapper).
const KIND_ORDER: readonly IntegrationKind[] = ['TEAM', 'PERSONAL']

// Maps a kind to the i18n key prefix for its section header copy.
const SECTION_KEY: Record<IntegrationKind, string> = {
  TEAM: 'team',
  PERSONAL: 'personal',
}

interface IntegrationsPageProps {
  isOwner: boolean
  /**
   * LUM-1025 — whether this deployment has the env an integration needs. An
   * unconfigured card is not rendered at all (it would only fetch a status
   * nobody can change); the page names it once as not available instead.
   */
  configured: Record<IntegrationId, boolean>
}

export function IntegrationsPage({
  isOwner,
  configured,
}: IntegrationsPageProps) {
  const intl = useIntl()
  const { workspaceUrl } = useParams<{ workspaceUrl: string }>()

  const [connectedMap, setConnectedMap] = useState<Record<string, boolean>>({})

  const reporters = useMemo(
    () => ({
      github: (c: boolean) =>
        setConnectedMap(p => (p.github === c ? p : { ...p, github: c })),
      githubAccount: (c: boolean) =>
        setConnectedMap(p =>
          p.githubAccount === c ? p : { ...p, githubAccount: c }
        ),
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
    // Handle redirects from the two GitHub callbacks: the OAuth callback
    // (`github_error`) and the App installation callback (`github_app` /
    // `github_app_error`). A failed install must say so — silently landing back
    // on an unchanged card is how a workspace ends up believing it is scanned.
    const params = new URLSearchParams(window.location.search)
    const appError = params.get('github_app_error')
    const appResult = params.get('github_app')

    if (params.get('github_error')) {
      toast.error(intl.formatMessage({ id: 'github.connectFailed' }))
    } else if (appError === 'not_configured') {
      toast.error(intl.formatMessage({ id: 'github.installNotConfigured' }))
    } else if (appError === 'verify_not_configured') {
      toast.error(
        intl.formatMessage({ id: 'github.installVerifyNotConfigured' })
      )
    } else if (appError === 'not_authorized') {
      toast.error(intl.formatMessage({ id: 'github.installNotAuthorized' }))
    } else if (appError === 'repo_access_incomplete') {
      toast.error(
        intl.formatMessage({ id: 'github.installRepoAccessIncomplete' })
      )
    } else if (appError === 'too_many_repositories') {
      toast.error(
        intl.formatMessage({ id: 'github.installTooManyRepositories' })
      )
    } else if (appError === 'not_owner') {
      toast.error(intl.formatMessage({ id: 'github.reverifyNotOwner' }))
    } else if (appError === 'reverify_failed') {
      toast.error(intl.formatMessage({ id: 'github.reverifyFailed' }))
    } else if (appError) {
      toast.error(intl.formatMessage({ id: 'github.installFailed' }))
    } else if (appResult === 'reverified') {
      toast.success(intl.formatMessage({ id: 'github.reverifySuccess' }))
    } else if (appResult === 'installed') {
      toast.success(intl.formatMessage({ id: 'github.installSuccess' }))
    } else if (appResult === 'requested') {
      toast.info(intl.formatMessage({ id: 'github.installRequested' }))
    } else {
      return
    }

    window.history.replaceState({}, '', window.location.pathname)
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
    githubAccount: (
      <GitHubAccountCard onConnectedChange={reporters.githubAccount} />
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

  // Alphabetical rank of each card within its section, keyed by localized
  // display name (`<id>.title`). This is the within-section tiebreaker; the
  // connected-first float is layered on top via the `order` offset below.
  const alphaRank = useMemo(() => {
    const rank: Partial<Record<IntegrationId, number>> = {}
    for (const kind of KIND_ORDER) {
      const sorted = [...idsByKind[kind]].sort((a, b) =>
        intl
          .formatMessage({ id: `${a}.title` })
          .localeCompare(intl.formatMessage({ id: `${b}.title` }), intl.locale)
      )
      sorted.forEach((id, i) => {
        rank[id] = i
      })
    }
    return rank
  }, [idsByKind, intl])

  // TEAM cards are view-only and hidden from non-owners until they report
  // connected; owners and PERSONAL cards are always visible. Recomputed each
  // render because it reads the live connectedMap.
  const isCardVisible = (id: IntegrationId) =>
    isOwner || getIntegrationKind(id) !== 'TEAM' || connectedMap[id] === true

  const unavailableNames = (Object.keys(cards) as IntegrationId[])
    .filter(id => !configured[id])
    .map(id => intl.formatMessage({ id: `${id}.title` }))
    .sort((a, b) => a.localeCompare(b, intl.locale))

  return (
    <div className='h-full overflow-y-auto'>
      <div className='max-w-2xl mx-auto px-8 py-10'>
        <h1 className='text-xl font-semibold text-foreground mb-1'>
          {intl.formatMessage({ id: 'integrations.title' })}
        </h1>
        <p className='text-sm text-muted-foreground mb-8'>
          {intl.formatMessage({ id: 'integrations.description' })}
        </p>

        <div className='flex flex-col gap-10'>
          {KIND_ORDER.map(kind => {
            const ids = idsByKind[kind].filter(id => configured[id])
            if (ids.length === 0) return null
            const section = SECTION_KEY[kind]
            const sectionVisible = ids.some(id => isCardVisible(id))
            return (
              <section key={kind} hidden={!sectionVisible}>
                <h2 className='text-sm font-medium text-foreground mb-1'>
                  {intl.formatMessage({ id: `integrations.${section}.title` })}
                </h2>
                <p className='text-sm text-muted-foreground mb-4'>
                  {intl.formatMessage({
                    id: `integrations.${section}.description`,
                  })}
                </p>
                <div className='flex flex-col gap-4'>
                  {ids.map(id => (
                    <div
                      key={id}
                      hidden={!isCardVisible(id)}
                      style={{
                        order:
                          (connectedMap[id] ? 0 : 100) + (alphaRank[id] ?? 0),
                      }}
                    >
                      {cards[id]}
                    </div>
                  ))}
                </div>
              </section>
            )
          })}
        </div>

        {unavailableNames.length > 0 && (
          <p className='text-xs text-muted-foreground mt-10'>
            {intl.formatMessage(
              { id: 'integrations.notAvailable' },
              {
                names: intl.formatList(unavailableNames, {
                  type: 'conjunction',
                }),
              }
            )}
          </p>
        )}
      </div>
    </div>
  )
}
