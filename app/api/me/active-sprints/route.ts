import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { requireUserWorkspace } from '@/lib/api/helpers'
import { sprintRepository } from '@/lib/repositories'

/**
 * GET /api/me/active-sprints
 * Returns the IDs of all ACTIVE sprints for teams the current user belongs to,
 * within the caller's current workspace.
 *
 * Response: { sprintIds: string[] }
 */
export async function GET() {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { userId } = authResult

    const ws = await requireUserWorkspace(userId)
    if (ws instanceof NextResponse) return ws

    const sprintIds = await sprintRepository.findActiveIdsForMember(
      ws.member.id
    )
    return NextResponse.json({ sprintIds })
  } catch (error) {
    console.error('GET /api/me/active-sprints error:', error)
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}
