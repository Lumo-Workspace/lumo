import { NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { getHumanActorId } from '@/lib/actor'
import { taskRepository, viewRepository } from '@/lib/repositories'
import { taskDependencyRepository } from '@/lib/repositories/task-dependency.repository'
import { liftTaskTags } from '@/lib/api/task-shape'
import { zodError } from '@/lib/api/helpers'
import {
  taskListFilters,
  taskQueryService,
} from '@/lib/services/task-query.service'
import { myTaskFiltersSchema } from '@/lib/validation/schemas'
import { readPageParams } from '@/lib/validation/pagination'
import { isClosedTaskStatus } from '@/lib/task/status-semantics'

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
 *
 * LUM-1093 paged shape (`lumo task list`), only when `limit` or `cursor` is
 * sent — the web board keeps the full list:
 *   limit (1-500, default 50), cursor (a previous `nextCursor`),
 *   statuses (comma-separated), milestoneIds (comma-separated),
 *   projectName (exact, case-insensitive)
 *   → adds `total` (whole filtered set) and `nextCursor` (null on the last page).
 * LUM-1233 (the old `task search` filters, all optional and ANDed):
 *   assignee=any (every assignee) | assigneeActorIds + unassigned=1 (ORed),
 *   priorities, tagIds, projectIds (comma-separated), q + match=exact|fuzzy,
 *   dueAfter / dueBefore (instants) → also adds `truncated` (a fuzzy `q` hit
 *   the ranking cap, so `total` is a floor).
 */
function parseList(
  searchParams: URLSearchParams,
  key: string
): string[] | undefined {
  const raw = searchParams.get(key)
  if (!raw) return undefined
  const arr = raw.split(',').filter(Boolean)
  return arr.length ? arr : undefined
}

export async function GET(req: Request) {
  try {
    const identity = await requireIdentity(req)
    if (identity instanceof NextResponse) return identity

    const { searchParams } = new URL(req.url)
    const sprintIds = parseList(searchParams, 'sprintIds')
    const paging = readPageParams(searchParams)
    if (!paging.ok) return zodError(paging)

    const actorId = await getHumanActorId(identity.memberId)
    // LUM-646: `lumo status --next --claimable` asks for the extra F2 budget signal so
    // the autonomy gate can drop over-budget tasks. Only computed on request —
    // the default `lumo status --next` payload stays lean.
    const wantBudget = searchParams.get('claimable') === '1'

    let tasks: Awaited<ReturnType<typeof taskRepository.findAssignedTasks>>
    let pageInfo: {
      total: number
      nextCursor: string | null
      truncated: boolean
    } | null = null
    if (paging.page) {
      const filters = myTaskFiltersSchema.safeParse({
        statuses: parseList(searchParams, 'statuses'),
        milestoneIds: parseList(searchParams, 'milestoneIds'),
        projectName: searchParams.get('projectName') ?? undefined,
        projectIds: parseList(searchParams, 'projectIds'),
        priorities: parseList(searchParams, 'priorities'),
        assigneeActorIds: parseList(searchParams, 'assigneeActorIds'),
        unassigned: searchParams.get('unassigned') === '1' ? true : undefined,
        assignee: searchParams.get('assignee') ?? undefined,
        tagIds: parseList(searchParams, 'tagIds'),
        q: searchParams.get('q') ?? undefined,
        match: searchParams.get('match') ?? undefined,
        dueAfter: searchParams.get('dueAfter') ?? undefined,
        dueBefore: searchParams.get('dueBefore') ?? undefined,
      })
      if (!filters.success) return zodError(filters)
      const { match, ...rest } = filters.data
      const query = {
        ...rest,
        ...(match === 'fuzzy' ? { fuzzy: true } : {}),
        ...(sprintIds ? { sprintIds } : {}),
      }
      // "My tasks" for a member with no actor: nothing to list (as before).
      if (!actorId && !taskListFilters(null, query)) {
        return NextResponse.json({
          tasks: [],
          myTasksViewId: null,
          total: 0,
          nextCursor: null,
          truncated: false,
        })
      }
      const result = await taskQueryService.findTaskListPage(
        identity.workspaceId,
        actorId,
        query,
        paging.page
      )
      tasks = result.tasks
      pageInfo = {
        total: result.total,
        nextCursor: result.nextCursor,
        truncated: result.truncated,
      }
    } else {
      if (!actorId) {
        return NextResponse.json({ tasks: [], myTasksViewId: null })
      }
      tasks = await taskRepository.findAssignedTasks(
        actorId,
        sprintIds ? { sprintIds } : {}
      )
    }

    // Lazy-create personal KANBAN view for this member
    const myView = await viewRepository.findOrCreateMemberKanban(
      identity.workspaceId,
      identity.memberId
    )

    // Build viewOrder map
    const taskOrders = await viewRepository.findTaskOrders(myView.id)
    const orderMap = new Map(taskOrders.map(o => [o.taskId, o.order]))

    // LUM-645: per-task dependency-topology counts for `lumo status --next` ranking.
    // blockedByOpenCount — confirmed BLOCKS edges whose blocker is unfinished;
    // unblocksOpenCount — open tasks this one directly releases when done.
    const depEdges =
      await taskDependencyRepository.findConfirmedBlocksEdgesTouching(
        tasks.map(t => t.id)
      )
    const blockedByOpen = new Map<string, number>()
    const unblocksOpen = new Map<string, number>()
    for (const e of depEdges) {
      // LUM-1282: closed = DONE or CANCELED; neither blocks nor waits.
      if (!isClosedTaskStatus(e.blockingTask.status)) {
        blockedByOpen.set(
          e.blockedTaskId,
          (blockedByOpen.get(e.blockedTaskId) ?? 0) + 1
        )
      }
      if (!isClosedTaskStatus(e.blockedTask.status)) {
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
      ...(pageInfo ?? {}),
    })
  } catch (error) {
    console.error('GET /api/tasks/me error:', error)
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}
