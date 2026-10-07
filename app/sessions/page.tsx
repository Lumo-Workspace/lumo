import { getCurrentUserId } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { sessionListService } from '@/lib/services/session-list.service'
import { SessionsList } from './SessionsList'

export const dynamic = 'force-dynamic'

export default async function SessionsPage() {
  const userId = await getCurrentUserId()
  if (!userId) redirect('/signin')

  const rows = await sessionListService.listForUser(userId)

  return <SessionsList rows={rows} />
}
