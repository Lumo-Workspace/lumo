/** @jest-environment node */
jest.mock('@/lib/logger', () => ({
  logger: { error: jest.fn(), info: jest.fn(), warn: jest.fn() },
}))
jest.mock('@/lib/repositories/pr-security-scan.repository', () => ({
  prSecurityScanRepository: {
    findPendingManagedByPullRequest: jest.fn(),
    mergeStages: jest.fn(),
    countManagedRunsSince: jest.fn(),
    findStalePendingExternal: jest.fn(),
  },
}))
jest.mock('@/lib/integrations/vercel-sandbox', () => ({
  stopRepoSandboxesByTag: jest.fn(),
}))
jest.mock('@/lib/services/security-managed-scan-cancel', () => ({
  cancelManagedRun: jest.fn(),
}))
jest.mock('@/lib/services/security-pr-review.service', () => ({
  securityPrReviewService: { sync: jest.fn() },
}))

import { prSecurityScanRepository } from '@/lib/repositories/pr-security-scan.repository'
import { stopRepoSandboxesByTag } from '@/lib/integrations/vercel-sandbox'
import { cancelManagedRun } from '@/lib/services/security-managed-scan-cancel'
import { securityPrReviewService } from '@/lib/services/security-pr-review.service'
import {
  securityManagedScanOpsService,
  SWEEP_BATCH_LIMIT,
  SWEEP_REASON,
} from '@/lib/services/security-managed-scan-ops.service'
import { EXTERNAL_PENDING_DEAD_MS } from '@/lib/services/security-managed-scan.config'

const repo = prSecurityScanRepository as jest.Mocked<
  typeof prSecurityScanRepository
>
const stopByTag = stopRepoSandboxesByTag as jest.Mock
const cancel = cancelManagedRun as jest.Mock
const sync = securityPrReviewService.sync as jest.Mock

const NEW_SHA = 'abc1234' + 'f'.repeat(33)

beforeEach(() => {
  jest.clearAllMocks()
  delete process.env.LUMO_MANAGED_SCAN_HOURLY_CAP
  repo.mergeStages.mockResolvedValue(undefined)
  cancel.mockResolvedValue(true)
  stopByTag.mockResolvedValue(1)
  sync.mockResolvedValue({ posted: true, inline: 0, skipped: 0 })
})

describe('supersedeOlderRuns', () => {
  it('stamps SUPERSEDED (+ supplyChain when PENDING) with a prefixed reason BEFORE cancelling and stopping', async () => {
    const order: string[] = []
    repo.mergeStages.mockImplementation(async () => {
      order.push('stamp')
    })
    cancel.mockImplementation(async () => {
      order.push('cancel')
      return true
    })
    stopByTag.mockImplementation(async () => {
      order.push('stop')
      return 1
    })
    repo.findPendingManagedByPullRequest.mockResolvedValue([
      {
        id: 'old1',
        headSha: 'b'.repeat(40),
        managedRunId: 'run_old1',
        stages: { external: 'PENDING', supplyChain: 'PENDING' },
      },
      {
        id: 'old2',
        headSha: 'c'.repeat(40),
        managedRunId: 'run_old2',
        stages: { external: 'PENDING', supplyChain: 'SKIPPED' },
      },
    ])
    const result = await securityManagedScanOpsService.supersedeOlderRuns({
      pullRequestId: 'pr1',
      exceptScanId: 'new',
      newHeadSha: NEW_SHA,
    })
    expect(repo.findPendingManagedByPullRequest).toHaveBeenCalledWith(
      'pr1',
      'new'
    )
    expect(repo.mergeStages).toHaveBeenNthCalledWith(
      1,
      'old1',
      { external: 'SUPERSEDED', supplyChain: 'SUPERSEDED' },
      { error: 'external: superseded by abc1234' }
    )
    expect(repo.mergeStages).toHaveBeenNthCalledWith(
      2,
      'old2',
      { external: 'SUPERSEDED' },
      { error: 'external: superseded by abc1234' }
    )
    expect(cancel).toHaveBeenCalledWith('run_old1', 'old1')
    expect(cancel).toHaveBeenCalledWith('run_old2', 'old2')
    expect(stopByTag).toHaveBeenCalledWith({ lumoScan: 'old1' })
    expect(stopByTag).toHaveBeenCalledWith({ lumoScan: 'old2' })
    expect(order).toEqual([
      'stamp',
      'cancel',
      'stop',
      'stamp',
      'cancel',
      'stop',
    ])
    expect(result).toEqual({ superseded: 2, cancelled: 2, sandboxesStopped: 2 })
  })

  it('a row whose stamp fails keeps its run (no cancel, no stop); the next row still proceeds', async () => {
    repo.findPendingManagedByPullRequest.mockResolvedValue([
      {
        id: 'old1',
        headSha: 'b'.repeat(40),
        managedRunId: 'run_old1',
        stages: { external: 'PENDING' },
      },
      {
        id: 'old2',
        headSha: 'c'.repeat(40),
        managedRunId: 'run_old2',
        stages: { external: 'PENDING' },
      },
    ])
    repo.mergeStages
      .mockRejectedValueOnce(new Error('P1001'))
      .mockResolvedValueOnce(undefined)
    const result = await securityManagedScanOpsService.supersedeOlderRuns({
      pullRequestId: 'pr1',
      exceptScanId: 'new',
      newHeadSha: NEW_SHA,
    })
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(cancel).toHaveBeenCalledWith('run_old2', 'old2')
    expect(result).toEqual({ superseded: 1, cancelled: 1, sandboxesStopped: 1 })
  })

  it('a failed cancel or a throwing sandbox stop never surfaces; counts say what happened', async () => {
    repo.findPendingManagedByPullRequest.mockResolvedValue([
      {
        id: 'old1',
        headSha: 'b'.repeat(40),
        managedRunId: 'run_old1',
        stages: { external: 'PENDING' },
      },
    ])
    cancel.mockResolvedValue(false)
    stopByTag.mockRejectedValue(new Error('list 500'))
    await expect(
      securityManagedScanOpsService.supersedeOlderRuns({
        pullRequestId: 'pr1',
        exceptScanId: 'new',
        newHeadSha: NEW_SHA,
      })
    ).resolves.toEqual({ superseded: 1, cancelled: 0, sandboxesStopped: 0 })
  })

  it('a failing lookup returns zeros and never throws into stage A', async () => {
    repo.findPendingManagedByPullRequest.mockRejectedValue(new Error('db down'))
    await expect(
      securityManagedScanOpsService.supersedeOlderRuns({
        pullRequestId: 'pr1',
        exceptScanId: 'new',
        newHeadSha: NEW_SHA,
      })
    ).resolves.toEqual({ superseded: 0, cancelled: 0, sandboxesStopped: 0 })
    expect(repo.mergeStages).not.toHaveBeenCalled()
  })
})

describe('enforceHourlyCap', () => {
  const NOW = new Date('2026-09-10T12:00:00Z')

  it('counts managed runs in the trailing hour and allows below the cap', async () => {
    repo.countManagedRunsSince.mockResolvedValue(19)
    await expect(
      securityManagedScanOpsService.enforceHourlyCap({ workspaceId: 'w1' }, NOW)
    ).resolves.toEqual({ capped: false })
    expect(repo.countManagedRunsSince).toHaveBeenCalledWith(
      'w1',
      new Date('2026-09-10T11:00:00Z')
    )
  })

  it('at the cap it refuses with a prefixed rate-limited reason', async () => {
    repo.countManagedRunsSince.mockResolvedValue(20)
    const result = await securityManagedScanOpsService.enforceHourlyCap(
      { workspaceId: 'w1' },
      NOW
    )
    expect(result).toEqual({
      capped: true,
      reason:
        'external: rate-limited: 20 managed scans started in the last hour (cap 20)',
    })
  })

  it('honours LUMO_MANAGED_SCAN_HOURLY_CAP', async () => {
    process.env.LUMO_MANAGED_SCAN_HOURLY_CAP = '3'
    repo.countManagedRunsSince.mockResolvedValue(3)
    const result = await securityManagedScanOpsService.enforceHourlyCap(
      { workspaceId: 'w1' },
      NOW
    )
    expect(result.capped).toBe(true)
    if (result.capped) expect(result.reason).toContain('(cap 3)')
  })
})

describe('sweepStalePending', () => {
  const NOW = new Date('2026-09-10T12:00:00Z')

  it('asks for PENDING rows older than 45 min, batch-limited, and marks them FAILED with the sweep reason', async () => {
    repo.findStalePendingExternal.mockResolvedValue([
      {
        id: 'm1',
        managedRunId: 'run_m1',
        stages: { external: 'PENDING', supplyChain: 'PENDING' },
      },
      { id: 'byo', managedRunId: null, stages: { external: 'PENDING' } },
    ])
    const result = await securityManagedScanOpsService.sweepStalePending({
      now: NOW,
    })
    expect(repo.findStalePendingExternal).toHaveBeenCalledWith(
      new Date(NOW.getTime() - EXTERNAL_PENDING_DEAD_MS),
      SWEEP_BATCH_LIMIT
    )
    expect(repo.mergeStages).toHaveBeenCalledWith(
      'm1',
      { external: 'FAILED', supplyChain: 'FAILED' },
      { error: `external: ${SWEEP_REASON}` }
    )
    expect(repo.mergeStages).toHaveBeenCalledWith(
      'byo',
      { external: 'FAILED' },
      { error: `external: ${SWEEP_REASON}` }
    )
    // Managed row: cancel + stop. BYO row: neither (nothing of ours is running).
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(cancel).toHaveBeenCalledWith('run_m1', 'm1')
    expect(stopByTag).toHaveBeenCalledTimes(1)
    expect(stopByTag).toHaveBeenCalledWith({ lumoScan: 'm1' })
    // Both rows get their PR summary refreshed.
    expect(sync).toHaveBeenCalledWith('m1')
    expect(sync).toHaveBeenCalledWith('byo')
    expect(result).toEqual({ swept: 2, cancelled: 1, sandboxesStopped: 1 })
  })

  it('a row whose stamp fails is neither killed nor synced; the batch continues', async () => {
    repo.findStalePendingExternal.mockResolvedValue([
      { id: 'a', managedRunId: 'run_a', stages: { external: 'PENDING' } },
      { id: 'b', managedRunId: 'run_b', stages: { external: 'PENDING' } },
    ])
    repo.mergeStages
      .mockRejectedValueOnce(new Error('P1001'))
      .mockResolvedValueOnce(undefined)
    const result = await securityManagedScanOpsService.sweepStalePending({
      now: NOW,
    })
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(cancel).toHaveBeenCalledWith('run_b', 'b')
    expect(sync).toHaveBeenCalledTimes(1)
    expect(sync).toHaveBeenCalledWith('b')
    expect(result.swept).toBe(1)
  })

  it('an explicit limit is passed through; an empty batch returns zeros', async () => {
    repo.findStalePendingExternal.mockResolvedValue([])
    await expect(
      securityManagedScanOpsService.sweepStalePending({ now: NOW, limit: 5 })
    ).resolves.toEqual({ swept: 0, cancelled: 0, sandboxesStopped: 0 })
    expect(repo.findStalePendingExternal).toHaveBeenCalledWith(
      expect.any(Date),
      5
    )
    expect(sync).not.toHaveBeenCalled()
  })
})
