import { logger } from '@/lib/logger'
import { createSlidingWindowRateLimiter } from '@/lib/services/sliding-window-rate-limit'
import { prReviewControlRepository } from '@/ee/security/repositories/pr-review-control.repository'
import { securityColumnsRepository } from '@/ee/security/repositories/security-columns.repository'
import { admitAutomaticReview } from '@/ee/security/security-scan/review-control'
import { prCommitCountBestEffort } from './pr-commit-count'

/**
 * LUM-1137 — may this push get an automatic AI review (and exploit-path
 * discovery)? Every push is reviewed until the PR has N reviewed commits
 * (`review-control.ts`; N = the PR's `--resume --limit`, else the workspace's
 * `securityReviewAutoPauseAfter`, default 5, 0 = never pause).
 *
 * On top of that, an hourly cap per PR author in the workspace — in the
 * spirit of CodeRabbit's per-developer hourly review limits (5–12 per hour by
 * plan) — so a push storm cannot explode cost. Lumo's agents push under one
 * GitHub identity, so the cap sits above CodeRabbit's per-human numbers:
 * Lumo-Workspace/lumo peaked at 18 automatic reviews in one hour over the 30
 * days before LUM-1137. A head over the cap keeps no reservation: the scan
 * says "rate-limited", and the next push after the window (or
 * `@uselumo review`) is reviewed. Only a head this call newly reserved counts — a retry of an
 * admitted head, or a head the budget refused at reservation, does not: the
 * cap is checked after the reservation, and a head over it is released. The
 * limiter fails open (`sliding-window-rate-limit.ts`).
 */
export const AUTO_REVIEW_HOURLY_CAP = { max: 20, windowMs: 60 * 60_000 }

const limiter = createSlidingWindowRateLimiter({
  prefix: 'security:auto-review',
  max: AUTO_REVIEW_HOURLY_CAP.max,
  windowMs: AUTO_REVIEW_HOURLY_CAP.windowMs,
  logTag: 'security-auto-review-rate-limit',
})

export interface AutoReviewAdmission {
  /** The AI review / hunt may run on this head. */
  allowed: boolean
  /** Not allowed because the hourly cap was reached (else: paused). */
  rateLimited: boolean
}

interface AdmissionPr {
  id: string
  workspaceId: string
  repo: string
  number: number
  authorLogin: string
}

export const autoReviewAdmissionService = {
  async admit(pr: AdmissionPr, head: string): Promise<AutoReviewAdmission> {
    const [control, workspaceLimit] = await Promise.all([
      prReviewControlRepository.get(pr.id),
      securityColumnsRepository.findReviewAutoPauseAfter(pr.workspaceId),
    ])
    const decision = admitAutomaticReview(control, head, workspaceLimit)
    if (!decision.allowed) return { allowed: false, rateLimited: false }
    const commitsAtHead = decision.reserve
      ? await prCommitCountBestEffort(pr, head)
      : null
    const { allowed, reserved } = await prReviewControlRepository.reserve(
      pr.id,
      head,
      { commitsAtHead, workspaceLimit }
    )
    if (!allowed) return { allowed: false, rateLimited: false }
    // Only a head this call reserved takes a slot of the hourly cap; over
    // the cap its reservation is returned, so the budget is not spent either.
    if (reserved) {
      const key = `${pr.workspaceId}:${pr.authorLogin.toLowerCase()}`
      if (!(await limiter.check(key))) {
        // Best effort: a failed release leaves one commit reserved (the
        // pre-fix behavior); the head is still rate-limited, not reviewed.
        try {
          await prReviewControlRepository.release(pr.id, head)
        } catch (error) {
          logger.warn(
            `[auto-review-admission] release of rate-limited head failed ${pr.repo}#${pr.number}: ${error instanceof Error ? error.message : error}`
          )
        }
        return { allowed: false, rateLimited: true }
      }
    }
    return { allowed: true, rateLimited: false }
  },
}

/** Test-only: reset the hourly cap between test cases. */
export function __resetAutoReviewRateLimitForTests(): void {
  limiter.reset()
}
