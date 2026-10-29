import { getCurrentUserId, getUserWorkspace } from '@/lib/auth'
import { configuredRegistryIntegrations } from '@/lib/integrations/configured'
import { isFeatureEnabled } from '@/lib/features/is-enabled'
import type { IntegrationId } from '@/lib/integrations/registry'

/**
 * What the integrations pages (Workspace → Integrations and Personal →
 * Connected accounts, LUM-1339) need from the server: the viewer's role,
 * which integrations this deployment is configured for, and which are still
 * behind a rollout flag.
 */
export async function loadIntegrationsProps(workspaceUrl: string): Promise<{
  isOwner: boolean
  configured: Record<IntegrationId, boolean>
  unreleased: IntegrationId[]
}> {
  const userId = await getCurrentUserId()
  let isOwner = false
  let workspaceId: string | null = null
  if (userId) {
    // The page's own workspace, not the user's default (LUM-987).
    const ws = await getUserWorkspace(userId, workspaceUrl)
    isOwner = ws?.member.role === 'OWNER'
    workspaceId = ws?.workspaceId ?? null
  }
  // LUM-1315: a card behind a rollout flag is decided here, on the server.
  const unreleased: IntegrationId[] = isFeatureEnabled(
    'codeup-integration',
    workspaceId
  )
    ? []
    : ['codeup']
  // LUM-1025: which integrations this deployment has credentials for — read
  // here, on the server, so no env reaches the client bundle.
  return { isOwner, configured: configuredRegistryIntegrations(), unreleased }
}
