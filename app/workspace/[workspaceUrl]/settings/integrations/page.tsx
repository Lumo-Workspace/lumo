import { getCurrentUserId, getUserWorkspace } from '@/lib/auth'
import { configuredRegistryIntegrations } from '@/lib/integrations/configured'
import { isFeatureEnabled } from '@/lib/features/is-enabled'
import type { IntegrationId } from '@/lib/integrations/registry'
import { IntegrationsPage } from '../../components/pages/IntegrationsPage'

export default async function IntegrationsSettingsPage({
  params,
}: {
  params: Promise<{ workspaceUrl: string }>
}) {
  const { workspaceUrl } = await params
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
  return (
    <IntegrationsPage
      isOwner={isOwner}
      configured={configuredRegistryIntegrations()}
      unreleased={unreleased}
    />
  )
}
