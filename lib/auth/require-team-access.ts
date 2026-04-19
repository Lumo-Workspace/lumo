import { prisma } from '@/lib/db/prisma'

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
