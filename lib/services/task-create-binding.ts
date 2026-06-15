import type { TaskStatus } from '@prisma/client'

const IN_FLIGHT_STATUSES: ReadonlySet<TaskStatus> = new Set<TaskStatus>([
  'IN_PROGRESS',
  'IN_REVIEW',
])

/** A task is "in-flight" once it is being worked or reviewed — not TODO, not DONE. */
export function isInFlightStatus(status: TaskStatus): boolean {
  return IN_FLIGHT_STATUSES.has(status)
}

export interface BoundTaskRef {
  identifier: string
  title: string
  status: TaskStatus
}

export interface ClassifyTaskCreateInput {
  /** The task this session is currently bound to, or null if unbound/unresolved. */
  boundTask: BoundTaskRef | null
  /** Whether the bound task currently has an unresolved send-back (a standing
   *  FAIL — the same notion the DONE gate uses). Defaults to false. */
  boundTaskHasOpenSendBack?: boolean
  /** Value of --rework-of, if the agent declared one. */
  reworkOf: string | undefined
  /** Whether the agent declared --new-scope. */
  newScope: boolean
}

export type TaskCreateIntent =
  | { kind: 'allow' }
  | { kind: 'redirect-rework'; target: string }
  | { kind: 'must-declare'; boundIdentifier: string; boundTitle: string }
  | {
      kind: 'blocked-open-sendback'
      boundIdentifier: string
      boundTitle: string
    }

/**
 * Decide what a `lumo task create` call should do, given the session's bound
 * task and the declared intent flags. Pure — no I/O. See spec Layer 1 + Layer 2.
 */
export function classifyTaskCreateIntent({
  boundTask,
  boundTaskHasOpenSendBack = false,
  reworkOf,
  newScope,
}: ClassifyTaskCreateInput): TaskCreateIntent {
  // Declaring rework always redirects — the work belongs on the existing task.
  if (reworkOf) {
    return { kind: 'redirect-rework', target: reworkOf }
  }
  if (boundTask && isInFlightStatus(boundTask.status)) {
    // Layer 2: a standing send-back is the hardest stop — resolve it before
    // opening new work; even a --new-scope declaration can't escape it.
    if (boundTaskHasOpenSendBack) {
      return {
        kind: 'blocked-open-sendback',
        boundIdentifier: boundTask.identifier,
        boundTitle: boundTask.title,
      }
    }
    // Layer 1: bound to an in-flight task with no declared intent → force it.
    if (!newScope) {
      return {
        kind: 'must-declare',
        boundIdentifier: boundTask.identifier,
        boundTitle: boundTask.title,
      }
    }
  }
  return { kind: 'allow' }
}
