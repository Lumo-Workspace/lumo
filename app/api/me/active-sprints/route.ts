import { NextRequest, NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { sprintRepository } from '@/lib/repositories'

/**
 * GET /api/me/active-sprints
 * Returns the IDs of all ACTIVE sprints for teams the current user belongs to,
 * within the caller's current workspace.
 *
 * Response: { sprintIds: string[] }
 *
 * Accepts both Clerk sessions (browser) and bearer tokens (CLI).
 */
export async function GET(request: NextRequest) {
  try {
    const identity = await requireIdentity(request)
    if (identity instanceof NextResponse) return identity

    const sprintIds = await sprintRepository.findActiveIdsForMember(
      identity.memberId
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
