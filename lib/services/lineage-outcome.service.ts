import { waitUntil } from '@vercel/functions'
import { lineageEdgeRepository } from '@/lib/repositories/lineage-edge.repository'
import { verificationRunRepository } from '@/lib/repositories/verification-run.repository'

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
    if (outcome === 'MERGED') {
      const verified = await verificationRunRepository.hasAllPassRound(taskId)
      return lineageEdgeRepository.stampOutcomeByTask(taskId, outcome, {
        verified,
      })
    }
    return lineageEdgeRepository.stampOutcomeByTask(taskId, outcome)
  },

  /**
   * Stamp MERGED when a task reaches DONE. A task may be completed without a
   * tracked PR (manual done, squash outside Lumo), so DONE is treated as the
   * task-level success terminal — the same verdict a merged PR produces.
   *
   * LUM-397 strength: MERGED is stratified by whether the task ever recorded
   * an all-PASS verification round (ProdCodeBench: merged alone is a weak
   * ground truth). The strength is derived from the append-only
   * VerificationRun log — Task carries no materialized acceptance state —
   * via the same deriveAllPassRoundTaskIds the cron sweep uses, so the two
   * paths cannot drift. Data-only: no scoring path reads the strength yet.
   */
  async stampForTaskDone(taskId: string) {
    const verified = await verificationRunRepository.hasAllPassRound(taskId)
    return lineageEdgeRepository.stampOutcomeByTask(taskId, 'MERGED', {
      verified,
    })
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

  /**
   * Sweep every DONE task's still-open lineage edges to MERGED (LUM-296, DoD
   * ③/⑤). Reconciles edges born *after* their task's terminal event — which the
   * event-forward triggers can never reach. Called by the resident cron; its
   * first post-deploy run backfills the existing UNKNOWN backlog. Idempotent.
   *
   * LUM-397 strength: the sweep derives the all-PASS task set from the same
   * VerificationRun derivation as the immediate task→DONE stamp and
   * reconciles outcomeVerified onto every DONE task's MERGED edges
   * (monotonic — see the repository). Its first post-deploy run stratifies
   * the existing MERGED backlog into verified/unverified.
   */
  async sweepDoneTaskEdges() {
    const verifiedTaskIds =
      await verificationRunRepository.taskIdsWithAllPassRound()
    return lineageEdgeRepository.stampDoneTaskEdges([...verifiedTaskIds])
  },
}

/**
 * Run a lineage-outcome stamp as a detached, best-effort side effect. Stamping
 * must never block or fail its caller — a webhook ack, a task update, a task
 * read — so the work runs under `waitUntil` and any error is swallowed: a
 * missed stamp is self-healing (the poller or a later transition re-stamps,
 * and the stamp is idempotent). This is the single place that owns that
 * detach-and-swallow policy; every trigger site funnels through it.
 *
 * (No dynamic import is needed here: `lineageOutcomeService`'s only transitive
 * dependency is the lineage repository → Prisma, which every trigger module
 * already pulls in statically — unlike the AI-SDK-backed layer2/complexity
 * side effects, which must defer their imports.)
 */
export function stampLineageInBackground(
  stamp: (service: typeof lineageOutcomeService) => Promise<unknown>
): void {
  waitUntil(Promise.resolve(stamp(lineageOutcomeService)).catch(() => {}))
}
