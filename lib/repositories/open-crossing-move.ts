import type { Prisma } from '@prisma/client'

/** Bind-parameter headroom for `IN (...)` id lists. */
export const ID_CHUNK = 5000

/**
 * Interactive-transaction limits for the attribution retag/recompute writes:
 * a large family can touch thousands of events, beyond Prisma's 5s default.
 */
export const RETAG_TX_OPTIONS = { timeout: 15_000, maxWait: 5_000 } as const

/** One event's task attribution change. */
export interface EventTaskMove {
  eventId: string
  fromTaskId: string | null
  toTaskId: string | null
}

/**
 * LUM-932 P3: move the UNDISPOSITIONED boundary crossings of events whose
 * task attribution changed to the event's new task (null when the new
 * attribution is null). Dispositioned crossings stay where they were ruled.
 *
 * `hookEventId` has no index, so every update is also narrowed by
 * `taskId IN (<old task ids>)` (the `[taskId, disposition]` index). An event
 * whose old taskId was null cannot own a task-scoped crossing — those events
 * (and with them task-less steward crossings) are skipped.
 *
 * The old-taskId narrowing relies on a crossing's taskId mirroring its
 * event's taskId at creation (and both moving together afterwards); a
 * crossing filed under a different task than its event is not moved.
 *
 * Runs inside the caller's transaction; returns the crossings moved.
 */
export async function moveOpenCrossingsForEvents(
  tx: Prisma.TransactionClient,
  moves: EventTaskMove[]
): Promise<number> {
  const byTarget = new Map<string | null, EventTaskMove[]>()
  for (const m of moves) {
    if (m.fromTaskId === null || m.fromTaskId === m.toTaskId) continue
    const list = byTarget.get(m.toTaskId)
    if (list) list.push(m)
    else byTarget.set(m.toTaskId, [m])
  }
  let moved = 0
  for (const [toTaskId, group] of byTarget) {
    for (let i = 0; i < group.length; i += ID_CHUNK) {
      const chunk = group.slice(i, i + ID_CHUNK)
      const fromTaskIds = [...new Set(chunk.map(m => m.fromTaskId as string))]
      const { count } = await tx.boundaryCrossing.updateMany({
        where: {
          taskId: { in: fromTaskIds },
          disposition: null,
          hookEventId: { in: chunk.map(m => m.eventId) },
        },
        data: { taskId: toTaskId },
      })
      moved += count
    }
  }
  return moved
}
