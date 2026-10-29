/**
 * @jest-environment node
 *
 * LUM-1234 — stage A stamps the reward-hack layer ("Agent behavior") and
 * starts its runner once the scan's own result is persisted. Same LUM-866
 * harness as the LUM-892 test: the real stage A, only the rows and the I/O
 * around it mocked; the runner itself is mocked here (its own test drives it).
 */
jest.mock('@/ee/security/services/reward-hack-layer.service', () => ({
  runRewardHackLayer: jest.fn().mockResolvedValue(undefined),
}))
jest.mock('@/ee/security/services/auto-review-admission.service', () =>
  require('@/test-utils/ee/auto-review-admission-mock').delegatingAdmission()
)
jest.mock('@/ee/security/repositories/pr-review-control.repository', () => ({
  prReviewControlRepository: {
    reserve: jest.fn().mockResolvedValue(true),
    release: jest.fn().mockResolvedValue(undefined),
    baseline: jest.fn().mockResolvedValue(null),
    priorFindings: jest.fn().mockResolvedValue([]),
    findingsOnScan: jest.fn().mockResolvedValue([]),
    get: jest.fn().mockResolvedValue({
      reviewPaused: false,
      reviewHeads: [],
    }),
  },
}))
jest.mock('@/lib/logger', () => ({
  logger: { error: jest.fn(), info: jest.fn(), warn: jest.fn() },
}))
jest.mock('@/lib/integrations/github/auth', () => ({
  getRepoToken: jest.fn().mockResolvedValue('tok'),
}))
jest.mock('@/lib/integrations/github/contents', () => ({
  fetchPrDiff: jest.fn(),
  fetchPrHeadSha: jest.fn(),
  fetchPrChangedFiles: jest.fn(),
  fetchDefaultBranchHead: jest.fn(),
  readRepoFile: jest.fn().mockResolvedValue(null),
}))
jest.mock('@/ee/security/llm/security-judge-client', () => ({
  judgeSecurity: jest.fn(),
}))
jest.mock('@/ee/security/repositories/pr-security-scan.repository', () => ({
  prSecurityScanRepository: {
    findByPrAndSha: jest.fn(),
    create: jest.fn(),
    createIfAbsent: jest.fn(),
    restart: jest.fn(),
    finalize: jest.fn(),
    persistResult: jest.fn(),
    countExternalFindings: jest.fn(),
    findDispositionedByPullRequest: jest.fn(),
    mergeStages: jest.fn(),
    setManagedRunId: jest.fn(),
    hasNewerScan: jest.fn(),
    hasNewerScanThan: jest.fn(),
    claimHuntRetry: jest.fn(),
    setHuntRunId: jest.fn(),
    failStaleHunt: jest.fn(),
    findStalePendingHunts: jest.fn(),
  },
}))
jest.mock('@/lib/repositories/workspace.repository', () => ({
  workspaceRepository: {},
}))
jest.mock('@/lib/repositories/pull-request.repository', () => ({
  pullRequestRepository: {
    findById: jest.fn(),
    findByRepoAndNumber: jest.fn(),
  },
}))
jest.mock('@/lib/repositories/project.repository', () => ({
  projectRepository: {},
}))
jest.mock('@/ee/security/repositories/security-columns.repository', () => ({
  securityColumnsRepository: {
    findSecurityPolicy: jest.fn(),
    findSecuritySwitches: jest.fn(),
    findLastSarifIngestAt: jest.fn(),
    findSecurityBaseline: jest.fn(),
    setSecurityBaseline: jest.fn(),
  },
}))

jest.mock('@/lib/repositories/boundary-crossing.repository', () => ({
  boundaryCrossingRepository: { findUndispositionedByTask: jest.fn() },
}))
jest.mock('@/ee/security/services/security-managed-scan-start', () => ({
  startSecurityManagedScan: jest.fn(),
}))
jest.mock('@/ee/security/services/security-managed-scan-ops.service', () => ({
  securityManagedScanOpsService: {
    supersedeOlderRuns: jest.fn(),
    enforceHourlyCap: jest.fn(),
  },
}))
jest.mock('@/ee/security/services/security-baseline-scan-start', () => ({
  startSecurityBaselineScan: jest.fn(),
}))
jest.mock('@/ee/security/services/security-hunt-start', () => ({
  startSecurityHunt: jest.fn(),
  recordHuntStartBestEffort: jest.fn(),
  cancelHuntRun: jest.fn(),
}))
jest.mock('@/ee/security/integrations/vercel-sandbox', () => ({
  stopRepoSandboxesByTag: jest.fn(),
}))
jest.mock('@/ee/security/services/security-pr-review.service', () => ({
  securityPrReviewService: { sync: jest.fn(), markScanningOff: jest.fn() },
}))
jest.mock('@/ee/security/services/pr-security-scan-dispatch', () => ({
  dispatchPrSecurityScan: jest.fn(),
}))
jest.mock('@/ee/security/services/security-sarif-blob', () => ({
  fetchPrivateBlob: jest.fn(),
  deleteBlob: jest.fn(),
  listSarifBlobs: jest.fn(),
}))
jest.mock('@/lib/runtime/wait-until', () => ({ waitUntil: jest.fn() }))

import { prSecurityScanService } from '@/ee/security/services/pr-security-scan.service'
import { prSecurityScanRepository } from '@/ee/security/repositories/pr-security-scan.repository'
import { pullRequestRepository } from '@/lib/repositories/pull-request.repository'
import { boundaryCrossingRepository } from '@/lib/repositories/boundary-crossing.repository'
import { startSecurityManagedScan } from '@/ee/security/services/security-managed-scan-start'
import { securityManagedScanOpsService } from '@/ee/security/services/security-managed-scan-ops.service'
import { startSecurityBaselineScan } from '@/ee/security/services/security-baseline-scan-start'
import { startSecurityHunt } from '@/ee/security/services/security-hunt-start'
import { securityPrReviewService } from '@/ee/security/services/security-pr-review.service'
import * as gh from '@/lib/integrations/github/contents'
import * as judge from '@/ee/security/llm/security-judge-client'

import { scanCoverageState } from '@/shared/src/security-scan'
import { waitUntil } from '@/lib/runtime/wait-until'
import { runRewardHackLayer } from '@/ee/security/services/reward-hack-layer.service'
import { prReviewControlRepository } from '@/ee/security/repositories/pr-review-control.repository'
import { securityColumnsRepository } from '@/ee/security/repositories/security-columns.repository'

const repo = prSecurityScanRepository as jest.Mocked<
  typeof prSecurityScanRepository
>
const prRepo = pullRequestRepository as jest.Mocked<
  typeof pullRequestRepository
>
const colRepo = securityColumnsRepository as jest.Mocked<
  typeof securityColumnsRepository
>
const fetchPrDiff = gh.fetchPrDiff as jest.Mock
const fetchPrHeadSha = gh.fetchPrHeadSha as jest.Mock
const judgeSecurity = judge.judgeSecurity as jest.Mock
const startManaged = startSecurityManagedScan as jest.Mock
const startBaseline = startSecurityBaselineScan as jest.Mock
const startHunt = startSecurityHunt as jest.Mock

const PR = {
  id: 'pr1',
  workspaceId: 'w1',
  taskId: 't1',
  repo: 'o/r',
  number: 7,
}
const diff = (path: string, line: string) =>
  ['--- a/' + path, '+++ b/' + path, '@@ -1,0 +1,1 @@', '+' + line].join('\n')
// A route handler: the hunt trigger fires on it.
const ROUTE_DIFF = diff(
  'app/api/x/route.ts',
  'export async function POST(req: Request) {'
)

const ALL_ON = {
  securityScanEnabled: true,
  securityAiReviewEnabled: true,
  securityHuntEnabled: true,
  securityRewardHackEnabled: true,
  securityRequestChangesEnabled: false,
  securityAllowAuthorApproval: true,
  securityLearningsScope: 'auto' as const,
  securityReviewAutoPauseAfter: 5,
  securityLocalScanLogEnabled: false,
}
const switches = (patch: Partial<typeof ALL_ON>) =>
  colRepo.findSecuritySwitches.mockResolvedValue({ ...ALL_ON, ...patch })

beforeEach(() => {
  jest.clearAllMocks()
  delete process.env.LUMO_SECURITY_HUNT
  delete process.env.LUMO_MANAGED_SCAN
  process.env.LUMO_DOGFOOD_WORKSPACE_IDS = 'w1'
  switches({})
  colRepo.findSecurityPolicy.mockResolvedValue(null)
  prRepo.findById.mockResolvedValue(PR as never)
  prRepo.findByRepoAndNumber.mockResolvedValue(PR as never)
  fetchPrHeadSha.mockResolvedValue('sha-1')
  fetchPrDiff.mockResolvedValue(ROUTE_DIFF)
  repo.findByPrAndSha.mockResolvedValue(null)
  repo.create.mockResolvedValue({ id: 's1' } as never)
  repo.createIfAbsent.mockResolvedValue({ id: 's1', created: true } as never)
  repo.findDispositionedByPullRequest.mockResolvedValue([])
  repo.countExternalFindings.mockResolvedValue(0)
  repo.persistResult.mockResolvedValue(undefined as never)
  repo.hasNewerScan.mockResolvedValue(false)
  repo.hasNewerScanThan.mockResolvedValue(false)
  repo.claimHuntRetry.mockResolvedValue(true as never)
  repo.failStaleHunt.mockResolvedValue(true as never)
  ;(
    boundaryCrossingRepository.findUndispositionedByTask as jest.Mock
  ).mockResolvedValue([])
  ;(
    securityManagedScanOpsService.supersedeOlderRuns as jest.Mock
  ).mockResolvedValue(undefined)
  ;(
    securityManagedScanOpsService.enforceHourlyCap as jest.Mock
  ).mockResolvedValue({ capped: false })
  colRepo.findLastSarifIngestAt.mockResolvedValue(null as never)
  colRepo.findSecurityBaseline.mockResolvedValue(null as never)
  judgeSecurity.mockResolvedValue({ findings: [] })
  startManaged.mockResolvedValue('run_m1')
  startBaseline.mockResolvedValue('run_b1')
  startHunt.mockResolvedValue('run_h1')
  ;(securityPrReviewService.sync as jest.Mock).mockResolvedValue({})
  ;(securityPrReviewService.markScanningOff as jest.Mock).mockResolvedValue({
    updated: false,
  })
})

afterAll(() => {
  delete process.env.LUMO_DOGFOOD_WORKSPACE_IDS
  delete process.env.LUMO_SECURITY_HUNT
  delete process.env.LUMO_MANAGED_SCAN
})

const runStageA = () =>
  prSecurityScanService.run({ pullRequestId: 'pr1', trigger: 'PR_EVENT' })
const persisted = () => repo.persistResult.mock.calls[0]![2]

const waitUntilMock = waitUntil as jest.Mock
const runner = runRewardHackLayer as jest.Mock
/** Let every promise handed to waitUntil settle. */
const drainBackground = () =>
  Promise.all(waitUntilMock.mock.calls.map(c => c[0]))

describe('LUM-1234 reward-hack layer in stage A', () => {
  afterEach(() => {
    ;(prReviewControlRepository.reserve as jest.Mock).mockResolvedValue(true)
  })

  it('on, with a task: PENDING in the persisted stages, and the runner starts after the persist with its run token', async () => {
    const token = new Date('2026-10-18T01:02:03Z')
    repo.persistResult.mockResolvedValue({
      managedLayerLanded: false,
      startedAt: token,
    })
    await runStageA()
    expect(persisted().stages.rewardHack).toBe('PENDING')
    await drainBackground()
    expect(runner).toHaveBeenCalledWith('s1', {}, { runToken: token })
    // Started after stage A's own write, never before it.
    expect(repo.persistResult.mock.invocationCallOrder[0]!).toBeLessThan(
      runner.mock.invocationCallOrder[0]!
    )
  })

  it('on, but the PR has no task: SKIPPED, no runner', async () => {
    prRepo.findById.mockResolvedValue({ ...PR, taskId: null } as never)
    await runStageA()
    expect(persisted().stages.rewardHack).toBe('SKIPPED')
    await drainBackground()
    expect(runner).not.toHaveBeenCalled()
  })

  it('automatic review paused (R12): PAUSED, no runner, no model call', async () => {
    ;(prReviewControlRepository.reserve as jest.Mock).mockResolvedValue(false)
    await runStageA()
    expect(persisted().stages.rewardHack).toBe('PAUSED')
    expect(persisted().partialCauses).toContain('AI_REVIEW_PAUSED')
    await drainBackground()
    expect(runner).not.toHaveBeenCalled()
    expect(judgeSecurity).not.toHaveBeenCalled()
  })

  it('only the reward-hack layer on, review paused: still PAUSED (it counts as an automatic AI layer)', async () => {
    switches({ securityAiReviewEnabled: false, securityHuntEnabled: false })
    ;(prReviewControlRepository.reserve as jest.Mock).mockResolvedValue(false)
    await runStageA()
    expect(persisted().stages.rewardHack).toBe('PAUSED')
    await drainBackground()
    expect(runner).not.toHaveBeenCalled()
  })

  it('only the reward-hack layer on, PR without a task: SKIPPED, and no review slot is spent', async () => {
    switches({ securityAiReviewEnabled: false, securityHuntEnabled: false })
    prRepo.findById.mockResolvedValue({ ...PR, taskId: null } as never)
    ;(prReviewControlRepository.reserve as jest.Mock).mockResolvedValue(false)
    await runStageA()
    expect(persisted().stages.rewardHack).toBe('SKIPPED')
    expect(prReviewControlRepository.reserve).not.toHaveBeenCalled()
    expect(persisted().partialCauses ?? []).not.toContain('AI_REVIEW_PAUSED')
    await drainBackground()
    expect(runner).not.toHaveBeenCalled()
  })

  it('only the reward-hack layer on, not paused: PENDING', async () => {
    switches({ securityAiReviewEnabled: false, securityHuntEnabled: false })
    await runStageA()
    expect(persisted().stages.rewardHack).toBe('PENDING')
  })

  it('turned off in workspace settings: DISABLED, no runner', async () => {
    switches({ securityRewardHackEnabled: false })
    await runStageA()
    expect(persisted().stages.rewardHack).toBe('DISABLED')
    await drainBackground()
    expect(runner).not.toHaveBeenCalled()
  })

  it('not rolled out to the workspace: no layer at all (no key), no runner, and the scan still reads as checked', async () => {
    delete process.env.LUMO_DOGFOOD_WORKSPACE_IDS
    await runStageA()
    const stages = persisted().stages
    expect(stages).not.toHaveProperty('rewardHack')
    await drainBackground()
    expect(runner).not.toHaveBeenCalled()
    // Once the managed run and the hunt land, nothing of ours is owed.
    const landed = {
      ...stages,
      external: 'RAN',
      supplyChain: 'RAN',
      hunt: 'RAN',
    }
    expect(
      scanCoverageState({ status: 'CLEAN', stages: landed, partial: false })
    ).toBe('CHECKED')
  })

  it('a runner that cannot even be loaded is stamped FAILED, never left PENDING', async () => {
    runner.mockRejectedValueOnce(new Error('boom'))
    await runStageA()
    await drainBackground()
    expect(repo.mergeStages).toHaveBeenCalledWith('s1', {
      rewardHack: 'FAILED',
    })
  })

  it('stage A failing after the stamp drops PENDING and starts no runner', async () => {
    fetchPrHeadSha
      .mockResolvedValueOnce('sha-1')
      .mockResolvedValueOnce('sha-1')
      .mockResolvedValue('sha-2')
    await expect(runStageA()).resolves.toMatchObject({ status: 'FAILED' })
    const finalStages = repo.finalize.mock.calls[0]![1].stages
    expect(finalStages).not.toHaveProperty('rewardHack')
    await drainBackground()
    expect(runner).not.toHaveBeenCalled()
  })

  it('a PR too large to scan: no layer when the platform does not offer it (R10), else skipped', async () => {
    ;(gh.fetchPrChangedFiles as jest.Mock).mockResolvedValue(5000)
    delete process.env.LUMO_DOGFOOD_WORKSPACE_IDS
    await runStageA()
    expect(repo.finalize.mock.calls[0]![1].stages).not.toHaveProperty(
      'rewardHack'
    )
    process.env.LUMO_DOGFOOD_WORKSPACE_IDS = 'w1'
    await runStageA()
    expect(repo.finalize.mock.calls[1]![1].stages.rewardHack).toBe('SKIPPED')
    expect(runner).not.toHaveBeenCalled()
  })
})
