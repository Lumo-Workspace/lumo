/** @jest-environment node */
// LUM-866: every workspace here has the default switches (all on); the
// platform env in each test still decides the ceiling.
jest.mock('@/lib/services/security-workspace-switches.service', () => ({
  // A plain function, not jest.fn: survives resetAllMocks.
  loadSecurityLayers: async () =>
    jest
      .requireActual('@/lib/security-scan/workspace-switches')
      .resolveSecurityLayers(null),
}))
jest.mock('@/lib/logger', () => ({
  logger: { error: jest.fn(), info: jest.fn(), warn: jest.fn() },
}))
jest.mock('@/lib/repositories/pr-security-scan.repository', () => ({
  prSecurityScanRepository: {
    findStalePendingHunts: jest.fn(),
    hasNewerScan: jest.fn(),
    claimHuntRetry: jest.fn(),
    setHuntRunId: jest.fn(),
    failStaleHunt: jest.fn(),
  },
}))
jest.mock('@/lib/integrations/vercel-sandbox', () => ({
  stopRepoSandboxesByTag: jest.fn(),
}))
jest.mock('@/lib/services/security-hunt-start', () => ({
  startSecurityHunt: jest.fn(),
  cancelHuntRun: jest.fn(),
}))
jest.mock('@/lib/services/security-pr-review.service', () => ({
  securityPrReviewService: { sync: jest.fn() },
}))

import { prSecurityScanRepository } from '@/lib/repositories/pr-security-scan.repository'
import type { StalePendingHunt } from '@/lib/repositories/pr-security-scan.repository'
import { stopRepoSandboxesByTag } from '@/lib/integrations/vercel-sandbox'
import {
  cancelHuntRun,
  startSecurityHunt,
} from '@/lib/services/security-hunt-start'
import { securityPrReviewService } from '@/lib/services/security-pr-review.service'
import {
  securityHuntOpsService,
  HUNT_PENDING_DEAD_MS,
  HUNT_STALE_REASONS,
} from '@/lib/services/security-hunt-ops.service'
import { SANDBOX_TIMEOUT_WITH_HUNT_MS } from '@/lib/services/security-managed-scan.config'
import type { HuntJob } from '@/lib/services/security-hunt.config'

const repo = prSecurityScanRepository as jest.Mocked<
  typeof prSecurityScanRepository
>
const stopByTag = stopRepoSandboxesByTag as jest.Mock
const cancel = cancelHuntRun as jest.Mock
const startHunt = startSecurityHunt as jest.Mock
const sync = securityPrReviewService.sync as jest.Mock

const NOW = new Date('2026-09-23T12:00:00Z')

const JOB: HuntJob = {
  scanId: 's1',
  pullRequestId: 'pr1',
  taskId: 't1',
  workspaceId: 'w1',
  repo: 'o/r',
  prNumber: 1067,
  headSha: 'a'.repeat(40),
  reasons: ['diff:sink'],
  touchedSourcePaths: ['lib/a.ts'],
  managedScanStarted: true,
}

function stale(over: Partial<StalePendingHunt> = {}): StalePendingHunt {
  return {
    id: 's1',
    pullRequestId: 'pr1',
    startedAt: new Date('2026-09-23T10:00:00Z'),
    huntJob: { ...JOB },
    huntRunId: 'run_1',
    huntAttempts: 1,
    ...over,
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  repo.hasNewerScan.mockResolvedValue(false)
  repo.claimHuntRetry.mockResolvedValue(true)
  repo.setHuntRunId.mockResolvedValue(undefined)
  repo.failStaleHunt.mockResolvedValue(true)
  cancel.mockResolvedValue(true)
  stopByTag.mockResolvedValue(1)
  startHunt.mockResolvedValue('run_2')
  sync.mockResolvedValue({ posted: true, inline: 0, skipped: 0 })
})

describe('LUM-822 sweepStaleHunts', () => {
  it('reads hunts PENDING since before now − the dead window, which outlasts the hunt VM', async () => {
    expect(HUNT_PENDING_DEAD_MS).toBeGreaterThan(SANDBOX_TIMEOUT_WITH_HUNT_MS)
    repo.findStalePendingHunts.mockResolvedValue([])
    await securityHuntOpsService.sweepStaleHunts({ now: NOW })
    expect(repo.findStalePendingHunts).toHaveBeenCalledWith(
      new Date(NOW.getTime() - HUNT_PENDING_DEAD_MS),
      expect.any(Number)
    )
  })

  it('stale hunt on its first attempt is retried once with the stored job', async () => {
    const order: string[] = []
    repo.claimHuntRetry.mockImplementation(async () => {
      order.push('claim')
      return true
    })
    cancel.mockImplementation(async () => {
      order.push('cancel')
      return true
    })
    stopByTag.mockImplementation(async () => {
      order.push('stop')
      return 1
    })
    startHunt.mockImplementation(async () => {
      order.push('start')
      return 'run_2'
    })
    repo.findStalePendingHunts.mockResolvedValue([stale()])

    const counts = await securityHuntOpsService.sweepStaleHunts({ now: NOW })

    expect(repo.claimHuntRetry).toHaveBeenCalledWith('s1', 1, {})
    expect(cancel).toHaveBeenCalledWith('run_1', 's1')
    expect(stopByTag).toHaveBeenCalledWith({ lumoHunt: 's1' })
    expect(startHunt).toHaveBeenCalledTimes(1)
    expect(startHunt).toHaveBeenCalledWith({
      ...JOB,
      attempt: 2,
      managedScanStarted: false,
    })
    expect(order).toEqual(['claim', 'cancel', 'stop', 'start'])
    expect(repo.setHuntRunId).toHaveBeenCalledWith('s1', 'run_2')
    // Still scanning: nothing is failed and the summary is left alone.
    expect(repo.failStaleHunt).not.toHaveBeenCalled()
    expect(sync).not.toHaveBeenCalled()
    expect(counts).toEqual({
      retried: 1,
      failed: 0,
      cancelled: 1,
      sandboxesStopped: 1,
    })
  })

  it('a retry another tick already claimed starts nothing', async () => {
    repo.claimHuntRetry.mockResolvedValue(false)
    repo.findStalePendingHunts.mockResolvedValue([stale()])
    const counts = await securityHuntOpsService.sweepStaleHunts({ now: NOW })
    expect(startHunt).not.toHaveBeenCalled()
    expect(cancel).not.toHaveBeenCalled()
    expect(counts.retried).toBe(0)
  })

  it('stale hunt after its retry is marked FAILED and the summary re-synced', async () => {
    repo.findStalePendingHunts.mockResolvedValue([
      stale({ huntAttempts: 2, huntRunId: 'run_2' }),
    ])
    const counts = await securityHuntOpsService.sweepStaleHunts({ now: NOW })
    expect(startHunt).not.toHaveBeenCalled()
    expect(repo.claimHuntRetry).not.toHaveBeenCalled()
    expect(repo.failStaleHunt).toHaveBeenCalledWith(
      's1',
      2,
      HUNT_STALE_REASONS.afterRetry
    )
    expect(cancel).toHaveBeenCalledWith('run_2', 's1')
    expect(sync).toHaveBeenCalledWith('s1')
    expect(counts).toEqual({
      retried: 0,
      failed: 1,
      cancelled: 1,
      sandboxesStopped: 1,
    })
  })

  it('a row with no usable stored job is failed, not retried', async () => {
    repo.findStalePendingHunts.mockResolvedValue([
      stale({ huntJob: null, huntAttempts: 0, huntRunId: null }),
      stale({ id: 's2', huntJob: { ...JOB } }), // job belongs to s1, not s2
    ])
    await securityHuntOpsService.sweepStaleHunts({ now: NOW })
    expect(startHunt).not.toHaveBeenCalled()
    expect(repo.failStaleHunt).toHaveBeenCalledWith(
      's1',
      0,
      HUNT_STALE_REASONS.noJob
    )
    expect(repo.failStaleHunt).toHaveBeenCalledWith(
      's2',
      1,
      HUNT_STALE_REASONS.noJob
    )
    expect(sync).toHaveBeenCalledTimes(2)
  })

  it('a PR that moved to a newer head is failed, not retried', async () => {
    repo.hasNewerScan.mockResolvedValue(true)
    repo.findStalePendingHunts.mockResolvedValue([stale()])
    await securityHuntOpsService.sweepStaleHunts({ now: NOW })
    expect(startHunt).not.toHaveBeenCalled()
    expect(repo.failStaleHunt).toHaveBeenCalledWith(
      's1',
      1,
      HUNT_STALE_REASONS.superseded
    )
  })

  it('a retry that cannot start is failed at the claimed attempt', async () => {
    startHunt.mockResolvedValue(null)
    repo.findStalePendingHunts.mockResolvedValue([stale()])
    const counts = await securityHuntOpsService.sweepStaleHunts({ now: NOW })
    expect(repo.failStaleHunt).toHaveBeenCalledWith(
      's1',
      2,
      HUNT_STALE_REASONS.retryNotStarted
    )
    expect(sync).toHaveBeenCalledWith('s1')
    expect(counts.retried).toBe(0)
    expect(counts.failed).toBe(1)
  })

  it('a hunt that landed before the stamp is left alone (no kill, no sync)', async () => {
    repo.failStaleHunt.mockResolvedValue(false)
    repo.findStalePendingHunts.mockResolvedValue([stale({ huntAttempts: 2 })])
    const counts = await securityHuntOpsService.sweepStaleHunts({ now: NOW })
    expect(cancel).not.toHaveBeenCalled()
    expect(sync).not.toHaveBeenCalled()
    expect(counts.failed).toBe(0)
  })

  it('one row throwing does not stop the next', async () => {
    repo.failStaleHunt
      .mockRejectedValueOnce(new Error('db down'))
      .mockResolvedValueOnce(true)
    repo.findStalePendingHunts.mockResolvedValue([
      stale({ huntAttempts: 2 }),
      stale({ id: 's2', huntAttempts: 2 }),
    ])
    const counts = await securityHuntOpsService.sweepStaleHunts({ now: NOW })
    expect(repo.failStaleHunt).toHaveBeenCalledTimes(2)
    expect(sync).toHaveBeenCalledWith('s2')
    expect(counts.failed).toBe(1)
  })
})
