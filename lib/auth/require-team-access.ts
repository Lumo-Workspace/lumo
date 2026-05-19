import { prisma } from '@/lib/db/prisma'
import { teamRepository } from '@/lib/repositories/team.repository'

/**
 * Verify that `clerkId` may access `teamId` within `workspaceId`.
 *
 * Passes if the caller is:
 *   - an OWNER of the workspace (full access to all teams), or
 *   - an explicit TeamMember of the given team.
 *
 * Throws a 403 error otherwise.
 */
export async function requireTeamMemberOrOwner(
  workspaceId: string,
  teamId: string,
  clerkId: string
): Promise<{ memberId: string; reason: 'owner' | 'team' }> {
  const member = await prisma.workspaceMember.findUnique({
    where: { workspaceId_clerkId: { workspaceId, clerkId } },
    select: { id: true, role: true },
  })
  if (!member) {
    throw Object.assign(new Error('not a workspace member'), { status: 403 })
  }
  if (member.role === 'OWNER') {
    return { memberId: member.id, reason: 'owner' }
  }
  const tm = await prisma.teamMember.findUnique({
    where: { teamId_memberId: { teamId, memberId: member.id } },
    select: { id: true },
  })
  if (!tm) {
    throw Object.assign(new Error('not a team member'), { status: 403 })
  }
  return { memberId: member.id, reason: 'team' }
}

/**
 * Convenience wrapper for the common case where a route knows `teamId` but
 * not `workspaceId`. Looks up the team's workspace and then performs the
 * same OWNER-or-team-member check. Throws 404 when the team doesn't exist,
 * 403 when the caller can't access it.
 *
 * Returns `workspaceId` so the route doesn't need a second roundtrip when
 * it needs to fan out to workspace-scoped APIs (Pusher events, etc.).
 */
export async function requireTeamAccessById(
  teamId: string,
  clerkId: string
): Promise<{
  memberId: string
  workspaceId: string
  reason: 'owner' | 'team'
}> {
  const team = await teamRepository.findWorkspaceId(teamId)
  if (!team) {
    throw Object.assign(new Error('Team not found'), { status: 404 })
  }
  const { memberId, reason } = await requireTeamMemberOrOwner(
    team.workspaceId,
    team.id,
    clerkId
  )
  return { memberId, workspaceId: team.workspaceId, reason }
}
