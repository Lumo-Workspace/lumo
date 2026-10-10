import type { TaskStatus } from '@prisma/client'

/** Statuses that mean work on the task has not started yet. */
const NOT_STARTED: ReadonlySet<string> = new Set<TaskStatus>([
  'BACKLOG',
  'TODO',
])

/**
 * Whether entering `status` marks the task as started — the single rule
 * behind the set-once `Task.workStartedAt` stamp (LUM-437) that feeds the
 * milestone derived start date (LUM-636). BACKLOG and TODO are not starts
 * (LUM-1057); once stamped, the value is never reset, so moving a started
 * task back to TODO or BACKLOG keeps the original date.
 */
export function isWorkStartedStatus(status: string): boolean {
  return !NOT_STARTED.has(status)
}
