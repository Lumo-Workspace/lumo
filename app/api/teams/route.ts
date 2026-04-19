import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { requireUserWorkspace } from '@/lib/api/helpers'
import { prisma } from '@/lib/db/prisma'

/**
 * GET /api/teams — List all teams in the current user's workspace.
 */
export async function GET() {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { userId } = authResult

    const ws = await requireUserWorkspace(userId)
    if (ws instanceof NextResponse) return ws

    const teams = await prisma.team.findMany({
      where: { workspaceId: ws.workspaceId },
      select: {
        id: true,
        name: true,
        identifier: true,
        isDefault: true,
        sprintCadenceDays: true,
      },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    })

    return NextResponse.json({ teams })
  } catch {
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}
