import { prisma } from '@/lib/db/prisma'
import { teamRepository } from '@/lib/repositories/team.repository'
import type { Identity } from './identity'

/**
 * Who is calling: the human (`clerkId`) AND the workspace their credential is
 * scoped to (`workspaceId` — the Bearer key's workspace, or the Clerk
 * session's active workspace). Pass the route's `Identity` straight through.
 */
export type TeamAccessCaller = Pick<Identity, 'clerkId' | 'workspaceId'>

/** The team-scoped resource being accessed, as stored. */
export interface TeamScopedResource {
  workspaceId: string
  teamId: string
}

/**
 * Verify that `caller` may access `resource.teamId`.
 *
 * Denies with 404 (`notFoundMessage`) when the resource lives in a workspace
 * other than the caller's credential workspace — even if the same human is a
 * member there (LUM-985). 404, not 403, so the response doesn't confirm the
 * id exists in another workspace; callers that 404 on a missing resource
 * should pass the same message they use for that case.
 *
 * Within the caller's workspace, passes if the caller is:
 *   - an OWNER of the workspace (full access to all teams), or
 *   - an explicit TeamMember of the given team.
 *
 * Throws a 403 error otherwise.
 */
export async function requireTeamMemberOrOwner(
  caller: TeamAccessCaller,
  resource: TeamScopedResource,
  notFoundMessage = 'Not found'
): Promise<{ memberId: string; reason: 'owner' | 'team' }> {
  if (resource.workspaceId !== caller.workspaceId) {
    throw Object.assign(new Error(notFoundMessage), { status: 404 })
  }
  const member = await prisma.workspaceMember.findUnique({
    where: {
      workspaceId_clerkId: {
        workspaceId: caller.workspaceId,
        clerkId: caller.clerkId,
      },
    },
    select: { id: true, role: true },
  })
  if (!member) {
    throw Object.assign(new Error('not a workspace member'), { status: 403 })
  }
  if (member.role === 'OWNER') {
    return { memberId: member.id, reason: 'owner' }
  }
  const tm = await prisma.teamMember.findUnique({
    where: {
      teamId_memberId: { teamId: resource.teamId, memberId: member.id },
    },
    select: { id: true },
  })
  if (!tm) {
    throw Object.assign(new Error('not a team member'), { status: 403 })
  }
  return { memberId: member.id, reason: 'team' }
}

/**
 * Convenience wrapper for the common case where a route knows `teamId` but
 * not its workspace. Looks up the team's workspace and then performs the
 * same scope + OWNER-or-team-member check. Throws 404 when the team doesn't
 * exist or belongs to another workspace than the caller's credential, 403
 * when the caller can't access it.
 *
 * Returns `workspaceId` so the route doesn't need a second roundtrip when
 * it needs to fan out to workspace-scoped APIs (Pusher events, etc.).
 */
export async function requireTeamAccessById(
  teamId: string,
  caller: TeamAccessCaller
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
    caller,
    { workspaceId: team.workspaceId, teamId: team.id },
    'Team not found'
  )
  return { memberId, workspaceId: team.workspaceId, reason }
}
