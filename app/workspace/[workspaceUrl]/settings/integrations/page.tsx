import { IntegrationsPage } from '../../components/pages/IntegrationsPage'
import { loadIntegrationsProps } from './load-integrations-props'

export default async function IntegrationsSettingsPage({
  params,
}: {
  params: Promise<{ workspaceUrl: string }>
}) {
  const { workspaceUrl } = await params
  const props = await loadIntegrationsProps(workspaceUrl)
  return <IntegrationsPage kind='TEAM' {...props} />
}
