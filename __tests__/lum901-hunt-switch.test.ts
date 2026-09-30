/**
 * @jest-environment node
 *
 * LUM-901 — a hunt the customer turns off after stage A dispatched it:
 *   - the run re-reads the switch before its first model call, and stops
 *     without planning, hunting, falsifying or persisting;
 *   - the layer lands DISABLED (the customer's choice), never FAILED — so the
 *     PR comment, the CLI and the web panel say it was turned off in
 *     settings, not that it did not finish on our side.
 */
jest.mock('@/lib/workflows/security-hunt.steps', () => ({
  buildVerifySubgraphStep: jest.fn(),
  planHuntStep: jest.fn(),
  huntTaskStep: jest.fn(),
  mechanicalVerifyStep: jest.fn(),
  falsifierStep: jest.fn(),
  persistHuntFindingsStep: jest.fn(),
  markHuntFailedStep: jest.fn(),
  requeueHuntStep: jest.fn(),
  continueHuntStep: jest.fn(),
  awaitManagedScanStep: jest.fn(),
  stopIfHuntTurnedOffStep: jest.fn(),
}))
jest.mock('@/lib/workflows/security-sarif-ingest.steps', () => ({
  persistSarifFindingsStep: jest.fn(),
  markSarifExternalFailedStep: jest.fn(),
  deleteSarifBlobStep: jest.fn(),
}))
jest.mock('@/lib/workflows/security-pr-review.steps', () => ({
  syncPrReviewStep: jest.fn().mockResolvedValue(undefined),
}))
jest.mock('@/lib/workflows/security-suggest.steps', () => ({
  suggestDispositionsStep: jest.fn().mockResolvedValue(undefined),
}))
jest.mock('@/lib/integrations/github/auth', () => ({
  getRepoToken: jest.fn(),
}))
jest.mock('@/lib/logger', () => ({
  logger: { error: jest.fn(), info: jest.fn(), warn: jest.fn() },
}))
jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    $transaction: jest.fn(),
    prSecurityScan: { findUnique: jest.fn(), update: jest.fn() },
  },
}))
jest.mock('@/lib/repositories/pr-security-scan.repository', () => ({
  prSecurityScanRepository: {
    failStaleHunt: jest.fn(),
    disableStaleHunt: jest.fn(),
    findStalePendingHunts: jest.fn(),
    hasNewerScan: jest.fn(),
    claimHuntRetry: jest.fn(),
  },
}))
jest.mock('@/lib/repositories/workspace.repository', () => ({
  workspaceRepository: { findSecuritySwitches: jest.fn() },
}))
jest.mock('@/lib/services/security-hunt-start', () => ({
  startSecurityHunt: jest.fn(),
  cancelHuntRun: jest.fn(),
}))
jest.mock('@/lib/integrations/vercel-sandbox', () => ({
  stopRepoSandboxesByTag: jest.fn().mockResolvedValue(0),
}))
jest.mock('@/lib/services/security-pr-review.service', () => ({
  securityPrReviewService: { sync: jest.fn() },
}))
jest.mock('@/lib/services/scan-code-retention.service', () => ({
  scrubScanIfRepositoryUnconfirmed: jest.fn(),
}))

import { securityHuntWorkflow } from '@/lib/workflows/security-hunt'
import * as steps from '@/lib/workflows/security-hunt.steps'
import {
  HUNT_STALE_REASONS,
  securityHuntOpsService,
} from '@/lib/services/security-hunt-ops.service'
import { prSecurityScanRepository } from '@/lib/repositories/pr-security-scan.repository'
import { workspaceRepository } from '@/lib/repositories/workspace.repository'
import { securityPrReviewService } from '@/lib/services/security-pr-review.service'
import { prisma } from '@/lib/db/prisma'
import {
  SCAN_UNFINISHED_NOTE,
  isOwnedUnfinished,
  scanCoverageState,
} from '@/shared/src/security-scan'
import {
  formatScanLayerTail,
  formatScanStatus,
  formatTurnedOffLines,
} from '@/cli/src/lib/scan-format'
import { summarizeSecurityScans } from '@/app/workspace/[workspaceUrl]/components/TaskDetailTimeline/security-summary'
import type { SecurityScanView } from '@/lib/services/pr-security-scan.service'

const { buildSummary } = jest.requireActual(
  '@/lib/services/security-pr-review.service'
) as typeof import('@/lib/services/security-pr-review.service')
const realRepo = (
  jest.requireActual(
    '@/lib/repositories/pr-security-scan.repository'
  ) as typeof import('@/lib/repositories/pr-security-scan.repository')
).prSecurityScanRepository

const repo = prSecurityScanRepository as jest.Mocked<
  typeof prSecurityScanRepository
>
const switches = (s: Record<string, boolean>) =>
  (workspaceRepository.findSecuritySwitches as jest.Mock).mockResolvedValue(s)
const turnedOffStep = steps.stopIfHuntTurnedOffStep as jest.Mock

const JOB = {
  scanId: 's1',
  pullRequestId: 'pr1',
  taskId: 't1',
  workspaceId: 'w1',
  repo: 'o/r',
  prNumber: 7,
  headSha: 'a'.repeat(40),
  reasons: ['diff:sink:prisma-raw'],
  touchedSourcePaths: ['lib/s.ts'],
  managedScanStarted: false,
  attempt: 1,
}

beforeEach(() => {
  jest.clearAllMocks()
  ;(steps.planHuntStep as jest.Mock).mockResolvedValue({
    tasks: [
      {
        id: 't1',
        objective: 'x',
        category: 'injection',
        startingPoints: ['lib/s.ts'],
      },
    ],
    reason: 'r',
    by: 'model',
    tokens: 10,
  })
  ;(steps.huntTaskStep as jest.Mock).mockResolvedValue({
    candidates: [],
    tokens: 10,
    elapsedMs: 1,
    stopped: 'done',
  })
  ;(steps.mechanicalVerifyStep as jest.Mock).mockResolvedValue({
    accepted: [],
    rejected: [],
  })
  ;(steps.persistHuntFindingsStep as jest.Mock).mockResolvedValue({
    written: 0,
  })
})

describe('LUM-901 dispatched hunt stops before first round when switch is off', () => {
  it('the run makes no planner, hunt or falsifier call and persists nothing', async () => {
    turnedOffStep.mockResolvedValue(true)
    const result = await securityHuntWorkflow(JOB)

    expect(result).toEqual({ outcome: 'DISABLED', scanId: 's1' })
    expect(turnedOffStep).toHaveBeenCalledWith({ job: JOB })
    expect(steps.planHuntStep).not.toHaveBeenCalled()
    expect(steps.huntTaskStep).not.toHaveBeenCalled()
    expect(steps.falsifierStep).not.toHaveBeenCalled()
    expect(steps.persistHuntFindingsStep).not.toHaveBeenCalled()
    expect(steps.markHuntFailedStep).not.toHaveBeenCalled()
  })

  it('turned off while it hunted: nothing it found is persisted', async () => {
    turnedOffStep.mockResolvedValueOnce(false).mockResolvedValue(true)
    const result = await securityHuntWorkflow(JOB)

    expect(result.outcome).toBe('DISABLED')
    expect(steps.planHuntStep).toHaveBeenCalled()
    expect(steps.persistHuntFindingsStep).not.toHaveBeenCalled()
  })

  it('control: with the switch on the run hunts and persists as before', async () => {
    turnedOffStep.mockResolvedValue(false)
    const result = await securityHuntWorkflow(JOB)

    expect(result.outcome).toBe('RAN')
    expect(steps.planHuntStep).toHaveBeenCalled()
    expect(steps.persistHuntFindingsStep).toHaveBeenCalledTimes(1)
  })

  it('the switch read stamps the layer DISABLED and re-syncs the PR comment', async () => {
    repo.disableStaleHunt.mockResolvedValue(true)
    switches({ securityHuntEnabled: false })
    await expect(securityHuntOpsService.stopIfHuntTurnedOff(JOB)).resolves.toBe(
      true
    )
    expect(repo.disableStaleHunt).toHaveBeenCalledWith(
      's1',
      1,
      HUNT_STALE_REASONS.disabled
    )
    expect(securityPrReviewService.sync).toHaveBeenCalledWith('s1')

    // The master scan switch is the customer's too.
    repo.disableStaleHunt.mockClear()
    switches({ securityScanEnabled: false })
    await expect(securityHuntOpsService.stopIfHuntTurnedOff(JOB)).resolves.toBe(
      true
    )
    expect(repo.disableStaleHunt).toHaveBeenCalledTimes(1)
    expect(repo.failStaleHunt).not.toHaveBeenCalled()

    // Switch on: the run goes on and nothing is written.
    repo.disableStaleHunt.mockClear()
    switches({})
    await expect(securityHuntOpsService.stopIfHuntTurnedOff(JOB)).resolves.toBe(
      false
    )
    expect(repo.disableStaleHunt).not.toHaveBeenCalled()
  })
})

describe('LUM-901 hunt turned off mid-run reads as turned off not unfinished', () => {
  const mockScan = (
    prisma as unknown as {
      prSecurityScan: { findUnique: jest.Mock; update: jest.Mock }
    }
  ).prSecurityScan
  ;(
    prisma as unknown as { $transaction: jest.Mock }
  ).$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) =>
    fn({ prSecurityScan: mockScan })
  )

  it('the stale sweep settles a pending hunt DISABLED, not FAILED', async () => {
    switches({ securityHuntEnabled: false })
    repo.disableStaleHunt.mockResolvedValue(true)
    repo.findStalePendingHunts.mockResolvedValue([
      {
        id: 's1',
        pullRequestId: 'pr1',
        startedAt: new Date('2026-09-28T00:00:00Z'),
        // Even a hunt out of retries is the customer's once the switch is off.
        huntJob: { ...JOB, tries: 2 },
        huntRunId: null,
        huntAttempts: 2,
      },
    ] as never)
    await securityHuntOpsService.sweepStaleHunts({
      now: new Date('2026-09-28T02:00:00Z'),
    })
    expect(repo.disableStaleHunt).toHaveBeenCalledWith(
      's1',
      2,
      HUNT_STALE_REASONS.disabled
    )
    expect(repo.failStaleHunt).not.toHaveBeenCalled()
  })

  it('the repository writes the hunt layer DISABLED under the same CAS', async () => {
    mockScan.findUnique.mockResolvedValueOnce({
      stages: { secrets: 'RAN', hunt: 'PENDING' },
      huntAttempts: 1,
    })
    await expect(
      realRepo.disableStaleHunt('s1', 1, HUNT_STALE_REASONS.disabled)
    ).resolves.toBe(true)
    expect(mockScan.update).toHaveBeenCalledWith({
      where: { id: 's1' },
      data: {
        stages: { secrets: 'RAN', hunt: 'DISABLED' },
        huntAudit: { error: HUNT_STALE_REASONS.disabled },
      },
    })
    // A result that landed in between still wins.
    mockScan.update.mockClear()
    mockScan.findUnique.mockResolvedValueOnce({
      stages: { hunt: 'RAN' },
      huntAttempts: 1,
    })
    await expect(
      realRepo.disableStaleHunt('s1', 1, HUNT_STALE_REASONS.disabled)
    ).resolves.toBe(false)
    expect(mockScan.update).not.toHaveBeenCalled()
  })

  const stages = {
    secrets: 'RAN',
    judge: 'RAN',
    external: 'RAN',
    hunt: 'DISABLED',
  } as const
  const scan = { status: 'CLEAN', stages, partial: false }

  it('coverage and the owned-unfinished rule read it as turned off', () => {
    expect(scanCoverageState(scan)).toBe('TURNED_OFF')
    expect(isOwnedUnfinished({ ...scan, hasSizeNotice: false })).toBe(false)
  })

  it('the PR comment says turned off in settings, not unfinished on our side', () => {
    const body = buildSummary({
      headSha: 'a'.repeat(40),
      status: 'CLEAN',
      stages,
      partial: false,
      externalCounts: {},
      open: 0,
      blocking: 0,
      error: null,
      taskUrl: null,
    })
    expect(body).toMatch(/Turned off in this workspace's settings/)
    expect(body).not.toContain(SCAN_UNFINISHED_NOTE)
    expect(body).not.toMatch(/didn't finish/)
  })

  it('the CLI says turned off, never a bare CLEAN or unfinished', () => {
    expect(formatScanStatus('CLEAN', stages)).not.toBe('CLEAN')
    expect(formatTurnedOffLines(stages).join('\n')).toMatch(/Turned off/)
    expect(formatScanLayerTail({ ...scan } as never)).not.toContain(
      SCAN_UNFINISHED_NOTE
    )
  })

  it('the web panel counts it as turned off, not incomplete', () => {
    const latest = {
      coverage: scanCoverageState(scan),
      ownedUnfinished: false,
      complete: false,
      stages,
      findings: [],
      huntOverCap: null,
      judgeOverCap: null,
    } as unknown as SecurityScanView
    expect(summarizeSecurityScans([{ latest }])).toMatchObject({
      turnedOff: 1,
      incomplete: 0,
    })
  })
})
