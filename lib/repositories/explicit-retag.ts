import type { Prisma } from '@prisma/client'

/** Bind-parameter headroom for the crossing `hookEventId IN (...)` list. */
const CROSSING_ID_CHUNK = 5000

/**
 * LUM-932 P3: explicit binding always wins. When sessions become explicitly
 * bound to `taskId` (own attach, inherit to an unbound child, late inherit),
 * EVERY event of those sessions is retagged to it — not only untagged ones,
 * since record time may have stamped a provisional (inferred) task. The
 * UNDISPOSITIONED boundary crossings of the events that carried another task
 * move with them; dispositioned crossings stay where they were ruled, and
 * task-less (milestone-scoped steward) crossings are never touched.
 *
 * Runs inside the caller's transaction. `eventsUpdated` counts events whose
 * taskId changed.
 */
export async function retagEventsToExplicitTask(
  tx: Prisma.TransactionClient,
  sessionIds: string[],
  taskId: string
): Promise<{ eventsUpdated: number; crossingsMoved: number }> {
  if (sessionIds.length === 0) return { eventsUpdated: 0, crossingsMoved: 0 }
  // `not` excludes SQL NULL — these are the events tagged with ANOTHER task,
  // the only ones that can own a task-scoped crossing to move.
  const otherTagged = await tx.hookEvent.findMany({
    where: { sessionId: { in: sessionIds }, taskId: { not: taskId } },
    select: { id: true },
  })
  let crossingsMoved = 0
  for (let i = 0; i < otherTagged.length; i += CROSSING_ID_CHUNK) {
    const ids = otherTagged.slice(i, i + CROSSING_ID_CHUNK).map(e => e.id)
    const { count } = await tx.boundaryCrossing.updateMany({
      where: {
        hookEventId: { in: ids },
        disposition: null,
        taskId: { not: taskId },
      },
      data: { taskId },
    })
    crossingsMoved += count
  }
  const { count: eventsUpdated } = await tx.hookEvent.updateMany({
    where: {
      sessionId: { in: sessionIds },
      OR: [{ taskId: null }, { taskId: { not: taskId } }],
    },
    data: { taskId },
  })
  return { eventsUpdated, crossingsMoved }
}
