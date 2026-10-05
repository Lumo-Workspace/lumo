import { auth } from '@clerk/nextjs/server'
import { getUserWorkspace } from '@/lib/auth'
import { IntegrationsPage } from '../../components/pages/IntegrationsPage'

export default async function IntegrationsSettingsPage({
  params,
}: {
  params: Promise<{ workspaceUrl: string }>
}) {
  const { workspaceUrl } = await params
  const { userId } = await auth()
  let isOwner = false
  if (userId) {
    // The page's own workspace, not the user's default (LUM-987).
    const ws = await getUserWorkspace(userId, workspaceUrl)
    isOwner = ws?.member.role === 'OWNER'
  }
  return <IntegrationsPage isOwner={isOwner} />
}
