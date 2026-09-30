/**
 * @jest-environment node
 *
 * LUM-866 — the per-workspace security-scan switches, driven through the real
 * loader and resolver: only the workspace row (and the I/O around each entry
 * point) is mocked. Every entry point that starts scan work for a workspace —
 * stage A, the SARIF ingest, the default-branch baseline and the hunt's own
 * continuation / re-queue / stale sweep — must honour them.
 */
jest.mock('@/lib/logger', () => ({
  logger: { error: jest.fn(), info: jest.fn(), warn: jest.fn() },
}))
jest.mock('@/lib/integrations/github/auth', () => ({
  getRepoToken: jest.fn().mockResolvedValue('tok'),
}))
jest.mock('@/lib/integrations/github/contents', () => ({
  fetchPrDiff: jest.fn(),
  fetchPrHeadSha: jest.fn(),
  fetchDefaultBranchHead: jest.fn(),
  readRepoFile: jest.fn().mockResolvedValue(null),
}))
jest.mock('@/lib/llm/security-judge-client', () => ({
  judgeSecurity: jest.fn(),
}))
jest.mock('@/lib/repositories/pr-security-scan.repository', () => ({
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
    disableStaleHunt: jest.fn(),
    findStalePendingHunts: jest.fn(),
  },
}))
jest.mock('@/lib/repositories/workspace.repository', () => ({
  workspaceRepository: {
    findSecurityPolicy: jest.fn(),
    findSecuritySwitches: jest.fn(),
  },
}))
jest.mock('@/lib/repositories/pull-request.repository', () => ({
  pullRequestRepository: {
    findById: jest.fn(),
    findByRepoAndNumber: jest.fn(),
  },
}))
jest.mock('@/lib/repositories/project.repository', () => ({
  projectRepository: {
    findLastSarifIngestAt: jest.fn(),
    findSecurityBaseline: jest.fn(),
    setSecurityBaseline: jest.fn(),
  },
}))
jest.mock('@/lib/repositories/boundary-crossing.repository', () => ({
  boundaryCrossingRepository: { findUndispositionedByTask: jest.fn() },
}))
jest.mock('@/lib/services/security-managed-scan-start', () => ({
  startSecurityManagedScan: jest.fn(),
}))
jest.mock('@/lib/services/security-managed-scan-ops.service', () => ({
  securityManagedScanOpsService: {
    supersedeOlderRuns: jest.fn(),
    enforceHourlyCap: jest.fn(),
  },
}))
jest.mock('@/lib/services/security-baseline-scan-start', () => ({
  startSecurityBaselineScan: jest.fn(),
}))
jest.mock('@/lib/services/security-hunt-start', () => ({
  startSecurityHunt: jest.fn(),
  recordHuntStartBestEffort: jest.fn(),
  cancelHuntRun: jest.fn(),
}))
jest.mock('@/lib/integrations/vercel-sandbox', () => ({
  stopRepoSandboxesByTag: jest.fn(),
}))
jest.mock('@/lib/services/security-pr-review.service', () => ({
  securityPrReviewService: { sync: jest.fn(), markScanningOff: jest.fn() },
}))
jest.mock('@/lib/services/pr-security-scan-dispatch', () => ({
  dispatchPrSecurityScan: jest.fn(),
}))
jest.mock('@/lib/services/security-sarif-blob', () => ({
  fetchPrivateBlob: jest.fn(),
  deleteBlob: jest.fn(),
  listSarifBlobs: jest.fn(),
}))
jest.mock('@vercel/functions', () => ({ waitUntil: jest.fn() }))

import { prSecurityScanService } from '@/lib/services/pr-security-scan.service'
import { securitySarifIngestService } from '@/lib/services/security-sarif-ingest.service'
import { securityBaselineService } from '@/lib/services/security-baseline.service'
import {
  HUNT_STALE_REASONS,
  securityHuntOpsService,
} from '@/lib/services/security-hunt-ops.service'
import { prSecurityScanRepository } from '@/lib/repositories/pr-security-scan.repository'
import { workspaceRepository } from '@/lib/repositories/workspace.repository'
import { pullRequestRepository } from '@/lib/repositories/pull-request.repository'
import { projectRepository } from '@/lib/repositories/project.repository'
import { boundaryCrossingRepository } from '@/lib/repositories/boundary-crossing.repository'
import { startSecurityManagedScan } from '@/lib/services/security-managed-scan-start'
import { securityManagedScanOpsService } from '@/lib/services/security-managed-scan-ops.service'
import { startSecurityBaselineScan } from '@/lib/services/security-baseline-scan-start'
import { startSecurityHunt } from '@/lib/services/security-hunt-start'
import { dispatchPrSecurityScan } from '@/lib/services/pr-security-scan-dispatch'
import { securityPrReviewService } from '@/lib/services/security-pr-review.service'
import * as gh from '@/lib/integrations/github/contents'
import * as judge from '@/lib/llm/security-judge-client'
import type { HuntJob } from '@/lib/services/security-hunt.config'

const repo = prSecurityScanRepository as jest.Mocked<
  typeof prSecurityScanRepository
>
const wsRepo = workspaceRepository as jest.Mocked<typeof workspaceRepository>
const prRepo = pullRequestRepository as jest.Mocked<
  typeof pullRequestRepository
>
const projRepo = projectRepository as jest.Mocked<typeof projectRepository>
const fetchPrDiff = gh.fetchPrDiff as jest.Mock
const fetchPrHeadSha = gh.fetchPrHeadSha as jest.Mock
const judgeSecurity = judge.judgeSecurity as jest.Mock
const startManaged = startSecurityManagedScan as jest.Mock
const startBaseline = startSecurityBaselineScan as jest.Mock
const startHunt = startSecurityHunt as jest.Mock
const dispatch = dispatchPrSecurityScan as jest.Mock

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
// Built at runtime so this file is not itself a secret-shaped literal.
const FAKE_AWS_KEY = ['AKIA', 'ABCDEFGHIJKLMNOP'].join('')
const SECRET_DIFF = diff('src/cfg.ts', `const k = "${FAKE_AWS_KEY}"`)

const ALL_ON = {
  securityScanEnabled: true,
  securityAiReviewEnabled: true,
  securityHuntEnabled: true,
}
const switches = (patch: Partial<typeof ALL_ON>) =>
  wsRepo.findSecuritySwitches.mockResolvedValue({ ...ALL_ON, ...patch })

const HUNT_JOB: HuntJob = {
  scanId: 's1',
  pullRequestId: 'pr1',
  taskId: 't1',
  workspaceId: 'w1',
  repo: 'o/r',
  prNumber: 7,
  headSha: 'sha-1',
  reasons: [],
  touchedSourcePaths: ['app/api/x/route.ts'],
  signalSites: [],
  managedScanStarted: false,
}

beforeEach(() => {
  jest.clearAllMocks()
  delete process.env.LUMO_SECURITY_HUNT
  delete process.env.LUMO_MANAGED_SCAN
  switches({})
  wsRepo.findSecurityPolicy.mockResolvedValue(null)
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
  projRepo.findLastSarifIngestAt.mockResolvedValue(null as never)
  projRepo.findSecurityBaseline.mockResolvedValue(null as never)
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
  delete process.env.LUMO_SECURITY_HUNT
  delete process.env.LUMO_MANAGED_SCAN
})

const runStageA = () =>
  prSecurityScanService.run({ pullRequestId: 'pr1', trigger: 'PR_EVENT' })
const persisted = () => repo.persistResult.mock.calls[0]![2]

describe('LUM-866 workspace scan switch off', () => {
  beforeEach(() => switches({ securityScanEnabled: false }))

  it('stage A returns skipped and does no scan work at all', async () => {
    await expect(runStageA()).resolves.toEqual({
      skipped: true,
      reason: 'workspace_scan_disabled',
    })
    expect(wsRepo.findSecuritySwitches).toHaveBeenCalledWith('w1')
    expect(repo.create).not.toHaveBeenCalled()
    expect(repo.persistResult).not.toHaveBeenCalled()
    expect(fetchPrDiff).not.toHaveBeenCalled()
    expect(judgeSecurity).not.toHaveBeenCalled()
    expect(startManaged).not.toHaveBeenCalled()
    expect(startHunt).not.toHaveBeenCalled()
    expect(securityPrReviewService.sync).not.toHaveBeenCalled()
  })

  it('a pushed SARIF report is discarded with no scan row and no stage A', async () => {
    await expect(
      securitySarifIngestService.resolveScan({
        url: 'https://blob/x',
        pathname: 'sarif/x.sarif.gz',
        workspaceId: 'w1',
        repository: 'o/r',
        headSha: 'sha-1',
        prNumber: 7,
        tool: 'semgrep',
      })
    ).resolves.toEqual({ kind: 'discarded', reason: 'workspace_scan_disabled' })
    expect(repo.createIfAbsent).not.toHaveBeenCalled()
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('no default-branch baseline is started, from a push or from a PR scan', async () => {
    await expect(
      securityBaselineService.requestFromPush({
        workspaceId: 'w1',
        repo: 'o/r',
        sha: 'main-1',
      })
    ).resolves.toBe('disabled')
    await expect(
      securityBaselineService.ensure({ workspaceId: 'w1', repo: 'o/r' })
    ).resolves.toBe('disabled')
    expect(startBaseline).not.toHaveBeenCalled()
  })

  it('control: with the switch on, the same PR is scanned', async () => {
    switches({})
    await expect(runStageA()).resolves.toMatchObject({ scanId: 's1' })
    expect(repo.persistResult).toHaveBeenCalledTimes(1)
  })
})

describe('LUM-866 workspace AI review switch off', () => {
  beforeEach(() => switches({ securityAiReviewEnabled: false }))

  // LUM-892: the layer reads DISABLED (off in settings), not SKIPPED — a
  // SKIPPED judge counted as a completed layer and let the scan read CLEAN.
  it('the judge is never called and reads DISABLED; the secret scan still lands its finding', async () => {
    fetchPrDiff.mockResolvedValue(SECRET_DIFF)
    await expect(runStageA()).resolves.toMatchObject({
      scanId: 's1',
      status: 'FINDINGS',
    })
    expect(judgeSecurity).not.toHaveBeenCalled()
    const p = persisted()
    expect(p.judgeStatus).toBe('SKIPPED')
    expect(p.stages).toMatchObject({ secrets: 'RAN', judge: 'DISABLED' })
    expect(p.prSummary).toBeNull()
    const rows = repo.persistResult.mock.calls[0]![1] as {
      provenance: string
    }[]
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.every(r => r.provenance === 'DETERMINISTIC')).toBe(true)
  })

  it('a diff over the review cap is not reported as an over-cap review', async () => {
    fetchPrDiff.mockResolvedValue(
      diff('src/big.ts', 'x'.repeat(400_000)) // far over the top tier
    )
    await runStageA()
    expect(judgeSecurity).not.toHaveBeenCalled()
    expect(persisted().partialCauses).not.toContain('JUDGE_OVER_CAP')
  })

  it('control: with the switch on, the judge runs', async () => {
    switches({})
    await runStageA()
    expect(judgeSecurity).toHaveBeenCalledTimes(1)
    expect(persisted().stages.judge).toBe('RAN')
  })
})

describe('LUM-866 workspace hunt switch off', () => {
  beforeEach(() => switches({ securityHuntEnabled: false }))

  // LUM-892: the layer is stamped DISABLED (off in settings) rather than
  // vanishing, so the PR shows it was not checked.
  it('stage A starts no hunt, stamps the hunt layer off in settings, and does not keep the managed VM alive for one', async () => {
    await runStageA()
    expect(startHunt).not.toHaveBeenCalled()
    expect(persisted().stages.hunt).toBe('DISABLED')
    expect(startManaged).toHaveBeenCalledTimes(1)
    expect(startManaged.mock.calls[0]![0]).toMatchObject({ huntWanted: false })
  })

  it('a batched hunt does not continue to its next batch', async () => {
    repo.disableStaleHunt.mockResolvedValue(true as never)
    await expect(
      securityHuntOpsService.continueBatchedHunt({
        job: { ...HUNT_JOB, attempt: 1 },
        next: { ...HUNT_JOB, attempt: 2, batchIndex: 1 },
      })
    ).resolves.toBe(false)
    expect(repo.claimHuntRetry).not.toHaveBeenCalled()
    expect(startHunt).not.toHaveBeenCalled()
    // LUM-901: settled as turned off right away, not left for the sweep.
    expect(repo.disableStaleHunt).toHaveBeenCalledWith(
      's1',
      1,
      HUNT_STALE_REASONS.disabled
    )
  })

  it('a faulted hunt is not re-queued', async () => {
    await expect(
      securityHuntOpsService.requeueFaultedHunt({
        job: { ...HUNT_JOB, attempt: 1 },
        reason: 'vm did not boot',
        tokenSpent: 0,
        audit: {},
      })
    ).resolves.toEqual({ requeued: false, reason: 'disabled' })
    expect(repo.claimHuntRetry).not.toHaveBeenCalled()
    expect(startHunt).not.toHaveBeenCalled()
  })

  it('the stale sweep stamps a pending hunt DISABLED with the disabled reason instead of retrying it', async () => {
    repo.disableStaleHunt.mockResolvedValue(true as never)
    repo.findStalePendingHunts.mockResolvedValue([
      {
        id: 's1',
        pullRequestId: 'pr1',
        startedAt: new Date('2026-09-28T00:00:00Z'),
        huntJob: { ...HUNT_JOB, attempt: 1 },
        huntRunId: null,
        huntAttempts: 1,
      },
    ])
    const counts = await securityHuntOpsService.sweepStaleHunts({
      now: new Date('2026-09-28T02:00:00Z'),
    })
    expect(counts).toMatchObject({ retried: 0, failed: 1 })
    // LUM-901: the customer's switch, so DISABLED — never FAILED (ours).
    expect(repo.disableStaleHunt).toHaveBeenCalledWith(
      's1',
      1,
      HUNT_STALE_REASONS.disabled
    )
    expect(repo.failStaleHunt).not.toHaveBeenCalled()
    expect(startHunt).not.toHaveBeenCalled()
  })

  it('control: with the switch on, the same PR starts a hunt', async () => {
    switches({})
    await runStageA()
    expect(startHunt).toHaveBeenCalledTimes(1)
    expect(persisted().stages.hunt).toBe('PENDING')
  })
})
