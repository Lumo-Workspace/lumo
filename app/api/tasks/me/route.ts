import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { requireUserWorkspace } from '@/lib/api/helpers'
import { getHumanActorId } from '@/lib/actor'
import { taskRepository, viewRepository } from '@/lib/repositories'

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

    const ws = await requireUserWorkspace(userId)
    if (ws instanceof NextResponse) return ws

    const actorId = await getHumanActorId(ws.member.id)
    if (!actorId) {
      return NextResponse.json({ tasks: [], myTasksViewId: null })
    }

    const tasks = await taskRepository.findAssignedTasks(actorId)

    // Lazy-create personal KANBAN view for this member
    const myView = await viewRepository.findOrCreateMemberKanban(
      ws.member.workspaceId,
      ws.member.id
    )

    // Build viewOrder map
    const taskOrders = await viewRepository.findTaskOrders(myView.id)
    const orderMap = new Map(taskOrders.map(o => [o.taskId, o.order]))

    return NextResponse.json({
      tasks: tasks.map(t => {
        const { owner, ...projectFields } = t.project
        return {
          ...t,
          project: {
            ...projectFields,
            ownerActorId: owner?.actor?.id ?? null,
          },
          teamIdentifier: t.team.identifier,
          viewOrder: orderMap.get(t.id) ?? null,
          parent: t.parent
            ? {
                id: t.parent.id,
                title: t.parent.title,
                number: t.parent.number,
                teamIdentifier: t.parent.team.identifier,
              }
            : null,
          _count: t._count,
          childrenDoneCount: Array.isArray(t.children) ? t.children.length : 0,
        }
      }),
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
