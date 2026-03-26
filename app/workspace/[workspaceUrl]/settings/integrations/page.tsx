import { auth } from '@clerk/nextjs/server'
import { getUserWorkspace } from '@/lib/auth'
import { IntegrationsPage } from '../../components/pages/IntegrationsPage'

export default async function IntegrationsSettingsPage() {
  const { userId } = await auth()
  let isOwner = false
  if (userId) {
    const ws = await getUserWorkspace(userId)
    isOwner = ws?.member.role === 'OWNER'
  }
  return <IntegrationsPage isOwner={isOwner} />
}
