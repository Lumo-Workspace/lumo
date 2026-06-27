import { acceptanceCriterionRepository } from '@/lib/repositories/acceptance-criterion.repository'
import {
  taskCriteriaSnapshotRepository,
  type SnapshotCriterion,
} from '@/lib/repositories/task-criteria-snapshot.repository'
import { logger } from '@/lib/logger'

export interface RecordDeliveryOptions {
  sessionId?: string | null
  /** Why the freeze fired; defaults to the IN_REVIEW transition. */
  trigger?: string
}

/**
 * LUM-609 (fidelity premise A): freeze the acceptance contract at delivery.
 *
 * `recordDeliverySnapshot` reads the full active criteria set and appends an
 * immutable `TaskCriteriaSnapshot`. The caller (the verification service, on a
 * fresh IN_REVIEW transition) calls it once per delivery; a reopen→re-deliver
 * appends another row. Nothing is ever mutated in place — the append-only
 * property lives in the repository (no update/delete path).
 *
 * `loadAsOf` returns the contract as it stood at a given time, so a fidelity
 * comparison reads delivery-time truth, not the since-edited `latest`.
 */
export const taskCriteriaSnapshotService = {
  async recordDeliverySnapshot(
    taskId: string,
    opts: RecordDeliveryOptions = {}
  ): Promise<void> {
    // Best-effort, like the LUM-597 claim freeze: an audit snapshot must never
    // fail the verification round that triggered it. Swallow + warn.
    try {
      const live = await acceptanceCriterionRepository.listByTask(taskId)
      const criteria: SnapshotCriterion[] = live.map(c => ({
        id: c.id,
        statement: c.statement,
        verifierType: c.verifierType,
        checkpointer: c.checkpointer ?? null,
        referentKind: c.referentKind ?? null,
        evidenceRequired: c.evidenceRequired ?? false,
      }))
      await taskCriteriaSnapshotRepository.insert({
        taskId,
        sessionId: opts.sessionId ?? null,
        trigger: opts.trigger ?? 'IN_REVIEW_ENTRY',
        criteria,
      })
    } catch (err) {
      logger.warn(
        `[task-criteria-snapshot] failed to freeze contract for task ${taskId}`,
        err
      )
    }
  },

  async loadAsOf(taskId: string, at: Date) {
    return taskCriteriaSnapshotRepository.findActiveAsOf(taskId, at)
  },
}
