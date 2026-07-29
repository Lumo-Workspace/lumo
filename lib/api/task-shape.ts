/** A `taskTags` join row as the list includes select it. */
interface TaskTagRow {
  tag: { id: string; name: string }
}

/**
 * Lift the `taskTags` join rows into a flat `tags` array and drop the join key.
 *
 * The board's Filter control reads `task.tags`; the join shape is a storage
 * detail and must not reach the client. Tolerates a row selected without
 * `taskTags` (returns no `tags` key) so callers on older selects are unaffected.
 */
export function liftTaskTags<T extends { taskTags?: TaskTagRow[] }>(task: T) {
  const { taskTags, ...rest } = task
  if (!Array.isArray(taskTags)) return rest
  return { ...rest, tags: taskTags.map(tt => tt.tag) }
}

/**
 * Flatten a task row from TASK_ASSIGNED_INCLUDE-shaped Prisma output into the
 * JSON shape the CLI `TaskRow` and other list consumers expect.
 *
 * - lifts t.team.identifier      → teamIdentifier
 * - lifts t.project.owner.actor.id → t.project.ownerActorId
 * - flattens t.parent.team.identifier → parent.teamIdentifier
 * - turns the t.children done-list into a count
 *
 * Used by /api/tasks/me and /api/milestones/[id]/tasks so the JSON
 * contract is identical.
 */
export function flattenTaskForListing<
  T extends {
    team: { identifier: string }
    project: {
      id: string
      name: string
      owner?: { actor?: { id: string } | null } | null
    }
    parent?: {
      id: string
      title: string
      number: number
      team: { identifier: string }
    } | null
    children?: { id: string }[]
    taskTags?: TaskTagRow[]
  },
>(task: T) {
  const { owner, ...projectFields } = task.project
  return {
    ...liftTaskTags(task),
    project: {
      ...projectFields,
      ownerActorId: owner?.actor?.id ?? null,
    },
    teamIdentifier: task.team.identifier,
    parent: task.parent
      ? {
          id: task.parent.id,
          title: task.parent.title,
          number: task.parent.number,
          teamIdentifier: task.parent.team.identifier,
        }
      : null,
    childrenDoneCount: Array.isArray(task.children) ? task.children.length : 0,
  }
}

/**
 * Flatten a sprint task row (findBySprint-shaped Prisma output) into the
 * MyTask shape the sprint board + list render. Like `flattenTaskForListing`
 * but sprint-specific:
 *  - `viewOrder` is null — sprints don't own a kanban view, so the board
 *    falls back to status-bucket ordering and same-column reordering is
 *    disabled in useBoardDrag when viewId is null.
 *  - tolerates missing `team.identifier` (falls back to '') the way the
 *    sprint route historically did.
 *
 * Shared by GET /api/sprints/[sprintId]/tasks and GET /api/sprints/by-number
 * so a sprint detail load can seed the tasks cache with byte-identical rows
 * (no waterfall: the second request is served from cache).
 */
export function shapeSprintTask<
  T extends {
    team?: { identifier?: string } | null
    project: {
      id: string
      name: string
      owner?: { actor?: { id: string } | null } | null
    }
    parent?: {
      id: string
      title: string
      number: number
      team?: { identifier?: string } | null
    } | null
    children?: { id: string }[]
    _count?: unknown
    taskTags?: TaskTagRow[]
  },
>(task: T) {
  const { owner, ...projectFields } = task.project
  return {
    ...liftTaskTags(task),
    project: {
      ...projectFields,
      ownerActorId: owner?.actor?.id ?? null,
    },
    teamIdentifier: task.team?.identifier ?? '',
    viewOrder: null,
    parent: task.parent
      ? {
          id: task.parent.id,
          title: task.parent.title,
          number: task.parent.number,
          teamIdentifier: task.parent.team?.identifier ?? '',
        }
      : null,
    _count: task._count,
    childrenDoneCount: Array.isArray(task.children) ? task.children.length : 0,
  }
}
