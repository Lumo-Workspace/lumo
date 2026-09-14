'use client'

import { useParams } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api-client'
import { queryKeys } from '@/lib/query/keys'
import { API } from '../constants'

/** Integrations that are workspace assets a surface can consume rather than
 * re-connect. */
export type WorkspaceIntegration = 'slack' | 'figma' | 'github'

interface IntegrationStatusResponse {
  connected: boolean
}

/** The App installation reports `installed`, not `connected`. */
interface AppInstallationResponse {
  installed: boolean
}

const ENDPOINT: Record<WorkspaceIntegration, (workspaceUrl: string) => string> =
  {
    slack: workspaceUrl => API.slack.integration(workspaceUrl),
    figma: workspaceUrl => API.figma.integration(workspaceUrl),
    // "GitHub connected" for a feature surface means the workspace can reach
    // repositories — that is the team App installation, not a member's
    // personal OAuth link (which is identity only).
    github: workspaceUrl => API.github.appInstallation(workspaceUrl),
  }

const QUERY_KEY: Record<
  WorkspaceIntegration,
  (workspaceUrl: string) => readonly unknown[]
> = {
  slack: queryKeys.integrations.slack,
  figma: queryKeys.integrations.figma,
  github: queryKeys.integrations.githubApp,
}

export interface IntegrationConnection {
  /** `undefined` until the read resolves, and after a failed read. Callers must
   * gate on `connected === false`, never on falsiness: treating "not known yet"
   * as "not connected" is exactly the LUM-684 bug. */
  connected: boolean | undefined
  loading: boolean
  /** Where to send someone whose workspace genuinely lacks the integration —
   * connecting is a workspace-settings act, not something a feature surface
   * re-implements inline. */
  integrationsHref: string
}

/**
 * Read whether the workspace already has an integration connected, from the
 * same endpoint and React Query key the integrations settings page uses — so a
 * connection made there is immediately visible here off the shared cache
 * (LUM-684).
 *
 * Deliberately read-only: unlike `useSlackIntegration` / `useGitHubIntegration`
 * this carries no OAuth-callback effects, toasts, or disconnect mutation, so a
 * surface that merely wants to know "is it connected?" can ask without
 * inheriting connect/disconnect machinery.
 */
export function useIntegrationConnected(
  integration: WorkspaceIntegration
): IntegrationConnection {
  const { workspaceUrl } = useParams<{ workspaceUrl: string }>()

  const query = useQuery<IntegrationStatusResponse>({
    queryKey: QUERY_KEY[integration](workspaceUrl),
    queryFn: async () => {
      const url = ENDPOINT[integration](workspaceUrl)
      if (integration === 'github') {
        const app = await apiFetch<AppInstallationResponse>(url)
        return { connected: app.installed }
      }
      return apiFetch<IntegrationStatusResponse>(url)
    },
    // staleTime is deliberately left to the app default (30s) so this shares
    // the settings page's freshness exactly. A longer window would pin a stale
    // `connected: false` after a connect — refetchOnWindowFocus is off app-wide
    // and the GitHub OAuth hop opens in a new tab without invalidating.
  })

  return {
    connected: query.data?.connected,
    loading: query.isLoading,
    integrationsHref: `/workspace/${workspaceUrl}/settings/integrations`,
  }
}
