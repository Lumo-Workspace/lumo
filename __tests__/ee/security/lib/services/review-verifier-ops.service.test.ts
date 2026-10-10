/** @jest-environment node */
jest.mock('@/lib/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}))
jest.mock('@/ee/security/repositories/pr-security-scan.repository', () => ({
  prSecurityScanRepository: {
    findStaleVerifierHolds: jest.fn(),
    claimStaleVerifierHold: jest.fn(),
  },
}))
jest.mock('@/ee/security/services/security-pr-review.service', () => ({
  securityPrReviewService: { sync: jest.fn() },
}))

import { prSecurityScanRepository as repo } from '@/ee/security/repositories/pr-security-scan.repository'
import { securityPrReviewService } from '@/ee/security/services/security-pr-review.service'
import {
  VERIFIER_SWEEP_LIMIT,
  reviewVerifierOpsService,
} from '@/ee/security/services/review-verifier-ops.service'
import { VERIFIER_HOLD_MS } from '@/ee/security/security-scan/verifier'

describe('LUM-988 stale verifier hold sweep', () => {
  it('releases only holds older than the window that it wins the claim on, and syncs each', async () => {
    const now = Date.parse('2026-10-05T12:00:00Z')
    ;(repo.findStaleVerifierHolds as jest.Mock).mockResolvedValue(['a', 'b'])
    ;(repo.claimStaleVerifierHold as jest.Mock).mockImplementation(
      async (id: string) => id === 'a'
    )
    const out = await reviewVerifierOpsService.sweepStaleHolds(now)
    const cutoff = new Date(now - VERIFIER_HOLD_MS)
    expect(repo.findStaleVerifierHolds).toHaveBeenCalledWith(
      cutoff,
      VERIFIER_SWEEP_LIMIT
    )
    expect(repo.claimStaleVerifierHold).toHaveBeenCalledWith('a', cutoff)
    expect(repo.claimStaleVerifierHold).toHaveBeenCalledWith('b', cutoff)
    // 'b' was stamped by its verifier in the meantime: not synced here.
    expect(securityPrReviewService.sync).toHaveBeenCalledTimes(1)
    expect(securityPrReviewService.sync).toHaveBeenCalledWith('a')
    expect(out).toEqual({ released: 1 })
  })

  it('the hold window covers the worst-case run, ranker included (9 minutes)', () => {
    expect(VERIFIER_HOLD_MS).toBe(9 * 60_000)
  })
})
