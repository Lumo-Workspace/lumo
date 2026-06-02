/**
 * Pure ranking logic for `lumo next`. Given the caller's open tasks plus the
 * set of ACTIVE sprint ids, produce a recommendation order and a per-task list
 * of human-readable reason factors.
 *
 * Ordering is lexicographic (explainable over a tunable magic score), honoring
 * "priority first": priority → active-sprint membership → dueDate → in-flight
 * status → updatedAt desc tiebreak.
 */

/** Subset of the /api/tasks/me task shape that ranking needs. */
export interface NextTask {
  id: string
  number: number
  title: string
  status: string
  priority: string
  teamIdentifier: string
  sprintId: string | null
  dueDate: string | null
  updatedAt: string
}

export interface RankedTask {
  task: NextTask
  /** e.g. "LUM-42" */
  identifier: string
  /** factor labels for the reason line, in display order */
  reasons: string[]
}

const PRIORITY_WEIGHT: Record<string, number> = {
  URGENT: 0,
  HIGH: 1,
  MEDIUM: 2,
  LOW: 3,
}

function priorityWeight(priority: string): number {
  return PRIORITY_WEIGHT[priority] ?? 99
}

/** Earlier due first; missing/invalid dueDate sorts last. */
function dueValue(dueDate: string | null): number {
  if (!dueDate) return Number.POSITIVE_INFINITY
  const t = new Date(dueDate).getTime()
  return Number.isNaN(t) ? Number.POSITIVE_INFINITY : t
}

const IN_FLIGHT = new Set(['IN_PROGRESS', 'IN_REVIEW'])

/** in-flight (0) before TODO (1) before anything else (2). */
function statusRank(status: string): number {
  if (IN_FLIGHT.has(status)) return 0
  if (status === 'TODO') return 1
  return 2
}

function inActiveSprint(task: NextTask, activeSprintIds: Set<string>): boolean {
  return task.sprintId !== null && activeSprintIds.has(task.sprintId)
}

function deriveReasons(
  task: NextTask,
  activeSprintIds: Set<string>,
  now: Date
): string[] {
  const reasons: string[] = [task.priority]

  if (inActiveSprint(task, activeSprintIds)) {
    reasons.push('active sprint')
  }

  if (task.dueDate) {
    const day = task.dueDate.slice(0, 10)
    const due = new Date(task.dueDate).getTime()
    const overdue = !Number.isNaN(due) && due < now.getTime()
    reasons.push(overdue ? `due ${day} (overdue)` : `due ${day}`)
  }

  if (task.status === 'IN_PROGRESS') reasons.push('in progress')
  else if (task.status === 'IN_REVIEW') reasons.push('in review')

  return reasons
}

export function rankTasks(
  tasks: NextTask[],
  activeSprintIds: Set<string>,
  now: Date
): RankedTask[] {
  const sorted = [...tasks].sort((a, b) => {
    const pw = priorityWeight(a.priority) - priorityWeight(b.priority)
    if (pw !== 0) return pw

    const sa = inActiveSprint(a, activeSprintIds) ? 0 : 1
    const sb = inActiveSprint(b, activeSprintIds) ? 0 : 1
    if (sa !== sb) return sa - sb

    const dv = dueValue(a.dueDate) - dueValue(b.dueDate)
    if (dv !== 0 && !Number.isNaN(dv)) return dv

    const st = statusRank(a.status) - statusRank(b.status)
    if (st !== 0) return st

    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  })

  return sorted.map(task => ({
    task,
    identifier: `${task.teamIdentifier}-${task.number}`,
    reasons: deriveReasons(task, activeSprintIds, now),
  }))
}
