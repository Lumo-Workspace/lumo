import { NextRequest, NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { teamRepository } from '@/lib/repositories/team.repository'
import { miscRepository } from '@/lib/repositories/misc.repository'

/**
 * GET /api/teams — List teams in the current user's workspace.
 *
 * Non-OWNERs see only teams they are a member of.
 * OWNERs see every team in the workspace (they can manage any team).
 *
 * Accepts both Clerk sessions (browser) and bearer tokens (CLI).
 */
export async function GET(request: NextRequest) {
  try {
    const identity = await requireIdentity(request)
    if (identity instanceof NextResponse) return identity

    const role = await miscRepository.findMemberRoleById(identity.memberId)

    const teams = await teamRepository.listForMember(
      identity.workspaceId,
      identity.memberId,
      { isOwner: role === 'OWNER' }
    )

    return NextResponse.json({ teams })
  } catch {
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}
