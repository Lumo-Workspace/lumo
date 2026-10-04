import { NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { getHumanActorId } from '@/lib/actor'
import { taskRepository, viewRepository } from '@/lib/repositories'
import { taskDependencyRepository } from '@/lib/repositories/task-dependency.repository'
import { liftTaskTags } from '@/lib/api/task-shape'

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
    // LUM-646: `lumo next --claimable` asks for the extra F2 budget signal so
    // the autonomy gate can drop over-budget tasks. Only computed on request —
    // the default `lumo next` payload stays lean.
    const wantBudget = searchParams.get('claimable') === '1'

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

    // LUM-645: per-task dependency-topology counts for `lumo next` ranking.
    // blockedByOpenCount — confirmed BLOCKS edges whose blocker is unfinished;
    // unblocksOpenCount — open tasks this one directly releases when done.
    const depEdges =
      await taskDependencyRepository.findConfirmedBlocksEdgesTouching(
        tasks.map(t => t.id)
      )
    const blockedByOpen = new Map<string, number>()
    const unblocksOpen = new Map<string, number>()
    for (const e of depEdges) {
      if (e.blockingTask.status !== 'DONE') {
        blockedByOpen.set(
          e.blockedTaskId,
          (blockedByOpen.get(e.blockedTaskId) ?? 0) + 1
        )
      }
      if (e.blockedTask.status !== 'DONE') {
        unblocksOpen.set(
          e.blockingTaskId,
          (unblocksOpen.get(e.blockingTaskId) ?? 0) + 1
        )
      }
    }

    // LUM-646: per-milestone F2 budget signal, only when the claimable gate
    // asked for it. Dynamic import keeps the milestone-service graph off the
    // default path. `null` when a task has no milestone or none is over budget.
    let budgetExceeded = new Map<string, boolean | null>()
    if (wantBudget) {
      const milestoneIds = tasks
        .map(t => t.milestoneId)
        .filter((id): id is string => id !== null)
      if (milestoneIds.length > 0) {
        const { milestoneService } =
          await import('@/lib/services/milestone.service')
        budgetExceeded =
          await milestoneService.getBudgetExceededForMilestones(milestoneIds)
      }
    }

    return NextResponse.json({
      // TODO(LUM-65 follow-up): adopt flattenTaskForListing
      tasks: tasks.map(t => {
        const { owner, ...projectFields } = t.project
        return {
          ...liftTaskTags(t),
          project: {
            ...projectFields,
            ownerActorId: owner?.actor?.id ?? null,
          },
          teamIdentifier: t.team.identifier,
          viewOrder: orderMap.get(t.id) ?? null,
          blockedByOpenCount: blockedByOpen.get(t.id) ?? 0,
          unblocksOpenCount: unblocksOpen.get(t.id) ?? 0,
          // LUM-646: F2 budget signal, present only under ?claimable=1.
          ...(wantBudget
            ? {
                milestoneBudgetExceeded: t.milestoneId
                  ? (budgetExceeded.get(t.milestoneId) ?? null)
                  : null,
              }
            : {}),
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
