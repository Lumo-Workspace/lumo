import { milestoneRepository } from '@/lib/repositories/milestone.repository'
import { milestoneExitCriterionRepository } from '@/lib/repositories/milestone-exit-criterion.repository'
import {
  deriveRollupStatus,
  computeMilestoneStaleness,
  type MilestoneStaleness,
} from '@/lib/summaries/milestone-rollup'
import { generateMilestoneRetro } from '@/lib/services/milestone.service'
import { waitUntil } from '@vercel/functions'
import type { MilestoneStatus, TaskStatus } from '@prisma/client'

/**
 * LUM-624: milestone status rollup. Keeps a milestone's
 * PLANNED/ACTIVE/COMPLETED lifecycle consistent with its tasks' completion
 * (decision rules in `@/lib/summaries/milestone-rollup`). Event paths (task
 * status / membership changes) dispatch a reconcile; the detail read
 * self-heals stored drift so legacy data converges the first time it is
 * looked at. Everything here is best-effort — a reconcile failure must never
 * break the write or read it piggybacks on.
 */
export const milestoneRollupService = {
  /**
   * Recompute the milestone's task-derived status and persist it when the
   * stored one drifted. The write is guarded on the status we derived from
   * (compare-and-set), so a concurrent manual change — e.g. a human setting
   * CANCELLED — wins over a stale derivation. Auto-completion mirrors the
   * manual COMPLETED transition: stamps `completedAt` and kicks off retro
   * generation; leaving COMPLETED clears `completedAt`.
   */
  async reconcileMilestoneStatus(milestoneId: string): Promise<void> {
    const milestone = await milestoneRepository.findById(milestoneId)
    if (!milestone) return

    const taskCounts = await milestoneRepository.countTasksByStatus(milestoneId)
    // LUM-643: unresolved exit criteria hold the auto-COMPLETED transition
    // shut (fail-closed — a count-read failure aborts the reconcile rather
    // than completing past an unread contract; dispatchRollup swallows it).
    const unresolvedExitCriteria =
      await milestoneExitCriterionRepository.countUnresolved(milestoneId)
    const next = deriveRollupStatus({
      status: milestone.status,
      archived: milestone.archivedAt !== null,
      taskCounts,
      unresolvedExitCriteria,
    })
    if (!next) return

    const applied = await milestoneRepository.updateStatusIfCurrent(
      milestoneId,
      milestone.status,
      {
        status: next,
        completedAt:
          next === 'COMPLETED'
            ? new Date()
            : milestone.status === 'COMPLETED'
              ? null
              : milestone.completedAt,
      }
    )
    if (applied && next === 'COMPLETED') {
      await generateMilestoneRetro(milestoneId)
    }
  },

  /**
   * Fire-and-forget reconcile for every distinct milestone id in the list
   * (nullish entries dropped — callers pass old/new bindings unguarded).
   * Failures are swallowed; the triggering write never waits on this.
   */
  dispatchRollup(...milestoneIds: Array<string | null | undefined>): void {
    const ids = [...new Set(milestoneIds.filter((id): id is string => !!id))]
    for (const id of ids) {
      waitUntil(this.reconcileMilestoneStatus(id).catch(() => {}))
    }
  },

  /**
   * Read-side enrichment + self-heal for the milestone detail read: returns
   * the staleness hints for the payload and, when the stored status drifted
   * from the task-derived one, dispatches a background reconcile so stale
   * legacy rows (the 26/26-DONE-but-PLANNED shape) converge on first view.
   * Async since LUM-643: the exit-criteria gate feeds the drift computation,
   * so an all-tasks-DONE milestone held by unresolved criteria neither shows
   * a lying "auto-updating to COMPLETED" hint nor loops reconcile dispatches.
   */
  async observeOnRead(
    milestone: {
      id: string
      status: MilestoneStatus
      archivedAt: Date | null
      targetDate: Date | null
    },
    taskCounts: Record<TaskStatus, number>
  ): Promise<MilestoneStaleness> {
    const unresolvedExitCriteria = await milestoneExitCriterionRepository
      .countUnresolved(milestone.id)
      // Best-effort read enrichment; fail closed (treat as gate-held) so a
      // count failure can't surface a COMPLETED drift the reconcile would
      // then refuse to apply.
      .catch(() => 1)
    const staleness = computeMilestoneStaleness({
      status: milestone.status,
      archived: milestone.archivedAt !== null,
      taskCounts,
      targetDate: milestone.targetDate,
      unresolvedExitCriteria,
    })
    if (staleness.statusDrift) {
      this.dispatchRollup(milestone.id)
    }
    return staleness
  },
}

export type MilestoneRollupService = typeof milestoneRollupService
