import type { TaskStatus } from '@prisma/client'
import { prisma } from '../db/prisma.js'
import { dispatchEvents } from '../events/dispatcher.js'
import type { DomainEvent } from '@lumo/shared'

// ── Types ───────────────────────────────────────────────────────────────────

export type TaskStatusValue = TaskStatus

// ── Transition map ───────────────────────────────────────���──────────────────

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
  currentStatus?: TaskStatusValue | undefined
  skipDispatch?: boolean | undefined
}

// ── Core transition function ────────────────────────────────────────────────

export async function transitionTaskStatus(
  taskId: string,
  projectId: string,
  to: TaskStatusValue,
  opts?: TaskTransitionOptions
): Promise<DomainEvent[]> {
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

  if (current === to) return []

  if (!isValidTaskTransition(current, to)) {
    throw new InvalidTaskTransitionError(taskId, current, to)
  }

  await prisma.task.update({
    where: { id: taskId },
    data: { status: to },
  })

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
