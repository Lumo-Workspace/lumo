import { fmtDay } from './format'
/**
 * Pure ranking logic for `lumo status --next`. Given the caller's open tasks plus the
 * set of ACTIVE sprint ids, produce a recommendation order and a per-task list
 * of human-readable reason factors.
 *
 * Ordering is lexicographic (explainable over a tunable magic score), honoring
 * "priority first": priority → active-sprint membership → dependency topology
 * (unblocked before blocked, then most open tasks released) → dueDate →
 * in-flight status → updatedAt desc tiebreak.
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
  /**
   * LUM-645 dependency-topology counts. Optional: an older server simply
   * doesn't send them, and ranking degrades to the pre-topology order.
   */
  blockedByOpenCount?: number
  unblocksOpenCount?: number
  /**
   * LUM-646 agent-claimable marker. A new server always sends a boolean
   * (default false); an older server omits it entirely — the absence of the
   * field across all tasks is how `lumo status --next --claimable` detects an
   * unsupported server and degrades gracefully.
   */
  claimable?: boolean
  /**
   * LUM-646 F2 budget signal, only populated when the caller requested it
   * (`?claimable=1`). `true` = the task's milestone measured over its token
   * budget; `false`/`null`/absent = not over (or no budget / unmeasured).
   */
  milestoneBudgetExceeded?: boolean | null
}

export interface RankedTask {
  task: NextTask
  /** e.g. "LUM-42" */
  identifier: string
  /** factor labels for the reason line, in display order */
  reasons: string[]
}

/** URGENT > HIGH > MEDIUM > LOW > NONE: unassessed work ranks last (LUM-1284). */
const PRIORITY_WEIGHT: Record<string, number> = {
  URGENT: 0,
  HIGH: 1,
  MEDIUM: 2,
  LOW: 3,
  NONE: 4,
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

/** Missing counts (older server) read as 0 — no topology signal, no reorder. */
function blockedByOpen(task: NextTask): number {
  return task.blockedByOpenCount ?? 0
}

function unblocksOpen(task: NextTask): number {
  return task.unblocksOpenCount ?? 0
}

function deriveReasons(
  task: NextTask,
  activeSprintIds: Set<string>,
  now: Date
): string[] {
  const reasons: string[] = [
    task.priority === 'NONE' ? 'no priority' : task.priority,
  ]

  if (inActiveSprint(task, activeSprintIds)) {
    reasons.push('active sprint')
  }

  const blocked = blockedByOpen(task)
  const unblocks = unblocksOpen(task)
  if (blocked > 0) {
    reasons.push(
      blocked === 1
        ? 'blocked by 1 open dep'
        : `blocked by ${blocked} open deps`
    )
  } else if (unblocks > 0) {
    reasons.push(
      unblocks === 1 ? 'unblocks 1 task' : `unblocks ${unblocks} tasks`
    )
  }

  if (task.dueDate) {
    const day = fmtDay(task.dueDate)
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

    // Dependency topology (LUM-645): workable-now before blocked, then the
    // task that releases the most open work. Both 0 when the server doesn't
    // send counts — the comparator falls through unchanged.
    const ba = blockedByOpen(a) > 0 ? 1 : 0
    const bb = blockedByOpen(b) > 0 ? 1 : 0
    if (ba !== bb) return ba - bb

    const ub = unblocksOpen(b) - unblocksOpen(a)
    if (ub !== 0) return ub

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
