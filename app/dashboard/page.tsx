import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import DashboardApp from './DashboardApp'

export default async function DashboardPage() {
  const { userId } = await auth()

  if (!userId) {
    redirect('/signin')
  }

  return <DashboardApp />
}
