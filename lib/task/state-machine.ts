import type { TaskStatus } from '@prisma/client'
import { prisma } from '@/lib/db/prisma'
import { dispatchEvents } from '@/lib/events/dispatcher'
import type { DomainEvent } from '@/lib/events/types'

// ── Types ───────────────────────────────────────────────────────────────────

export type TaskStatusValue = TaskStatus

// ── Transition map ──────────────────────────────────────────────────────────

const TRANSITIONS: Record<TaskStatusValue, TaskStatusValue[]> = {
  TODO: ['IN_PROGRESS', 'IN_REVIEW', 'DONE'],
  IN_PROGRESS: ['TODO', 'IN_REVIEW', 'DONE'],
  IN_REVIEW: ['TODO', 'IN_PROGRESS', 'DONE'],
  DONE: ['TODO', 'IN_PROGRESS'],
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
 * targets, and for DONE points at comments (the common dead end is trying to
 * move a DONE task back to IN_REVIEW to append follow-up context).
 */
export function invalidTransitionMessage(
  from: TaskStatusValue,
  to: TaskStatusValue
): string {
  const allowed = allowedTaskTransitions(from).join(', ') || 'none'
  const doneHint =
    from === 'DONE'
      ? ' To attach follow-up context to a DONE task, add a task comment instead.'
      : ''
  return `Invalid status transition: ${from} → ${to}. Allowed from ${from}: ${allowed}.${doneHint}`
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
    data: { status: to },
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
