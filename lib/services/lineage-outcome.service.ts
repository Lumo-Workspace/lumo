import { lineageEdgeRepository } from '@/lib/repositories/lineage-edge.repository'

/**
 * Stamps closing outcomes onto a task's lineage edges (DoD ③ "会闭合"). Each
 * method derives a {@link StampableOutcome} from an existing signal and hands
 * off to the repository's monotonic stamp — see `STAMPABLE_FROM` there for the
 * precedence ladder that makes these calls idempotent and safe to fire from
 * multiple, possibly-redundant trigger points (PR webhook + poller).
 *
 * Principle: relevance, not causality. A signal scoped to a task stamps every
 * edge of that task; we do not attribute a verdict to a specific PR/session.
 * Real causal attribution (controlled re-runs) is deferred to v2.
 */
export const lineageOutcomeService = {
  /**
   * Stamp the outcome implied by a PR's terminal state. `merged` → MERGED,
   * `closed` (without merge) → REJECTED. Any other state (notably `open`)
   * is not terminal and no-ops without touching the repository.
   */
  async stampForPrState(taskId: string, state: string) {
    const outcome =
      state === 'merged' ? 'MERGED' : state === 'closed' ? 'REJECTED' : null
    if (!outcome) return { count: 0 }
    return lineageEdgeRepository.stampOutcomeByTask(taskId, outcome)
  },

  /**
   * Stamp MERGED when a task reaches DONE. A task may be completed without a
   * tracked PR (manual done, squash outside Lumo), so DONE is treated as the
   * task-level success terminal — the same verdict a merged PR produces.
   */
  async stampForTaskDone(taskId: string) {
    return lineageEdgeRepository.stampOutcomeByTask(taskId, 'MERGED')
  },

  /**
   * Stamp REWORKED when a DONE task is reopened (e.g. a Sentry regression
   * sends it DONE → TODO). The merged work had to be redone, so its
   * previously-MERGED edges move laterally to REWORKED — the only path that
   * writes this verdict.
   */
  async stampForTaskReopened(taskId: string) {
    return lineageEdgeRepository.stampOutcomeByTask(taskId, 'REWORKED')
  },
}
