import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { getUserWorkspace } from '@/lib/auth'
import DashboardApp from './DashboardApp'

export default async function DashboardPage() {
  const { userId } = await auth()

  if (!userId) {
    redirect('/signin')
  }

  const ws = await getUserWorkspace(userId)
  if (!ws) {
    redirect('/onboarding')
  }

  return <DashboardApp />
}
