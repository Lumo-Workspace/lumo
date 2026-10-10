/**
 * @jest-environment node
 *
 * LUM-832 — a hunt attempt that ended on OUR fault (a VM that would not
 * boot, a gateway that dropped the call, a clock that ran out) is not a
 * conclusion. While an attempt is left, it hands the layer to the next one:
 * nothing is persisted, `stages.hunt` stays PENDING, and the customer reads
 * "scanning" until the retry lands. Only once the attempts are exhausted does
 * the scan read unfinished-on-our-side.
 */
// LUM-866: every workspace here has the default switches (all on); the
// platform env in each test still decides the ceiling.
jest.mock('@/ee/security/services/security-workspace-switches.service', () => ({
  // A plain function, not jest.fn: survives resetAllMocks.
  loadSecurityLayers: async () =>
    jest
      .requireActual('@/ee/security/security-scan/workspace-switches')
      .resolveSecurityLayers(null),
}))
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
jest.mock('@/lib/logger', () => ({
  logger: { error: jest.fn(), info: jest.fn(), warn: jest.fn() },
}))
jest.mock('@/ee/security/repositories/pr-security-scan.repository', () => ({
  prSecurityScanRepository: {
    hasNewerScanThan: jest.fn(),
    claimHuntRetry: jest.fn(),
    setHuntRunId: jest.fn(),
    failStaleHunt: jest.fn(),
  },
}))
jest.mock('@/ee/security/integrations/vercel-sandbox', () => ({
  stopRepoSandboxesByTag: jest.fn(),
}))
jest.mock('@/ee/security/services/security-hunt-start', () => ({
  startSecurityHunt: jest.fn(),
  cancelHuntRun: jest.fn(),
}))
jest.mock('@/ee/security/services/security-pr-review.service', () => ({
  securityPrReviewService: { sync: jest.fn() },
}))

import { securityHuntWorkflow } from '@/lib/workflows/security-hunt'
import {
  buildVerifySubgraphStep,
  planHuntStep,
  huntTaskStep,
  mechanicalVerifyStep,
  falsifierStep,
  persistHuntFindingsStep,
  markHuntFailedStep,
  requeueHuntStep,
} from '@/lib/workflows/security-hunt.steps'
import { prSecurityScanRepository } from '@/ee/security/repositories/pr-security-scan.repository'
import {
  cancelHuntRun,
  startSecurityHunt,
} from '@/ee/security/services/security-hunt-start'
import { stopRepoSandboxesByTag } from '@/ee/security/integrations/vercel-sandbox'
import { securityPrReviewService } from '@/ee/security/services/security-pr-review.service'
import {
  securityHuntOpsService,
  HUNT_STALE_REASONS,
} from '@/ee/security/services/security-hunt-ops.service'
import {
  HUNT_MAX_ATTEMPTS,
  type HuntJob,
  type HuntTask,
} from '@/ee/security/services/security-hunt.config'
import { scanCoverageState } from '@/shared/src/security-scan'

const plan = planHuntStep as jest.Mock
const hunt = huntTaskStep as jest.Mock
const verify = mechanicalVerifyStep as jest.Mock
const verifyGraph = buildVerifySubgraphStep as jest.Mock
const falsify = falsifierStep as jest.Mock
const persist = persistHuntFindingsStep as jest.Mock
const markFailed = markHuntFailedStep as jest.Mock
const requeue = requeueHuntStep as jest.Mock
const repo = prSecurityScanRepository as jest.Mocked<
  typeof prSecurityScanRepository
>
const startHunt = startSecurityHunt as jest.Mock
const cancel = cancelHuntRun as jest.Mock
const stopByTag = stopRepoSandboxesByTag as jest.Mock
const sync = securityPrReviewService.sync as jest.Mock

const JOB: HuntJob = {
  scanId: 's1',
  pullRequestId: 'pr1',
  taskId: 't1',
  workspaceId: 'w1',
  repo: 'o/r',
  prNumber: 7,
  headSha: 'a'.repeat(40),
  reasons: ['diff:sink:prisma-raw'],
  touchedSourcePaths: ['lib/s.ts'],
  managedScanStarted: true,
}
const TASK: HuntTask = {
  id: 't1',
  objective: 'raw SQL built from req.query',
  category: 'injection',
  startingPoints: ['lib/db.ts'],
}
const candidate = {
  category: 'injection',
  cwe: 'CWE-89',
  severity: 'HIGH',
  sink: { symbol: 's', file: 'a.ts', line: 2 },
  entry: { symbol: 'x', file: 'a.ts', line: 1 },
  call_chain: [{ from: 'x', to: 's' }],
  precondition: 'p',
  claim: 'c',
  reachability: 'EXTERNAL',
  fingerprint: 'f1',
}

beforeEach(() => {
  jest.resetAllMocks()
  plan.mockResolvedValue({
    tasks: [TASK],
    reason: 'r',
    by: 'model',
    tokens: 50,
  })
  verifyGraph.mockResolvedValue({
    subgraph: { symbols: [], edges: [], files: [] },
    evidence: { sightings: [], fileSightings: [], missingFiles: [] },
  })
  verify.mockResolvedValue({ accepted: [], rejected: [] })
})

describe('our-fault hunt is re-queued and reads as in progress', () => {
  it('a task that timed out twice hands attempt 1 to attempt 2: nothing persisted, nothing falsified', async () => {
    hunt.mockResolvedValue({
      candidates: [candidate],
      tokens: 100,
      elapsedMs: 1000,
      stopped: 'timeout',
    })
    requeue.mockResolvedValue({ requeued: true, attempt: 2 })
    const out = await securityHuntWorkflow(JOB)
    expect(out).toMatchObject({ outcome: 'REQUEUED', scanId: 's1', attempt: 2 })
    expect(requeue).toHaveBeenCalledTimes(1)
    const input = requeue.mock.calls[0]![0]
    expect(input.job).toEqual(JOB)
    // Plan + pass 1 + the pass-2 retry of the timed-out task.
    expect(input.tokenSpent).toBe(250)
    expect(input.reason).toMatch(/did not terminate/)
    // The retry redoes the work: no half-answer lands, no falsifier paid for.
    expect(persist).not.toHaveBeenCalled()
    expect(markFailed).not.toHaveBeenCalled()
    expect(verify).not.toHaveBeenCalled()
    expect(falsify).not.toHaveBeenCalled()
  })

  it('a hunting step that threw with nothing salvaged is re-queued instead of stamped FAILED', async () => {
    hunt.mockRejectedValue(new Error('sandbox create failed: 503'))
    requeue.mockResolvedValue({ requeued: true, attempt: 2 })
    const out = await securityHuntWorkflow(JOB)
    expect(out).toMatchObject({ outcome: 'REQUEUED', attempt: 2 })
    expect(requeue.mock.calls[0]![0].reason).toContain('sandbox create failed')
    expect(markFailed).not.toHaveBeenCalled()
  })

  it('a failure in verification is ours too and is re-queued', async () => {
    hunt.mockResolvedValue({
      candidates: [candidate],
      tokens: 100,
      elapsedMs: 1000,
      stopped: 'done',
    })
    verify.mockRejectedValue(new Error('gateway 502'))
    requeue.mockResolvedValue({ requeued: true, attempt: 2 })
    await expect(securityHuntWorkflow(JOB)).resolves.toMatchObject({
      outcome: 'REQUEUED',
    })
    expect(markFailed).not.toHaveBeenCalled()
  })

  it('a clean run is never re-queued', async () => {
    hunt.mockResolvedValue({
      candidates: [],
      tokens: 100,
      elapsedMs: 1000,
      stopped: 'done',
    })
    await expect(securityHuntWorkflow(JOB)).resolves.toMatchObject({
      outcome: 'RAN',
    })
    expect(requeue).not.toHaveBeenCalled()
  })

  it('the last attempt does not re-queue: it persists PARTIAL with our cause, which reads unfinished', async () => {
    hunt.mockResolvedValue({
      candidates: [],
      tokens: 100,
      elapsedMs: 1000,
      stopped: 'timeout',
    })
    await expect(
      securityHuntWorkflow({ ...JOB, attempt: HUNT_MAX_ATTEMPTS })
    ).resolves.toMatchObject({ outcome: 'PARTIAL' })
    expect(requeue).not.toHaveBeenCalled()
    expect(persist.mock.calls[0]![0]).toMatchObject({
      stage: 'PARTIAL',
      partialCauses: ['HUNT_INCOMPLETE'],
    })
  })

  it('a re-queue that did not happen (claim lost, PR moved on) persists exactly as before', async () => {
    hunt.mockResolvedValue({
      candidates: [],
      tokens: 100,
      elapsedMs: 1000,
      stopped: 'timeout',
    })
    requeue.mockResolvedValue({ requeued: false, reason: 'superseded' })
    await expect(securityHuntWorkflow(JOB)).resolves.toMatchObject({
      outcome: 'PARTIAL',
    })
    expect(persist).toHaveBeenCalledTimes(1)
  })

  describe('requeueFaultedHunt', () => {
    const input = {
      job: JOB,
      reason: 'sandbox create failed',
      tokenSpent: 250,
      audit: { candidates: 1 },
    }

    it('claims the next attempt with the faulted audit and spend, then starts it on a fresh VM', async () => {
      repo.hasNewerScanThan.mockResolvedValue(false)
      repo.claimHuntRetry.mockResolvedValue(true)
      startHunt.mockResolvedValue('run_2')
      await expect(
        securityHuntOpsService.requeueFaultedHunt(input)
      ).resolves.toEqual({ requeued: true, attempt: 2 })
      const nextJob = {
        ...JOB,
        attempt: 2,
        tries: 2,
        managedScanStarted: false,
      }
      expect(repo.claimHuntRetry).toHaveBeenCalledWith('s1', 1, {
        faulted: {
          huntAudit: {
            candidates: 1,
            requeued: { fromAttempt: 1, reason: 'sandbox create failed' },
          },
          tokenSpent: 250,
        },
        // The sweep retries from `huntJob`: it must name the try it is on.
        huntJob: nextJob,
      })
      expect(startHunt).toHaveBeenCalledWith(nextJob)
      expect(repo.setHuntRunId).toHaveBeenCalledWith('s1', 'run_2')
      // The caller IS the old run: it is neither cancelled nor its VMs stopped.
      expect(cancel).not.toHaveBeenCalled()
      expect(stopByTag).not.toHaveBeenCalled()
      // Nothing re-synced: the PR summary keeps reading "scanning".
      expect(sync).not.toHaveBeenCalled()
    })

    it('the claim leaves the layer PENDING, which every surface reads as in progress', () => {
      // The claim's CAS only matches a PENDING hunt and writes no stage, so
      // the row the customer sees between attempts is exactly this one.
      expect(
        scanCoverageState({
          status: 'CLEAN',
          stages: { secrets: 'RAN', judge: 'RAN', hunt: 'PENDING' },
          partial: false,
        })
      ).toBe('IN_PROGRESS')
    })

    it('does nothing once the attempts are exhausted', async () => {
      await expect(
        securityHuntOpsService.requeueFaultedHunt({
          ...input,
          job: { ...JOB, attempt: HUNT_MAX_ATTEMPTS },
        })
      ).resolves.toEqual({ requeued: false, reason: 'exhausted' })
      expect(repo.claimHuntRetry).not.toHaveBeenCalled()
    })

    it('does not retry an old head once the PR has moved on', async () => {
      repo.hasNewerScanThan.mockResolvedValue(true)
      await expect(
        securityHuntOpsService.requeueFaultedHunt(input)
      ).resolves.toEqual({ requeued: false, reason: 'superseded' })
      expect(repo.claimHuntRetry).not.toHaveBeenCalled()
    })

    it('leaves the row to whoever claimed first', async () => {
      repo.hasNewerScanThan.mockResolvedValue(false)
      repo.claimHuntRetry.mockResolvedValue(false)
      await expect(
        securityHuntOpsService.requeueFaultedHunt(input)
      ).resolves.toEqual({ requeued: false, reason: 'claim-lost' })
      expect(startHunt).not.toHaveBeenCalled()
    })

    it('a retry that cannot start is stamped FAILED at the claimed attempt and synced', async () => {
      repo.hasNewerScanThan.mockResolvedValue(false)
      repo.claimHuntRetry.mockResolvedValue(true)
      startHunt.mockResolvedValue(null)
      await expect(
        securityHuntOpsService.requeueFaultedHunt(input)
      ).resolves.toEqual({ requeued: false, reason: 'start-failed' })
      expect(repo.failStaleHunt).toHaveBeenCalledWith(
        's1',
        2,
        HUNT_STALE_REASONS.retryNotStarted
      )
      expect(sync).toHaveBeenCalledWith('s1')
    })
  })
})
