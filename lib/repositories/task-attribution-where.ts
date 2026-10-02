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

/**
 * LUM-932 P3: unattached TOP-LEVEL sessions the attribution engine inferred
 * onto any of these tasks (an INFERRED segment). Segments live on top-level
 * sessions only; `taskId: null` keeps an explicitly bound session from being
 * counted twice (its own binding already lists it).
 */
export function inferredTopLevelSessionsForTasks(
  taskIds: string[]
): Prisma.SessionWhereInput {
  return {
    parentSessionId: null,
    taskId: null,
    attributionSegments: {
      some: { taskId: { in: taskIds }, source: 'INFERRED' },
    },
  }
}

export function inferredTopLevelSessionsForTask(
  taskId: string
): Prisma.SessionWhereInput {
  return inferredTopLevelSessionsForTasks([taskId])
}

/**
 * LUM-932 P3: "the task was worked on by some session" — an explicit binding,
 * or unattached top-level work inferred onto it. Spread into a Task where.
 */
export const taskHasSessions: Prisma.TaskWhereInput = {
  OR: [
    { sessions: { some: {} } },
    {
      attributionSegments: {
        some: { source: 'INFERRED', session: { parentSessionId: null } },
      },
    },
  ],
}
