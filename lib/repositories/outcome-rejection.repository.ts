import { prisma } from '@/lib/db/prisma'

/**
 * Repository for the LUM-603 trust × post-hoc-fate join.
 *
 * Joins each delivery's FROZEN forecast snapshot (TaskForecastSnapshot — the
 * keep-first delivery-time prediction, LUM-319) to its count of post-hoc
 * rejection signals (OutcomeSignal — the falsifier well, LUM-598). Read-only:
 * one SELECT, no business logic (that lives in the service + pure core).
 *
 * Trust axis = the snapshot's frozen confidence inputs only (cohortSize /
 * tokenCostBasis). Fragment-level trust is deliberately NOT read here: it is not
 * frozen and drifts, so joining its current value to a past delivery would be
 * the drifted-state error the task's 铁律 forbids (debt-a, deferred).
 */

/** One delivery: its frozen confidence inputs + how many times reality rejected it. */
export interface DeliveryRejectionRow {
  taskId: string
  cohortSize: number
  tokenCostBasis: number
  /** Count of OutcomeSignal rows for the task. >0 ⇒ REJECTED, 0 ⇒ INCONCLUSIVE. */
  signalCount: number
}

export const outcomeRejectionRepository = {
  /**
   * Every snapshotted delivery in the workspace, joined to its outcome-signal
   * count. Scoped via task→project→workspace; deliveries with no snapshot are
   * absent (they were never frozen, so they carry no delivery-time trust).
   */
  async listDeliveriesWithRejection(
    workspaceId: string
  ): Promise<DeliveryRejectionRow[]> {
    const rows = await prisma.taskForecastSnapshot.findMany({
      where: { task: { project: { workspaceId } } },
      select: {
        taskId: true,
        cohortSize: true,
        tokenCostBasis: true,
        task: { select: { _count: { select: { outcomeSignals: true } } } },
      },
    })
    return rows.map(r => ({
      taskId: r.taskId,
      cohortSize: r.cohortSize,
      tokenCostBasis: r.tokenCostBasis,
      signalCount: r.task._count.outcomeSignals,
    }))
  },
}
