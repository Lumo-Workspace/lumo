/**
 * @jest-environment node
 *
 * LUM-1152 follow-up — a manual review asked for while its head's scan is in
 * flight waits for the scan to settle, then is dispatched once (marked
 * `deferred`); a scan that never settles is given up on, not retried forever.
 */
jest.mock('@/lib/db/prisma', () => ({ prisma: {} }))
jest.mock('@/lib/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}))
jest.mock('@/lib/workflows/security-deferred-review.steps', () => ({
  isScanSettledStep: jest.fn(),
  dispatchDeferredReviewStep: jest.fn(),
}))
jest.mock('@/ee/security/repositories/pr-security-scan.repository', () => ({
  prSecurityScanRepository: { findManualRestartState: jest.fn() },
}))
jest.mock('@/ee/security/services/pr-security-scan-dispatch', () => ({
  dispatchPrSecurityScan: jest.fn(),
}))

import { sleep } from 'workflow'
import { start } from 'workflow/api'
import {
  securityDeferredReviewWorkflow,
  DEFERRED_REVIEW_INTERVAL,
  DEFERRED_REVIEW_MAX_WAITS,
} from '@/lib/workflows/security-deferred-review'
import {
  dispatchDeferredReviewStep,
  isScanSettledStep,
} from '@/lib/workflows/security-deferred-review.steps'
import { deferredReviewService } from '@/ee/security/services/security-deferred-review.service'
import { startDeferredManualReview } from '@/ee/security/services/security-deferred-review-start'
import { isSettledForManualReview } from '@/ee/security/security-scan/review-control'
import { prSecurityScanRepository } from '@/ee/security/repositories/pr-security-scan.repository'
import { dispatchPrSecurityScan } from '@/ee/security/services/pr-security-scan-dispatch'

const m = <T>(fn: T) => fn as unknown as jest.Mock
const job = { pullRequestId: 'pr1', scanId: 's1', reviewMode: 'full' as const }

beforeEach(() => jest.clearAllMocks())

describe('isSettledForManualReview', () => {
  const row = (over: object) => ({
    status: 'CLEAN',
    stages: { secrets: 'RAN', judge: 'PAUSED', hunt: 'PAUSED' },
    verifierStartedAt: null,
    verifiedAt: null,
    ...over,
  })
  test('a finished scan whose AI layers are held is settled', () => {
    expect(isSettledForManualReview(row({}))).toBe(true)
    expect(isSettledForManualReview(row({ status: 'FAILED' }))).toBe(true)
  })
  test('managed scanners still PENDING = in flight', () => {
    expect(
      isSettledForManualReview(
        row({ stages: { external: 'PENDING', judge: 'PAUSED' } })
      )
    ).toBe(false)
  })
  test('running, or a verifier mid-run, = in flight; no row = not restartable', () => {
    expect(isSettledForManualReview(row({ status: 'RUNNING' }))).toBe(false)
    expect(
      isSettledForManualReview(row({ verifierStartedAt: new Date() }))
    ).toBe(false)
    expect(isSettledForManualReview(null)).toBe(false)
  })
})

describe('securityDeferredReviewWorkflow', () => {
  test('waits until the scan settles, then dispatches once', async () => {
    m(isScanSettledStep)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true)
    const out = await securityDeferredReviewWorkflow(job)
    expect(out).toEqual({ outcome: 'DISPATCHED', waits: 3 })
    expect(m(sleep)).toHaveBeenCalledWith(DEFERRED_REVIEW_INTERVAL)
    expect(m(dispatchDeferredReviewStep)).toHaveBeenCalledTimes(1)
    expect(m(dispatchDeferredReviewStep)).toHaveBeenCalledWith('pr1', 'full')
  })

  test('gives up on a scan that never settles', async () => {
    m(isScanSettledStep).mockResolvedValue(false)
    const out = await securityDeferredReviewWorkflow(job)
    expect(out).toEqual({
      outcome: 'GAVE_UP',
      waits: DEFERRED_REVIEW_MAX_WAITS,
    })
    expect(m(dispatchDeferredReviewStep)).not.toHaveBeenCalled()
  })
})

describe('deferredReviewService', () => {
  test('reads the row; a missing row counts as settled', async () => {
    m(prSecurityScanRepository.findManualRestartState).mockResolvedValueOnce({
      status: 'CLEAN',
      stages: { external: 'PENDING' },
      verifierStartedAt: null,
      verifiedAt: null,
    })
    await expect(deferredReviewService.isScanSettled('s1')).resolves.toBe(false)
    m(prSecurityScanRepository.findManualRestartState).mockResolvedValueOnce(
      null
    )
    await expect(deferredReviewService.isScanSettled('s1')).resolves.toBe(true)
  })

  test('dispatches the review marked deferred', async () => {
    await deferredReviewService.dispatch('pr1', 'incremental')
    expect(m(dispatchPrSecurityScan)).toHaveBeenCalledWith(
      'pr1',
      'PR_EVENT',
      'incremental',
      { deferred: true }
    )
  })
})

describe('startDeferredManualReview', () => {
  test('starts the workflow with the job', async () => {
    m(start).mockResolvedValueOnce({ runId: 'wrun_1' })
    await expect(startDeferredManualReview(job)).resolves.toBe(true)
    expect(m(start)).toHaveBeenCalledWith(securityDeferredReviewWorkflow, [job])
  })
  test('never throws', async () => {
    m(start).mockRejectedValueOnce(new Error('queue down'))
    await expect(startDeferredManualReview(job)).resolves.toBe(false)
  })
})
