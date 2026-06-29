/**
 * CI signal reconciliation (LUM-616). On a commit's CI completion, reads every
 * signal GitHub exposes for that commit, maps each recognized check to an
 * execution gate, and records it as an independent GateSignal for the linked
 * task. This is the independent half of the mechanical-gate audit: the verdict
 * is produced on the CI runner, not scraped from the agent's own tool runs.
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
import { classifyGateName } from '../../shared/src/gate-map'

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
        if (signal.outcome === 'skip') continue
        const gateKey = classifyGateName(signal.name)
        if (!gateKey) continue
        rows.push({
          workspaceId: input.workspaceId,
          taskId: input.taskId,
          gateKey,
          outcome: signal.outcome,
          provenance: 'independent_harness',
          source: signal.source,
          checkName: signal.name,
          detailsUrl: signal.detailsUrl,
          headSha: input.headSha,
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
