import { auth } from '@clerk/nextjs/server'
import { getUserWorkspace } from '@/lib/auth'
import { FigmaSettingsPage } from '../../../components/pages/FigmaSettingsPage'

export default async function FigmaIntegrationSettingsPage() {
  const { userId } = await auth()
  let isOwner = false
  if (userId) {
    const ws = await getUserWorkspace(userId)
    isOwner = ws?.member.role === 'OWNER'
  }
  return <FigmaSettingsPage isOwner={isOwner} />
}
