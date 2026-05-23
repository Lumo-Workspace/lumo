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
  },
>(task: T) {
  const { owner, ...projectFields } = task.project
  return {
    ...task,
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
