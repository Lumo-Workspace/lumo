import { sessionRepository } from '@/lib/repositories/session.repository'
import { runSummaryService } from '@/lib/services/run-summary.service'
import { logger } from '@/lib/logger'

/**
 * LUM-576 one-time backfill: regenerate run-summaries for historical completed
 * (DONE/IN_REVIEW) tasks whose qualified sessions lost their runSummary when
 * generation ran fire-and-forget in the cramped task-route waitUntil.
 *
 * It selects only completed tasks with a qualified-but-missing session (see
 * `listCompletedTaskIdsMissingRunSummary`) and re-runs `generateForTask` per
 * task. Idempotent — a session that already has a runSummary no longer matches
 * the selection, so a second pass over already-summarized sessions finds
 * nothing to do.
 */
export interface BackfillResult {
  /** Completed tasks found with a qualified-but-missing session. */
  candidateTasks: number
  /** Sessions that received a freshly generated runSummary. */
  generated: number
  /** Qualified sessions whose generation errored. */
  failed: number
  /** Tasks whose generation pass reported degraded (observable failure). */
  degradedTasks: number
}

export const runSummaryBackfillService = {
  async backfillCompletedTasks(
    opts: { dryRun?: boolean } = {}
  ): Promise<BackfillResult> {
    const taskIds =
      await sessionRepository.listCompletedTaskIdsMissingRunSummary()

    const result: BackfillResult = {
      candidateTasks: taskIds.length,
      generated: 0,
      failed: 0,
      degradedTasks: 0,
    }

    if (opts.dryRun) {
      logger.info(
        `[run-summary backfill] dry-run — ${taskIds.length} candidate task(s)`
      )
      return result
    }

    for (const taskId of taskIds) {
      const r = await runSummaryService.generateForTask(taskId)
      result.generated += r.generated
      result.failed += r.failed
      if (r.degraded) result.degradedTasks++
    }

    logger.info(
      `[run-summary backfill] done — ${result.candidateTasks} task(s), ` +
        `${result.generated} generated, ${result.failed} failed, ` +
        `${result.degradedTasks} degraded`
    )
    return result
  },
}
