import { prisma } from '@/lib/db/prisma'
import type { Prisma } from '@prisma/client'

/** Replay-sufficient shape of one criterion frozen into a delivery snapshot. */
export interface SnapshotCriterion {
  id: string
  statement: string
  verifierType: string
  checkpointer: string | null
  referentKind: string | null
  evidenceRequired: boolean
}

export interface InsertSnapshotInput {
  taskId: string
  sessionId: string | null
  trigger: string
  /** Full active criteria set frozen at delivery (replay-sufficient). */
  criteria: SnapshotCriterion[]
}

/**
 * LUM-609: append-only by contract. A `TaskCriteriaSnapshot` is the
 * delivery-time freeze of the acceptance contract, written when a task enters
 * IN_REVIEW. This repository deliberately exposes NO update / delete path — a
 * snapshot is immutable once written. The CRITERION_CHANGED TaskActivity trail
 * remains the mutable-criteria audit (Step 0 backstop); this table is the
 * point-in-time (as-of) replay anchor that lets a fidelity comparison read the
 * contract AS IT STOOD AT DELIVERY rather than the since-edited `latest`.
 */
export const taskCriteriaSnapshotRepository = {
  async insert(input: InsertSnapshotInput, tx?: Prisma.TransactionClient) {
    const client = tx ?? prisma
    return client.taskCriteriaSnapshot.create({
      data: {
        taskId: input.taskId,
        sessionId: input.sessionId,
        trigger: input.trigger,
        // The frozen criteria are plain JSON-serialisable objects; the single
        // cast to Prisma's JSON input type is contained here at the DB boundary.
        criteria: input.criteria as unknown as Prisma.InputJsonValue,
      },
      select: { id: true, frozenAt: true },
    })
  },

  /**
   * Every delivery snapshot for a task, oldest first. Read-only feed for the
   * LUM-610 fidelity change-pattern read-out, which folds each frozen contract
   * into a grounding + independence composition. `criteria` comes back as the
   * stored JSON; the caller casts it to {@link SnapshotCriterion}[].
   */
  async listByTask(taskId: string) {
    return prisma.taskCriteriaSnapshot.findMany({
      where: { taskId },
      orderBy: { frozenAt: 'asc' },
      select: {
        id: true,
        frozenAt: true,
        trigger: true,
        sessionId: true,
        criteria: true,
      },
    })
  },

  /**
   * The snapshot ACTIVE at time `at` = the latest freeze with `frozenAt <= at`.
   * Returns null if the task had no frozen contract by then.
   *
   * Snapshots per task are few (one per delivery), so we fetch the task's set
   * and apply the as-of selection in code via {@link selectActiveAsOf} — that
   * keeps the "active-at-T, not latest-overall" semantics in one pure, directly
   * testable function rather than buried in a query that needs a live DB to
   * exercise.
   */
  async findActiveAsOf(taskId: string, at: Date) {
    const rows = await prisma.taskCriteriaSnapshot.findMany({
      where: { taskId },
    })
    return selectActiveAsOf(rows, at)
  },
}

/**
 * Pure as-of selection: the snapshot active at `at` is the latest one frozen
 * at or before `at` — NOT the latest snapshot overall. Reading `latest` instead
 * of as-of-delivery is exactly the self-confirming trap this premise removes:
 * it would let a contract edited AFTER delivery redefine what "matched".
 */
export function selectActiveAsOf<T extends { frozenAt: Date }>(
  snapshots: readonly T[],
  at: Date
): T | null {
  let active: T | null = null
  for (const s of snapshots) {
    if (s.frozenAt.getTime() > at.getTime()) continue
    if (active === null || s.frozenAt.getTime() > active.frozenAt.getTime()) {
      active = s
    }
  }
  return active
}
