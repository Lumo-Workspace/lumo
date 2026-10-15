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
  decideDeferredReviewStep: jest.fn(),
  dispatchDeferredReviewStep: jest.fn(),
  giveUpDeferredReviewStep: jest.fn(),
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
  decideDeferredReviewStep,
  dispatchDeferredReviewStep,
  giveUpDeferredReviewStep,
} from '@/lib/workflows/security-deferred-review.steps'
import { deferredReviewService } from '@/ee/security/services/security-deferred-review.service'
import { startDeferredManualReview } from '@/ee/security/services/security-deferred-review-start'
import {
  deferredReviewDecision,
  isSettledForManualReview,
} from '@/ee/security/security-scan/review-control'
import { prSecurityScanRepository } from '@/ee/security/repositories/pr-security-scan.repository'
import { dispatchPrSecurityScan } from '@/ee/security/services/pr-security-scan-dispatch'
import { logger } from '@/lib/logger'

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

describe('deferredReviewDecision', () => {
  const row = (over: object) => ({
    status: 'CLEAN',
    stages: { secrets: 'RAN', judge: 'PAUSED', hunt: 'PAUSED' },
    verifierStartedAt: null,
    verifiedAt: null,
    ...over,
  })
  test('held AI review (ignore / pause / cap) once settled = dispatch', () => {
    expect(deferredReviewDecision(row({}), 'incremental')).toBe('dispatch')
  })
  test('still in flight = wait', () => {
    expect(
      deferredReviewDecision(
        row({ stages: { external: 'PENDING', judge: 'PAUSED' } }),
        'incremental'
      )
    ).toBe('wait')
  })
  test("the scan's own AI review ran = covered (no second review)", () => {
    expect(
      deferredReviewDecision(
        row({ stages: { judge: 'RAN', hunt: 'RAN' } }),
        'incremental'
      )
    ).toBe('covered')
  })
  test('an AI review that failed or was skipped does not cover the request', () => {
    expect(
      deferredReviewDecision(
        row({ stages: { judge: 'FAILED' } }),
        'incremental'
      )
    ).toBe('dispatch')
    expect(
      deferredReviewDecision(
        row({ stages: { judge: 'SKIPPED' } }),
        'incremental'
      )
    ).toBe('dispatch')
    expect(
      deferredReviewDecision(
        row({ stages: { judge: 'PARTIAL' } }),
        'incremental'
      )
    ).toBe('covered')
  })
  test('user ruling: a deferred FULL review runs unless the waited-on review was itself full', () => {
    const ran = { stages: { judge: 'RAN', hunt: 'RAN' } }
    expect(
      deferredReviewDecision(
        row({ ...ran, judgeReviewMode: 'incremental' }),
        'full'
      )
    ).toBe('dispatch')
    expect(
      deferredReviewDecision(row({ ...ran, judgeReviewMode: null }), 'full')
    ).toBe('dispatch')
    expect(
      deferredReviewDecision(row({ ...ran, judgeReviewMode: 'full' }), 'full')
    ).toBe('covered')
    // An incremental request is satisfied by any review that ran.
    expect(
      deferredReviewDecision(
        row({ ...ran, judgeReviewMode: 'incremental' }),
        'incremental'
      )
    ).toBe('covered')
  })
  test('a missing or FAILED scan = dispatch', () => {
    expect(deferredReviewDecision(null, 'incremental')).toBe('dispatch')
    expect(
      deferredReviewDecision(
        row({ status: 'FAILED', stages: { judge: 'RAN' } }),
        'incremental'
      )
    ).toBe('dispatch')
  })
})

describe('securityDeferredReviewWorkflow', () => {
  test('waits until the scan settles, then dispatches once', async () => {
    m(decideDeferredReviewStep)
      .mockResolvedValueOnce('wait')
      .mockResolvedValueOnce('wait')
      .mockResolvedValueOnce('dispatch')
    const out = await securityDeferredReviewWorkflow(job)
    expect(out).toEqual({ outcome: 'DISPATCHED', waits: 3 })
    expect(m(sleep)).toHaveBeenCalledWith(DEFERRED_REVIEW_INTERVAL)
    expect(m(dispatchDeferredReviewStep)).toHaveBeenCalledTimes(1)
    expect(m(dispatchDeferredReviewStep)).toHaveBeenCalledWith('pr1', 'full')
  })

  test("does nothing when the scan's own AI review ran", async () => {
    m(decideDeferredReviewStep).mockResolvedValueOnce('covered')
    const out = await securityDeferredReviewWorkflow(job)
    expect(out).toEqual({ outcome: 'COVERED', waits: 1 })
    expect(m(dispatchDeferredReviewStep)).not.toHaveBeenCalled()
  })

  test('gives up (and says so) on a scan that never settles', async () => {
    m(decideDeferredReviewStep).mockResolvedValue('wait')
    const out = await securityDeferredReviewWorkflow(job)
    expect(out).toEqual({
      outcome: 'GAVE_UP',
      waits: DEFERRED_REVIEW_MAX_WAITS,
    })
    expect(m(dispatchDeferredReviewStep)).not.toHaveBeenCalled()
    expect(m(giveUpDeferredReviewStep)).toHaveBeenCalledWith('s1', 'full')
  })
})

describe('deferredReviewService', () => {
  test('decides from the stored row', async () => {
    m(prSecurityScanRepository.findManualRestartState).mockResolvedValueOnce({
      status: 'CLEAN',
      stages: { external: 'PENDING' },
      verifierStartedAt: null,
      verifiedAt: null,
    })
    await expect(deferredReviewService.decide('s1', 'full')).resolves.toBe(
      'wait'
    )
    m(prSecurityScanRepository.findManualRestartState).mockResolvedValueOnce(
      null
    )
    await expect(deferredReviewService.decide('s1', 'full')).resolves.toBe(
      'dispatch'
    )
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

  test('giving up is logged', () => {
    deferredReviewService.giveUp('s1', 'full')
    expect(m(logger.warn)).toHaveBeenCalledWith(
      expect.stringContaining('gave up scan=s1')
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
