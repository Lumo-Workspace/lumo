import type { Prisma } from '@prisma/client'
import {
  ID_CHUNK,
  moveOpenCrossingsForEvents,
} from '@/lib/repositories/open-crossing-move'
import { parseChildSessionId } from '@/lib/session/child-session-id'

/**
 * LUM-932 P3: serialize a binding write with the attribution recompute. Every
 * binding (task attach of a root or child, steward attach, inherit to
 * children, late inherit, explicit retag) bumps the family ROOT's
 * `attributionVersion` inside the binding's own transaction. The row lock
 * orders it against a concurrent `commitFamilyAttribution`, whose version
 * check then conflicts and retries on fresh data — so a recompute never
 * backfills a session bound after it loaded the family. A missing root row
 * matches nothing (count 0) and is harmless.
 */
export async function bumpFamilyAttributionVersion(
  tx: Prisma.TransactionClient,
  sessionId: string
): Promise<void> {
  const rootId = parseChildSessionId(sessionId)?.parentSessionId ?? sessionId
  await tx.session.updateMany({
    where: { id: rootId },
    data: { attributionVersion: { increment: 1 } },
  })
}

/**
 * LUM-932 P3: explicit binding always wins. When sessions become explicitly
 * bound to `taskId` (own attach, inherit to an unbound child, late inherit),
 * EVERY event of those sessions is retagged to it — not only untagged ones,
 * since record time may have stamped a provisional (inferred) task. The
 * UNDISPOSITIONED boundary crossings of the events that carried another task
 * move with them; dispositioned crossings stay where they were ruled, and
 * task-less (milestone-scoped steward) crossings are never touched.
 *
 * Runs inside the caller's transaction (open it with `RETAG_TX_OPTIONS`). `eventsUpdated` counts events whose
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
    select: { id: true, taskId: true },
  })
  const crossingsMoved = await moveOpenCrossingsForEvents(
    tx,
    otherTagged.map(e => ({
      eventId: e.id,
      fromTaskId: e.taskId,
      toTaskId: taskId,
    }))
  )
  const { count: eventsUpdated } = await tx.hookEvent.updateMany({
    where: {
      sessionId: { in: sessionIds },
      OR: [{ taskId: null }, { taskId: { not: taskId } }],
    },
    data: { taskId },
  })
  return { eventsUpdated, crossingsMoved }
}

/**
 * LUM-640 / LUM-932 P3: a session that becomes a milestone-bound STEWARD keeps
 * its events task-less. Events of the session and of its still-unbound
 * children that record time provisionally tagged with a task are reset to
 * null, and their UNDISPOSITIONED crossings move to no task with them
 * (dispositioned crossings stay where they were ruled). Explicitly bound
 * children keep their binding and events.
 *
 * Runs inside the caller's transaction, AFTER the root's version bump (lock
 * order: root row first, then children / events).
 */
export async function clearProvisionalTagsForSteward(
  tx: Prisma.TransactionClient,
  sessionId: string
): Promise<{ eventsUpdated: number; crossingsMoved: number }> {
  const sessions = await tx.session.findMany({
    where: {
      OR: [{ id: sessionId }, { parentSessionId: sessionId }],
      taskId: null,
    },
    select: { id: true },
  })
  const sessionIds = sessions.map(s => s.id)
  if (sessionIds.length === 0) return { eventsUpdated: 0, crossingsMoved: 0 }
  const tagged = await tx.hookEvent.findMany({
    where: { sessionId: { in: sessionIds }, taskId: { not: null } },
    select: { id: true, taskId: true },
  })
  if (tagged.length === 0) return { eventsUpdated: 0, crossingsMoved: 0 }
  const crossingsMoved = await moveOpenCrossingsForEvents(
    tx,
    tagged.map(e => ({ eventId: e.id, fromTaskId: e.taskId, toTaskId: null }))
  )
  let eventsUpdated = 0
  for (let i = 0; i < tagged.length; i += ID_CHUNK) {
    const { count } = await tx.hookEvent.updateMany({
      where: { id: { in: tagged.slice(i, i + ID_CHUNK).map(e => e.id) } },
      data: { taskId: null },
    })
    eventsUpdated += count
  }
  return { eventsUpdated, crossingsMoved }
}
