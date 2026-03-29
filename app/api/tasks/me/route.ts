import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { requireAuth, getUserWorkspace } from '@/lib/auth'
import { getHumanActorId } from '@/lib/actor'

/**
 * GET /api/tasks/me
 * Returns all tasks assigned to the current workspace member with per-view ordering.
 * Also lazy-creates the personal KANBAN view for the member on first access.
 */
export async function GET() {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { userId } = authResult

    const ws = await getUserWorkspace(userId)
    if (!ws) {
      return NextResponse.json({ error: 'No workspace found' }, { status: 404 })
    }

    const actorId = await getHumanActorId(ws.member.id)

    const tasks = await prisma.task.findMany({
      where: { assigneeActorId: actorId },
      include: {
        project: { select: { id: true, name: true } },
        team: { select: { identifier: true } },
      },
      orderBy: { order: 'asc' },
    })

    // Lazy-create personal KANBAN view for this member
    let myView = await prisma.view.findFirst({
      where: { memberId: ws.member.id, type: 'KANBAN' },
    })
    if (!myView) {
      myView = await prisma.view.create({
        data: {
          workspaceId: ws.member.workspaceId,
          memberId: ws.member.id,
          name: 'My Tasks',
          type: 'KANBAN',
          isDefault: false,
        },
      })
    }

    // Build viewOrder map
    const taskOrders = await prisma.viewTaskOrder.findMany({
      where: { viewId: myView.id },
    })
    const orderMap = new Map(taskOrders.map(o => [o.taskId, o.order]))

    return NextResponse.json({
      tasks: tasks.map(t => ({
        ...t,
        teamIdentifier: t.team.identifier,
        viewOrder: orderMap.get(t.id) ?? null,
      })),
      myTasksViewId: myView.id,
    })
  } catch (error) {
    console.error('GET /api/tasks/me error:', error)
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}
