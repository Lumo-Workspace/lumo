import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { requireUserWorkspace } from '@/lib/api/helpers'
import { teamRepository } from '@/lib/repositories/team.repository'

/**
 * GET /api/teams — List teams in the current user's workspace.
 *
 * Non-OWNERs see only teams they are a member of.
 * OWNERs see every team in the workspace (they can manage any team).
 */
export async function GET() {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { userId } = authResult

    const ws = await requireUserWorkspace(userId)
    if (ws instanceof NextResponse) return ws

    const teams = await teamRepository.listForMember(
      ws.workspaceId,
      ws.member.id,
      { isOwner: ws.member.role === 'OWNER' }
    )

    return NextResponse.json({ teams })
  } catch {
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}
