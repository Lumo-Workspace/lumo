import { redirect } from 'next/navigation'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth/config'
import { prisma } from '@/lib/db/prisma'
import MarkdownEditor from '@/components/core/editor/markdown/MarkdownEditor'

// In Next.js 16 App Router, params is a Promise in server components
export default async function WorkspaceAppPage({
  params,
}: {
  params: Promise<{ workspaceUrl: string }>
}) {
  const { workspaceUrl } = await params
  const session = await getServerSession(authOptions)

  // Require auth
  if (!session?.user) {
    redirect('/login')
  }

  if (!workspaceUrl) {
    redirect('/app')
  }

  // Verify workspace exists
  const team = await prisma.team.findUnique({ where: { workspaceUrl } })
  if (!team) {
    // Unknown slug → 404-like behaviour
    redirect('/app')
  }

  // Verify user membership
  const membership = await prisma.teamMember.findFirst({
    where: { teamId: team.id, userId: session.user.id },
  })

  if (!membership) {
    // Not authorized for this workspace; if user has a default workspace, send them there
    if (session.user.workspaceUrl) {
      redirect(`/app/${session.user.workspaceUrl}`)
    } else {
      redirect('/onboarding')
    }
  }

  return (
    <div className='min-h-screen bg-white'>
      <MarkdownEditor />
    </div>
  )
}
