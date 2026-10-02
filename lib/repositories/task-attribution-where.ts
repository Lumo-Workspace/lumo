import { Prisma } from '@prisma/client'

/**
 * LUM-932: the one rule for "events that belong to a task". An event's own
 * taskId wins (explicit binding copied at record time, or the attribution
 * engine's per-event backfill for unattached work); a NULL event taskId falls
 * through to its session's explicit binding (rows written before per-event
 * tagging). The `taskId: null` guard stops a re-tagged event leaking into its
 * session's task.
 */
export function eventsForTask(taskId: string): Prisma.HookEventWhereInput {
  return { OR: [{ taskId }, { taskId: null, session: { taskId } }] }
}

export function eventsForTasks(taskIds: string[]): Prisma.HookEventWhereInput {
  return {
    OR: [
      { taskId: { in: taskIds } },
      { taskId: null, session: { taskId: { in: taskIds } } },
    ],
  }
}

/**
 * LUM-932 P3: per-turn usage rows of UNATTACHED work attributed to these tasks
 * (attached sessions are costed from their cumulative columns instead, so they
 * are excluded here to avoid double counting).
 */
export function inferredUsageEventsForTasks(
  taskIds: string[]
): Prisma.HookEventWhereInput {
  return {
    taskId: { in: taskIds },
    type: { in: ['STOP', 'STOP_FAILURE', 'SUBAGENT_STOP'] },
    session: { taskId: null },
    usageByModel: { not: Prisma.DbNull },
  }
}
