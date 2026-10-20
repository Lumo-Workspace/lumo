import type { TaskStatus } from '@prisma/client'

/**
 * Whether entering each status marks the task as started. Exhaustive on
 * purpose: adding a TaskStatus value fails to compile until it is decided
 * here, instead of silently defaulting to "started".
 */
const STARTS_WORK: Record<TaskStatus, boolean> = {
  BACKLOG: false,
  TODO: false,
  IN_PROGRESS: true,
  IN_REVIEW: true,
  DONE: true,
  // LUM-1282: canceling is a ruling about the task, not a start of work.
  CANCELED: false,
}

/**
 * Whether entering `status` marks the task as started — the single rule
 * behind the set-once `Task.workStartedAt` stamp (LUM-437) that feeds the
 * milestone derived start date (LUM-636). BACKLOG and TODO are not starts
 * (LUM-1057); once stamped, the value is never reset, so moving a started
 * task back to TODO or BACKLOG keeps the original date.
 */
export function isWorkStartedStatus(status: TaskStatus): boolean {
  return STARTS_WORK[status]
}
