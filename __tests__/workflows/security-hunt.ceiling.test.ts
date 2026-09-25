/**
 * @jest-environment node
 *
 * LUM-832 — the hunt's retries and continuations are bounded by SAFETY
 * ceilings, never by a routine cap. A sandbox or gateway outage is not a
 * fault in the customer's code, so it is retried with backoff; every batch of
 * a batched hunt keeps its own retries; and reaching a ceiling is an outage
 * or a loop of ours — it records HUNT_CEILING (our fault, counted by the
 * reliability read-out) and logs a tagged error.
 */
jest.mock('workflow', () => ({ sleep: jest.fn().mockResolvedValue(undefined) }))
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
}))
jest.mock('@/lib/workflows/security-sarif-ingest.steps', () => ({
  persistSarifFindingsStep: jest.fn(),
  markSarifExternalFailedStep: jest.fn(),
  deleteSarifBlobStep: jest.fn(),
}))
jest.mock('@/lib/workflows/security-suggest.steps', () => ({
  suggestDispositionsStep: jest.fn().mockResolvedValue(undefined),
}))
jest.mock('@/lib/workflows/security-pr-review.steps', () => ({
  syncPrReviewStep: jest.fn().mockResolvedValue(undefined),
}))
jest.mock('@/lib/logger', () => ({
  logger: {
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
}))
jest.mock('@/lib/integrations/github/auth', () => ({
  getGithubInstallationToken: jest.fn().mockResolvedValue('tok'),
}))
jest.mock('@/lib/integrations/github/contents', () => ({
  fetchPrDiff: jest.fn(),
  readRepoFile: jest.fn(),
}))
jest.mock('@/lib/llm/security-hunt-client', () => ({ huntTask: jest.fn() }))
jest.mock('@/lib/services/security-hunt-sandbox', () => ({
  attachOrCreateHuntSandbox: jest.fn(),
  probeHuntTools: jest.fn(),
  runHuntShell: jest.fn(),
  readHuntFile: jest.fn(),
  stopHuntSandbox: jest.fn(),
}))
jest.mock('@/lib/llm/security-falsifier-client', () => ({
  falsifyCandidate: jest.fn(),
}))
jest.mock('@/lib/llm/security-hunt-plan-client', () => ({
  planHuntTasks: jest.fn(),
}))
jest.mock('@/lib/repositories/pr-security-scan.repository', () => ({
  prSecurityScanRepository: {
    findDispositionedByPullRequest: jest.fn(),
    persistHuntResult: jest.fn(),
    findFindingSummaryByScan: jest.fn(),
    hasNewerScanThan: jest.fn(),
    claimHuntRetry: jest.fn(),
    setHuntRunId: jest.fn(),
    failStaleHunt: jest.fn(),
    findStalePendingHunts: jest.fn(),
    hasNewerScan: jest.fn(),
  },
}))
jest.mock('@/lib/integrations/vercel-sandbox', () => ({
  stopRepoSandboxesByTag: jest.fn().mockResolvedValue(0),
}))
jest.mock('@/lib/services/security-hunt-start', () => ({
  startSecurityHunt: jest.fn(),
  cancelHuntRun: jest.fn(),
}))
jest.mock('@/lib/services/security-pr-review.service', () => ({
  securityPrReviewService: { sync: jest.fn() },
}))

import { sleep } from 'workflow'
import { securityHuntWorkflow } from '@/lib/workflows/security-hunt'
import {
  buildVerifySubgraphStep,
  planHuntStep,
  huntTaskStep,
  mechanicalVerifyStep,
  persistHuntFindingsStep,
  requeueHuntStep,
  continueHuntStep,
} from '@/lib/workflows/security-hunt.steps'
import {
  HUNT_CEILING_ALERT_TAG,
  HUNT_MAX_ATTEMPTS,
  HUNT_MAX_CONTINUATIONS,
  huntRetryDelayMs,
  type HuntJob,
  type HuntTask,
} from '@/lib/services/security-hunt.config'
import { securityHuntService } from '@/lib/services/security-hunt.service'
import { securityHuntOpsService } from '@/lib/services/security-hunt-ops.service'
import { prSecurityScanRepository } from '@/lib/repositories/pr-security-scan.repository'
import { startSecurityHunt } from '@/lib/services/security-hunt-start'
import { logger } from '@/lib/logger'
import { summarizeScanReliability } from '@/lib/security-scan/reliability'
import { partialCauseClass } from '@/shared/src/security-scan'

const plan = planHuntStep as jest.Mock
const hunt = huntTaskStep as jest.Mock
const verifyGraph = buildVerifySubgraphStep as jest.Mock
const verify = mechanicalVerifyStep as jest.Mock
const persist = persistHuntFindingsStep as jest.Mock
const requeue = requeueHuntStep as jest.Mock
const cont = continueHuntStep as jest.Mock
const repo = prSecurityScanRepository as jest.Mocked<
  typeof prSecurityScanRepository
>
const startHunt = startSecurityHunt as jest.Mock
const sleepMock = sleep as unknown as jest.Mock

const JOB: HuntJob = {
  scanId: 's1',
  pullRequestId: 'pr1',
  taskId: 't1',
  workspaceId: 'w1',
  repo: 'o/r',
  prNumber: 7,
  headSha: 'a'.repeat(40),
  reasons: ['diff:sink:prisma-raw'],
  touchedSourcePaths: ['lib/a.ts'],
  managedScanStarted: true,
}
const T1: HuntTask = {
  id: 't1',
  objective: 'o',
  category: 'injection',
  startingPoints: ['lib/a.ts'],
}
const timeout = {
  candidates: [],
  tokens: 10,
  elapsedMs: 10,
  stopped: 'timeout',
}

beforeEach(() => {
  jest.resetAllMocks()
  sleepMock.mockResolvedValue(undefined)
  plan.mockResolvedValue({ tasks: [T1], reason: 'r', by: 'model', tokens: 1 })
  verifyGraph.mockResolvedValue({
    subgraph: { symbols: [], edges: [], files: [] },
    evidence: { sightings: [], fileSightings: [], missingFiles: [] },
  })
  verify.mockResolvedValue({ accepted: [], rejected: [] })
})

describe('the safety ceiling is an alert not a routine cap', () => {
  it('an infrastructure fault gets several tries, each waiting longer than the last', () => {
    expect(HUNT_MAX_ATTEMPTS).toBeGreaterThanOrEqual(5)
    const delays = Array.from({ length: HUNT_MAX_ATTEMPTS }, (_, i) =>
      huntRetryDelayMs(i + 1)
    )
    expect(delays[0]).toBe(0)
    for (let i = 1; i < delays.length; i++)
      expect(delays[i]!).toBeGreaterThan(delays[i - 1]!)
  })

  it('a retry waits out its backoff before it hunts; a first try does not wait', async () => {
    hunt.mockResolvedValue({ ...timeout, stopped: 'done' })
    await securityHuntWorkflow({ ...JOB, attempt: 3, tries: 3 })
    expect(sleepMock).toHaveBeenCalledWith(huntRetryDelayMs(3))
    sleepMock.mockClear()
    await securityHuntWorkflow(JOB)
    expect(sleepMock).not.toHaveBeenCalled()
  })

  it('below the ceiling an infrastructure fault is retried — on every batch, whatever the row’s attempt count', async () => {
    hunt.mockResolvedValue(timeout)
    requeue.mockResolvedValue({ requeued: true, attempt: 8 })
    // Batch 3 of a batched hunt: the fence is at 7, but this batch is on its
    // first try. (Reading `attempt` here once meant it was never retried.)
    await expect(
      securityHuntWorkflow({
        ...JOB,
        batches: [['lib/x.ts'], ['lib/y.ts'], ['lib/a.ts']],
        batchIndex: 2,
        attempt: 7,
        tries: 1,
      })
    ).resolves.toMatchObject({ outcome: 'REQUEUED' })
    expect(requeue).toHaveBeenCalledTimes(1)
    // The service agrees: a batch's tries, not the fence, are the budget.
    repo.hasNewerScanThan.mockResolvedValue(false)
    repo.claimHuntRetry.mockResolvedValue(true)
    startHunt.mockResolvedValue('run_8')
    await expect(
      securityHuntOpsService.requeueFaultedHunt({
        job: { ...JOB, attempt: 7, tries: 1 },
        reason: 'sandbox',
        tokenSpent: 0,
        audit: {},
      })
    ).resolves.toEqual({ requeued: true, attempt: 8 })
    expect(startHunt).toHaveBeenCalledWith(
      expect.objectContaining({ attempt: 8, tries: 2 })
    )
  })

  it('at the retry ceiling the fault is not retried: the layer lands PARTIAL with HUNT_CEILING', async () => {
    hunt.mockResolvedValue(timeout)
    await expect(
      securityHuntWorkflow({ ...JOB, attempt: 9, tries: HUNT_MAX_ATTEMPTS })
    ).resolves.toMatchObject({ outcome: 'PARTIAL' })
    expect(requeue).not.toHaveBeenCalled()
    expect(persist.mock.calls[0]![0]).toMatchObject({
      stage: 'PARTIAL',
      partialCauses: ['HUNT_INCOMPLETE', 'HUNT_CEILING'],
    })
  })

  it('a hunt step that threw at the retry ceiling still lands its causes rather than a bare FAILED', async () => {
    hunt.mockRejectedValue(new Error('sandbox create failed: 503'))
    await expect(
      securityHuntWorkflow({ ...JOB, tries: HUNT_MAX_ATTEMPTS })
    ).resolves.toMatchObject({ outcome: 'PARTIAL' })
    expect(persist.mock.calls[0]![0].partialCauses).toEqual([
      'HUNT_INCOMPLETE',
      'HUNT_CEILING',
    ])
  })

  it('at the continuation ceiling a task still progressing is stopped and recorded as ours, not as a budget', async () => {
    hunt.mockResolvedValue({
      candidates: [
        {
          category: 'injection',
          cwe: 'CWE-89',
          severity: 'HIGH',
          sink: { symbol: 's', file: 'lib/a.ts', line: 2 },
          entry: { symbol: 'x', file: 'lib/a.ts', line: 1 },
          call_chain: [{ from: 'x', to: 's' }],
          precondition: 'p',
          claim: 'c',
          reachability: 'EXTERNAL',
          fingerprint: 'fp',
        },
      ],
      tokens: 10,
      elapsedMs: 10,
      stopped: 'budget',
      wrapUp: { ran: false, skipped: 'no-budget' },
    })
    await expect(
      securityHuntWorkflow({
        ...JOB,
        attempt: 12,
        tries: 1,
        resumeTasks: [T1],
        resumeRound: HUNT_MAX_CONTINUATIONS,
        carriedStage: 'RAN',
      })
    ).resolves.toMatchObject({ outcome: 'PARTIAL' })
    expect(cont).not.toHaveBeenCalled()
    expect(persist.mock.calls[0]![0].partialCauses).toEqual([
      'HUNT_BUDGET_SHORT',
      'HUNT_CEILING',
    ])
  })

  it('a ceiling that lands raises the tagged alert where the cause is written', async () => {
    repo.findDispositionedByPullRequest.mockResolvedValue([])
    await securityHuntService.persist({
      job: { ...JOB, tries: HUNT_MAX_ATTEMPTS },
      findings: [],
      audit: {
        candidates: 0,
        rejected: [],
        falsifierRejects: 0,
        falsifierRejected: [],
        tasks: [],
        subgraph: { files: 0, symbols: 0, edges: 0, partial: false },
      },
      tokenSpent: 0,
      partialCauses: ['HUNT_INCOMPLETE', 'HUNT_CEILING'],
      stage: 'PARTIAL',
    })
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining(
        `${HUNT_CEILING_ALERT_TAG} ceiling reached scan=s1`
      )
    )
    ;(logger.error as jest.Mock).mockClear()
    // An ordinary PARTIAL is not an alert.
    await securityHuntService.persist({
      job: JOB,
      findings: [],
      audit: {
        candidates: 0,
        rejected: [],
        falsifierRejects: 0,
        falsifierRejected: [],
        tasks: [],
        subgraph: { files: 0, symbols: 0, edges: 0, partial: false },
      },
      tokenSpent: 0,
      partialCauses: ['HUNT_BUDGET_SHORT'],
      stage: 'PARTIAL',
    })
    expect(logger.error).not.toHaveBeenCalled()
  })

  it('a hunt that never reported through every try is failed by the sweep with HUNT_CEILING and the alert', async () => {
    repo.findStalePendingHunts.mockResolvedValue([
      {
        id: 's1',
        pullRequestId: 'pr1',
        startedAt: new Date(0),
        huntJob: { ...JOB, attempt: 6, tries: HUNT_MAX_ATTEMPTS },
        huntRunId: null,
        huntAttempts: 6,
      },
    ])
    repo.failStaleHunt.mockResolvedValue(true)
    await securityHuntOpsService.sweepStaleHunts()
    expect(repo.failStaleHunt).toHaveBeenCalledWith(
      's1',
      6,
      expect.any(String),
      ['HUNT_CEILING']
    )
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining(`${HUNT_CEILING_ALERT_TAG} retry ceiling scan=s1`)
    )
  })

  it('the reliability read-out counts every ceiling hit, as our fault', () => {
    expect(partialCauseClass('HUNT_CEILING')).toBe('OUR_FAULT')
    const r = summarizeScanReliability([
      {
        status: 'CLEAN',
        stages: { secrets: 'RAN', hunt: 'PARTIAL' },
        partial: true,
        partialCauses: ['HUNT_INCOMPLETE', 'HUNT_CEILING'],
        huntAudit: null,
      },
      {
        status: 'CLEAN',
        stages: { secrets: 'RAN', hunt: 'PARTIAL' },
        partial: true,
        partialCauses: ['HUNT_BUDGET_SHORT'],
        huntAudit: null,
      },
    ])
    expect(r.ceilingHits).toBe(1)
    expect(r.ourFault).toBe(1)
    expect(r.coverageOwedOnly).toBe(1)
  })
})
