/** @jest-environment node */
jest.mock('@/lib/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}))
jest.mock('@/lib/repositories/pr-security-scan.repository', () => ({
  prSecurityScanRepository: {
    findStaleVerifierHolds: jest.fn(),
    claimStaleVerifierHold: jest.fn(),
  },
}))
jest.mock('@/lib/services/security-pr-review.service', () => ({
  securityPrReviewService: { sync: jest.fn() },
}))

import { prSecurityScanRepository as repo } from '@/lib/repositories/pr-security-scan.repository'
import { securityPrReviewService } from '@/lib/services/security-pr-review.service'
import {
  VERIFIER_SWEEP_LIMIT,
  reviewVerifierOpsService,
} from '@/lib/services/review-verifier-ops.service'
import { VERIFIER_HOLD_MS } from '@/lib/security-scan/verifier'

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

  it('the hold window covers the worst-case run (8 minutes)', () => {
    expect(VERIFIER_HOLD_MS).toBe(8 * 60_000)
  })
})
