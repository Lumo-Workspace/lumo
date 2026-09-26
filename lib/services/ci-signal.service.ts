/**
 * CI signal reconciliation (LUM-616). On a commit's CI completion, reads every
 * signal GitHub exposes for that commit and records each completed check as an
 * independent GateSignal for the linked task, under the check's own name
 * (LUM-839: zero-config — no translation into typecheck/build/test keys, so a
 * check like "Vercel" or "lint-and-format" is kept, not dropped). This is the
 * independent half of the delivery checks panel: the verdict is produced on the
 * CI runner, not scraped from the agent's own tool runs.
 *
 * Fail-soft by contract — it runs detached from webhook ingestion (waitUntil),
 * so any error is logged and swallowed; it must never break the webhook. It is a
 * no-op when the commit maps to no task (e.g. a push to a non-task branch).
 */

import { logger } from '@/lib/logger'
import {
  gateSignalRepository,
  type NewGateSignal,
} from '@/lib/repositories/gate-signal.repository'

// `./checks` statically imports the GitHub auth client (@octokit/auth-app, ESM),
// which is hostile to load in jest and would crash any test that merely imports a
// module transitively pulling this service (e.g. the webhook handlers). Load it
// lazily inside reconcileCommit so importing this module stays side-effect-free.

export const ciSignalService = {
  async reconcileCommit(input: {
    workspaceId: string
    repo: string
    headSha: string
    taskId: string | null
    /**
     * LUM-617: the PR this commit's CI belongs to, resolved at the webhook (from
     * check_suite.pull_requests, or the head branch for status events). Null when
     * the commit maps to no PR. Stored on each signal so the audit can group
     * gates by PR.
     */
    prNumber?: number | null
  }): Promise<void> {
    if (!input.taskId) return
    try {
      const { fetchCommitCiSignals } =
        await import('@/lib/integrations/github/checks')
      const signals = await fetchCommitCiSignals({
        workspaceId: input.workspaceId,
        fullName: input.repo,
        sha: input.headSha,
      })

      const rows: NewGateSignal[] = []
      for (const signal of signals) {
        // Pending / neutral / skipped — not a result yet, nothing to record.
        if (signal.outcome === 'skip') continue
        // LUM-838: a check that never executed is recorded as not_run — shown
        // as "did not run", never as a failure — with a trace of why.
        if (signal.outcome === 'not_run') {
          logger.info(
            `[ci-signal] ${input.repo}@${input.headSha} check "${signal.name}" — CI did not run: ${signal.notRunReason ?? 'unknown reason'}`
          )
        }
        rows.push({
          workspaceId: input.workspaceId,
          taskId: input.taskId,
          gateKey: null,
          outcome: signal.outcome,
          provenance: 'independent_harness',
          source: signal.source,
          checkName: signal.name,
          detailsUrl: signal.detailsUrl,
          headSha: input.headSha,
          prNumber: input.prNumber ?? null,
        })
      }

      if (rows.length > 0) await gateSignalRepository.createMany(rows)
    } catch (err) {
      logger.error(
        `[ci-signal] reconcileCommit failed for ${input.repo}@${input.headSha}: ${err}`
      )
    }
  },
}
