import { NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { getHumanActorId } from '@/lib/actor'
import { taskRepository, viewRepository } from '@/lib/repositories'

/**
 * GET /api/tasks/me
 * Returns all tasks assigned to the current workspace member with per-view ordering.
 * Also lazy-creates the personal KANBAN view for the member on first access.
 *
 * Accepts both Clerk sessions (browser) and bearer tokens (CLI). When the
 * caller is a bearer token, "me" means the member whose API key was used.
 *
 * Query params:
 *   sprintIds — comma-separated sprint IDs to filter by (optional)
 */
export async function GET(req: Request) {
  try {
    const identity = await requireIdentity(req)
    if (identity instanceof NextResponse) return identity

    const actorId = await getHumanActorId(identity.memberId)
    if (!actorId) {
      return NextResponse.json({ tasks: [], myTasksViewId: null })
    }

    const { searchParams } = new URL(req.url)
    const sprintIdsParam = searchParams.get('sprintIds')
    const sprintIds = sprintIdsParam
      ? sprintIdsParam.split(',').filter(Boolean)
      : undefined

    const tasks = await taskRepository.findAssignedTasks(
      actorId,
      sprintIds ? { sprintIds } : {}
    )

    // Lazy-create personal KANBAN view for this member
    const myView = await viewRepository.findOrCreateMemberKanban(
      identity.workspaceId,
      identity.memberId
    )

    // Build viewOrder map
    const taskOrders = await viewRepository.findTaskOrders(myView.id)
    const orderMap = new Map(taskOrders.map(o => [o.taskId, o.order]))

    return NextResponse.json({
      // TODO(LUM-65 follow-up): adopt flattenTaskForListing
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
