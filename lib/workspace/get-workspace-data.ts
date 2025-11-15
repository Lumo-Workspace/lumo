import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth/config'
import { prisma } from '@/lib/db/prisma'

interface WorkspaceData {
  team: {
    id: string
    name: string
    workspaceUrl: string
  }
  membership: {
    id: string
    role: string
  }
  user: {
    id: string
    workspaceUrl: string | null
  }
}

/**
 * Server-side function to get workspace data with authentication and authorization checks
 * Follows Next.js 16 patterns for Server Components
 */
export async function getWorkspaceData(
  workspaceUrl: string
): Promise<WorkspaceData> {
  const session = await getServerSession(authOptions)

  // Require auth
  if (!session?.user) {
    redirect('/login')
  }

  if (!workspaceUrl) {
    redirect('/workspace')
  }

  // Verify workspace exists
  const team = await prisma.team.findUnique({ where: { workspaceUrl } })
  if (!team) {
    // Unknown slug → 404-like behaviour
    redirect('/workspace')
  }

  // Verify user membership
  const membership = await prisma.teamMember.findFirst({
    where: { teamId: team.id, userId: session.user.id },
  })

  if (!membership) {
    // Not authorized for this workspace; if user has a default workspace, send them there
    if (session.user.workspaceUrl) {
      redirect(`/workspace/${session.user.workspaceUrl}`)
    } else {
      redirect('/onboarding')
    }
  }

  return {
    team: {
      id: team.id,
      name: team.name,
      workspaceUrl: team.workspaceUrl,
    },
    membership: {
      id: membership.id,
      role: membership.role,
    },
    user: {
      id: session.user.id,
      workspaceUrl: session.user.workspaceUrl || null,
    },
  }
}
