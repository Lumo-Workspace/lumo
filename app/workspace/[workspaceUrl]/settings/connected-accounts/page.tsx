import { IntegrationsPage } from '../../components/pages/IntegrationsPage'
import { loadIntegrationsProps } from '../integrations/load-integrations-props'

/** LUM-1339 — the integrations each member connects for themselves. */
export default async function ConnectedAccountsSettingsPage({
  params,
}: {
  params: Promise<{ workspaceUrl: string }>
}) {
  const { workspaceUrl } = await params
  const props = await loadIntegrationsProps(workspaceUrl)
  return <IntegrationsPage kind='PERSONAL' {...props} />
}
