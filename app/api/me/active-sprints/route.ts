import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { requireUserWorkspace } from '@/lib/api/helpers'
import { prisma } from '@/lib/db/prisma'

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

    // Find teams where the current member has a TeamMember row
    const teamMembers = await prisma.teamMember.findMany({
      where: { memberId: ws.member.id },
      select: { teamId: true },
    })

    if (teamMembers.length === 0) {
      return NextResponse.json({ sprintIds: [] })
    }

    const teamIds = teamMembers.map(tm => tm.teamId)

    // Find active sprints for those teams
    const activeSprints = await prisma.sprint.findMany({
      where: {
        teamId: { in: teamIds },
        status: 'ACTIVE',
      },
      select: { id: true },
    })

    return NextResponse.json({ sprintIds: activeSprints.map(s => s.id) })
  } catch (error) {
    console.error('GET /api/me/active-sprints error:', error)
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}
