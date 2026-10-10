/**
 * LUM-988 — the stale-hold sweep. The PR write-back holds the inline
 * comments of verifiable AI-review findings while the agentic verifier runs;
 * the verifier always stamps `verifiedAt` and re-syncs, but a run or step the
 * platform lost never does, and an expired hold is otherwise only noticed by
 * the next push's sync. Every 15 minutes (`sweep-security-scans`), a scan
 * whose hold is older than VERIFIER_HOLD_MS and still unstamped is released
 * (stamped with no verdicts) and its PR comments re-synced: the findings post
 * unverified — late, never lost.
 */
import { logger } from '@/lib/logger'
import { prSecurityScanRepository } from '@/ee/security/repositories/pr-security-scan.repository'
import { VERIFIER_HOLD_MS } from '@/ee/security/security-scan/verifier'
import { securityPrReviewService } from './security-pr-review.service'

/** Scans released per run; each is one GitHub sync. */
export const VERIFIER_SWEEP_LIMIT = 25

export const reviewVerifierOpsService = {
  async sweepStaleHolds(
    now: number = Date.now()
  ): Promise<{ released: number }> {
    const cutoff = new Date(now - VERIFIER_HOLD_MS)
    const ids = await prSecurityScanRepository.findStaleVerifierHolds(
      cutoff,
      VERIFIER_SWEEP_LIMIT
    )
    let released = 0
    for (const id of ids) {
      if (!(await prSecurityScanRepository.claimStaleVerifierHold(id, cutoff)))
        continue
      released++
      logger.warn(
        `[review-verifier-ops] released stale verifier hold scan=${id}`
      )
      await securityPrReviewService.sync(id)
    }
    return { released }
  },
}
