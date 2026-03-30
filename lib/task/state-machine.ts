import type { TaskStatus } from '@prisma/client'
import { prisma } from '@/lib/db/prisma'
import { pushProjectEvent } from '@/lib/pusher/server'

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
  /** Skip the Pusher project broadcast */
  skipBroadcast?: boolean | undefined
}

// ── Core transition function ────────────────────────────────────────────────

export async function transitionTaskStatus(
  taskId: string,
  projectId: string,
  to: TaskStatusValue,
  opts?: TaskTransitionOptions
): Promise<void> {
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
  if (current === to) return

  // Validate
  if (!isValidTaskTransition(current, to)) {
    throw new InvalidTaskTransitionError(taskId, current, to)
  }

  await prisma.task.update({
    where: { id: taskId },
    data: { status: to },
  })

  // Broadcast project-level event
  if (!opts?.skipBroadcast) {
    await pushProjectEvent(projectId, {
      type: 'task:updated',
      taskId,
      fields: ['status'],
      patch: { status: to },
    })
  }
}
