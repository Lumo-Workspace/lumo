import { prisma } from '@/lib/db/prisma'

/**
 * Repository for the LUM-603 trust × post-hoc-fate join.
 *
 * Joins each delivery's FROZEN forecast snapshot (TaskForecastSnapshot — the
 * keep-first delivery-time prediction, LUM-319) to its count of post-hoc
 * rejection signals (OutcomeSignal — the falsifier well, LUM-598). Read-only:
 * one SELECT, no business logic (that lives in the service + pure core).
 *
 * Trust axis = the snapshot's frozen verification-friction scalars only
 * (verificationRounds / sendBackCount, LUM-606). Fragment-level trust is
 * deliberately NOT read here: it is not frozen and drifts, so joining its
 * current value to a past delivery would be the drifted-state error the task's
 * 铁律 forbids (debt-a, resolved by the frozen friction axis).
 */

/** One delivery: its frozen friction scalars + how many times reality rejected it. */
export interface DeliveryRejectionRow {
  taskId: string
  /** Frozen verification-friction (LUM-606); null = no verification record by
   *  capture (the no-verification bucket). */
  verificationRounds: number | null
  sendBackCount: number | null
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
        verificationRounds: true,
        sendBackCount: true,
        task: { select: { _count: { select: { outcomeSignals: true } } } },
      },
    })
    return rows.map(r => ({
      taskId: r.taskId,
      verificationRounds: r.verificationRounds,
      sendBackCount: r.sendBackCount,
      signalCount: r.task._count.outcomeSignals,
    }))
  },
}
