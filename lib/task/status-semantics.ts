import type { TaskStatus } from '@prisma/client'

/**
 * LUM-1282: what each task status means to the read models — decided once
 * here so every metric, filter and picker applies the same rule.
 *
 * - **closed** (DONE, CANCELED): no work is left. Closed tasks are skipped by
 *   `lumo status --next`, claimable lists, "open task" counts and blockers.
 * - **counted** (everything but CANCELED): a canceled task is neither done
 *   nor outstanding, so it leaves both the numerator and the denominator of
 *   completion rates, burnup scope and sprint / milestone progress.
 *
 * Pure (no Prisma client import) so client components can use it.
 */

/** Terminal statuses: nothing left to do on the task. */
export const CLOSED_TASK_STATUSES = [
  'DONE',
  'CANCELED',
] as const satisfies readonly TaskStatus[]

/** Every status that is not closed — work remains (or has not started). */
export const OPEN_TASK_STATUSES = [
  'BACKLOG',
  'TODO',
  'IN_PROGRESS',
  'IN_REVIEW',
] as const satisfies readonly TaskStatus[]

/** Statuses that take part in completion metrics (all but CANCELED). */
export const COUNTED_TASK_STATUSES = [
  'BACKLOG',
  'TODO',
  'IN_PROGRESS',
  'IN_REVIEW',
  'DONE',
] as const satisfies readonly TaskStatus[]

/** Whether the task is closed (DONE or CANCELED). */
export function isClosedTaskStatus(status: string): boolean {
  return status === 'DONE' || status === 'CANCELED'
}

/** Whether the task counts toward completion metrics (not CANCELED). */
export function countsTowardCompletion(status: string): boolean {
  return status !== 'CANCELED'
}
