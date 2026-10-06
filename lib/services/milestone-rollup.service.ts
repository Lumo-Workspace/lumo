import { milestoneRepository } from '@/lib/repositories/milestone.repository'
import { milestoneExitCriterionRepository } from '@/lib/repositories/milestone-exit-criterion.repository'
import {
  deriveCompletionChange,
  computeMilestoneStaleness,
  type MilestoneStaleness,
} from '@/lib/summaries/milestone-rollup'
import { generateMilestoneRetro } from '@/lib/services/milestone.service'
import { waitUntil } from '@/lib/runtime/wait-until'
import type { TaskStatus } from '@prisma/client'

/**
 * LUM-624: milestone completion rollup. Keeps a milestone's `completedAt`
 * consistent with its tasks' completion (decision rules in
 * `@/lib/summaries/milestone-rollup`). Since LUM-714 completion is the only
 * thing rolled up — there is no stored status — so this writes a single
 * timestamp and nothing else. Event paths (task status / membership changes)
 * dispatch a reconcile; the detail read self-heals stored drift so legacy data
 * converges the first time it is looked at. Everything here is best-effort — a
 * reconcile failure must never break the write or read it piggybacks on.
 */
export const milestoneRollupService = {
  /**
   * Recompute the milestone's task-derived completion and persist it when the
   * stored stamp drifted. The write is guarded on the `completedAt` we derived
   * from (compare-and-set), so a concurrent write wins over a stale
   * derivation. Completing stamps `completedAt` and kicks off retro
   * generation; reopening clears it.
   */
  async reconcileMilestoneCompletion(milestoneId: string): Promise<void> {
    const milestone = await milestoneRepository.findById(milestoneId)
    if (!milestone) return

    const taskCounts = await milestoneRepository.countTasksByStatus(milestoneId)
    // LUM-643: unresolved exit criteria hold the auto-completion shut
    // (fail-closed — a count-read failure aborts the reconcile rather than
    // completing past an unread contract; dispatchRollup swallows it).
    const unresolvedExitCriteria =
      await milestoneExitCriterionRepository.countUnresolved(milestoneId)
    const change = deriveCompletionChange({
      completedAt: milestone.completedAt,
      archived: milestone.archivedAt !== null,
      taskCounts,
      unresolvedExitCriteria,
    })
    if (!change) return

    const applied = await milestoneRepository.updateCompletionIfCurrent(
      milestoneId,
      milestone.completedAt,
      change === 'complete' ? new Date() : null
    )
    if (applied && change === 'complete') {
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
      waitUntil(this.reconcileMilestoneCompletion(id).catch(() => {}))
    }
  },

  /**
   * Read-side enrichment + self-heal for the milestone detail read: returns
   * the staleness hints for the payload and, when the stored completion
   * drifted from the task-derived one, dispatches a background reconcile so
   * stale legacy rows (the 26/26-DONE-but-never-stamped shape) converge on
   * first view. Async since LUM-643: the exit-criteria gate feeds the drift
   * computation, so an all-tasks-DONE milestone held by unresolved criteria
   * neither reports a completion it will refuse to apply nor loops reconcile
   * dispatches.
   */
  async observeOnRead(
    milestone: {
      id: string
      completedAt: Date | null
      archivedAt: Date | null
      targetDate: Date | null
    },
    taskCounts: Record<TaskStatus, number>
  ): Promise<MilestoneStaleness> {
    const unresolvedExitCriteria = await milestoneExitCriterionRepository
      .countUnresolved(milestone.id)
      // Best-effort read enrichment; fail closed (treat as gate-held) so a
      // count failure can't surface a completion drift the reconcile would
      // then refuse to apply.
      .catch(() => 1)
    const staleness = computeMilestoneStaleness({
      completedAt: milestone.completedAt,
      archived: milestone.archivedAt !== null,
      taskCounts,
      targetDate: milestone.targetDate,
      unresolvedExitCriteria,
    })
    if (staleness.completionDrift) {
      this.dispatchRollup(milestone.id)
    }
    return staleness
  },
}

export type MilestoneRollupService = typeof milestoneRollupService
