import type { TaskStatus } from '@prisma/client'
import { prisma } from '@/lib/db/prisma'
import { dispatchEvents } from '@/lib/events/dispatcher'
import type { DomainEvent } from '@/lib/events/types'

// ── Types ───────────────────────────────────────────────────────────────────

export type TaskStatusValue = TaskStatus

// ── Transition map ──────────────────────────────────────────────────────────

const TRANSITIONS: Record<TaskStatusValue, TaskStatusValue[]> = {
  // LUM-1057: BACKLOG = not yet scheduled; it moves freely to/from every status.
  BACKLOG: ['TODO', 'IN_PROGRESS', 'IN_REVIEW', 'DONE', 'CANCELED'],
  TODO: ['BACKLOG', 'IN_PROGRESS', 'IN_REVIEW', 'DONE', 'CANCELED'],
  IN_PROGRESS: ['BACKLOG', 'TODO', 'IN_REVIEW', 'DONE', 'CANCELED'],
  IN_REVIEW: ['BACKLOG', 'TODO', 'IN_PROGRESS', 'DONE', 'CANCELED'],
  // IN_REVIEW is included so that undoing an acceptance verdict (LUM-586) can
  // send a DONE task back to IN_REVIEW via the normal state-machine guard.
  DONE: ['BACKLOG', 'TODO', 'IN_PROGRESS', 'IN_REVIEW', 'CANCELED'],
  // LUM-1282: a canceled task reopens to any status. Entering CANCELED (and
  // DONE) is a human ruling — see `gatedStatuses` below.
  CANCELED: ['BACKLOG', 'TODO', 'IN_PROGRESS', 'IN_REVIEW', 'DONE'],
}

/**
 * LUM-1282: statuses whose entry is a human ruling. DONE is gated by the
 * confirmation envelope (with the merged-PR one-step shortcut); CANCELED by
 * the envelope only — an agent may propose it, never apply it on its own.
 */
const GATED_STATUSES: readonly TaskStatusValue[] = ['DONE', 'CANCELED']

/** Whether entering `status` needs the user's confirmation. */
export function isGatedStatus(status: TaskStatusValue): boolean {
  return GATED_STATUSES.includes(status)
}

// ── Terminal timestamps ─────────────────────────────────────────────────────

export interface TerminalTimestampPatch {
  completedAt?: Date | null
  canceledAt?: Date | null
}

/**
 * LUM-1282: the `completedAt` / `canceledAt` writes a `from → to` move makes.
 * Entering DONE stamps `completedAt`, entering CANCELED stamps `canceledAt`;
 * leaving either clears its stamp (a reopen). A move that touches neither
 * terminal status returns `{}`, and so does a no-op (`from === to`), so a
 * re-asserted DONE keeps its original completion time.
 */
export function terminalTimestampPatch(
  from: TaskStatusValue,
  to: TaskStatusValue,
  now: Date
): TerminalTimestampPatch {
  if (from === to) return {}
  const patch: TerminalTimestampPatch = {}
  if (to === 'DONE') patch.completedAt = now
  else if (from === 'DONE') patch.completedAt = null
  if (to === 'CANCELED') patch.canceledAt = now
  else if (from === 'CANCELED') patch.canceledAt = null
  return patch
}

// ── Catalog ─────────────────────────────────────────────────────────────────

const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const

export interface TaskWorkflowCatalog {
  statuses: Array<{ value: TaskStatusValue; transitionsTo: TaskStatusValue[] }>
  priorities: readonly string[]
  /** Statuses whose entry is gated by a human confirmation / DONE gate. */
  gatedStatuses: TaskStatusValue[]
}

/**
 * The status set + transition matrix as data, so clients (CLI `task statuses`,
 * agents) read the server's truth instead of hardcoding it.
 */
export function taskWorkflowCatalog(): TaskWorkflowCatalog {
  return {
    statuses: (Object.keys(TRANSITIONS) as TaskStatusValue[]).map(value => ({
      value,
      transitionsTo: [...TRANSITIONS[value]],
    })),
    priorities: PRIORITIES,
    gatedStatuses: [...GATED_STATUSES],
  }
}

// ── Validation ──────────────────────────────────────────────────────────────

export function isValidTaskTransition(
  from: TaskStatusValue,
  to: TaskStatusValue
): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false
}

/** Statuses reachable from `from` — for actionable error messages. */
export function allowedTaskTransitions(
  from: TaskStatusValue
): TaskStatusValue[] {
  return TRANSITIONS[from] ?? []
}

/**
 * Human/agent-readable rejection for an invalid transition: names the allowed
 * targets so the caller can self-correct.
 */
export function invalidTransitionMessage(
  from: TaskStatusValue,
  to: TaskStatusValue
): string {
  const allowed = allowedTaskTransitions(from).join(', ') || 'none'
  return `Invalid status transition: ${from} → ${to}. Allowed from ${from}: ${allowed}.`
}

export class InvalidTaskTransitionError extends Error {
  constructor(
    public readonly taskId: string,
    public readonly from: TaskStatusValue,
    public readonly to: TaskStatusValue
  ) {
    super(`Invalid task status transition: ${from} → ${to} (task ${taskId})`)
    this.name = 'InvalidTaskTransitionError'
  }
}

// ── Options ─────────────────────────────────────────────────────────────────

export interface TaskTransitionOptions {
  /** Skip reading current status — use this when you already know it */
  currentStatus?: TaskStatusValue | undefined
  /** Skip dispatching domain events (broadcast, notifications) */
  skipDispatch?: boolean | undefined
}

// ── Core transition function ────────────────────────────────────────────────

/**
 * Transition a task's status with validation and domain event dispatch.
 * Returns emitted events so callers using skipDispatch can dispatch later.
 */
export async function transitionTaskStatus(
  taskId: string,
  projectId: string,
  to: TaskStatusValue,
  opts?: TaskTransitionOptions
): Promise<DomainEvent[]> {
  // Determine current status
  let current: TaskStatusValue
  if (opts?.currentStatus !== undefined) {
    current = opts.currentStatus
  } else {
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      select: { status: true },
    })
    if (!task) throw new Error(`Task ${taskId} not found`)
    current = task.status
  }

  // No-op if already in target status
  if (current === to) return []

  // Validate
  if (!isValidTaskTransition(current, to)) {
    throw new InvalidTaskTransitionError(taskId, current, to)
  }

  await prisma.task.update({
    where: { id: taskId },
    data: { status: to, ...terminalTimestampPatch(current, to, new Date()) },
  })

  // Emit domain event
  const events: DomainEvent[] = [
    {
      type: 'task:status_changed',
      taskId,
      projectId,
      from: current,
      to,
    },
  ]

  if (!opts?.skipDispatch) {
    await dispatchEvents(events)
  }

  return events
}
