import { redirect } from 'next/navigation'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth/config'
import MarkdownEditor from '@/components/core/editor/markdown/MarkdownEditor'

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

  // If workspace slug is available, redirect to workspace-specific app URL
  if (session.user.workspaceUrl) {
    redirect(`/app/${session.user.workspaceUrl}`)
  }

  return (
    <div className='min-h-screen bg-white'>
      <MarkdownEditor />
    </div>
  )
}
