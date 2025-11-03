import { redirect } from 'next/navigation'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth/config'
import DemoWorkspace from '@/components/core/editor/demo-workspace/DemoWorkspace'

export default async function AppPage() {
  const session = await getServerSession(authOptions)

  // Check if user is authenticated
  if (!session?.user) {
    redirect('/login')
  }

  // Check if user has a team
  if (!session.user.teamId) {
    redirect('/onboarding')
  }

  // If workspace slug is available, redirect to workspace-specific URL
  if (session.user.workspaceUrl) {
    redirect(`/workspace/${session.user.workspaceUrl}`)
  }

  // Fallback: show demo workspace if no specific workspace URL
  return (
    <div className='min-h-screen bg-white'>
      <DemoWorkspace />
    </div>
  )
}
