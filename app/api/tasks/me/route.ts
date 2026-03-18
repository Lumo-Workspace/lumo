import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { requireAuth, getUserWorkspace } from '@/lib/auth'

/**
 * GET /api/tasks/me
 * Returns all tasks assigned to the current workspace member,
 * ordered by updatedAt desc, with project info included.
 */
export async function GET() {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { userId } = authResult

    const ws = await getUserWorkspace(userId)
    if (!ws) {
      return NextResponse.json(
        { error: 'No workspace found' },
        { status: 404 }
      )
    }

    const tasks = await prisma.task.findMany({
      where: { assigneeId: ws.member.id },
      include: {
        project: { select: { id: true, name: true } },
      },
      orderBy: { updatedAt: 'desc' },
    })

    return NextResponse.json({ tasks })
  } catch (error) {
    console.error('GET /api/tasks/me error:', error)
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}
