/**
 * @jest-environment node
 *
 * LUM-832 — an infrastructure fault gets its one retry on EVERY batch of a
 * batched hunt. The workflow used to decide eligibility from `attempt` — the
 * row's write fence, which keeps counting across batches — so on a diff big
 * enough to batch, batch 2 onwards was never retried at all. The budget is
 * the batch's own `tries`.
 */
// LUM-866: every workspace here has the default switches (all on); the
// platform env in each test still decides the ceiling.
jest.mock('@/lib/services/security-workspace-switches.service', () => ({
  // A plain function, not jest.fn: survives resetAllMocks.
  loadSecurityLayers: async () =>
    jest
      .requireActual('@/lib/security-scan/workspace-switches')
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
jest.mock('@/lib/workflows/security-suggest.steps', () => ({
  suggestDispositionsStep: jest.fn().mockResolvedValue(undefined),
}))
jest.mock('@/lib/workflows/security-pr-review.steps', () => ({
  syncPrReviewStep: jest.fn().mockResolvedValue(undefined),
}))
jest.mock('@/lib/logger', () => ({
  logger: { error: jest.fn(), info: jest.fn(), warn: jest.fn() },
}))
jest.mock('@/lib/repositories/pr-security-scan.repository', () => ({
  prSecurityScanRepository: {
    hasNewerScanThan: jest.fn(),
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

import { securityHuntWorkflow } from '@/lib/workflows/security-hunt'
import {
  buildVerifySubgraphStep,
  planHuntStep,
  huntTaskStep,
  mechanicalVerifyStep,
  persistHuntFindingsStep,
  requeueHuntStep,
} from '@/lib/workflows/security-hunt.steps'
import { prSecurityScanRepository } from '@/lib/repositories/pr-security-scan.repository'
import { startSecurityHunt } from '@/lib/services/security-hunt-start'
import { securityHuntOpsService } from '@/lib/services/security-hunt-ops.service'
import {
  HUNT_MAX_ATTEMPTS,
  type HuntJob,
  type HuntTask,
} from '@/lib/services/security-hunt.config'

const plan = planHuntStep as jest.Mock
const hunt = huntTaskStep as jest.Mock
const verifyGraph = buildVerifySubgraphStep as jest.Mock
const verify = mechanicalVerifyStep as jest.Mock
const persist = persistHuntFindingsStep as jest.Mock
const requeue = requeueHuntStep as jest.Mock
const repo = prSecurityScanRepository as jest.Mocked<
  typeof prSecurityScanRepository
>
const startHunt = startSecurityHunt as jest.Mock

const T1: HuntTask = {
  id: 't1',
  objective: 'o',
  category: 'injection',
  startingPoints: ['lib/z.ts'],
}
/** Batch 3 of a batched hunt: the fence is at 7, the batch on its first try. */
const BATCH_3: HuntJob = {
  scanId: 's1',
  pullRequestId: 'pr1',
  taskId: 't1',
  workspaceId: 'w1',
  repo: 'o/r',
  prNumber: 7,
  headSha: 'a'.repeat(40),
  reasons: ['diff:sink:prisma-raw'],
  touchedSourcePaths: ['lib/x.ts', 'lib/y.ts', 'lib/z.ts'],
  managedScanStarted: false,
  batches: [['lib/x.ts'], ['lib/y.ts'], ['lib/z.ts']],
  batchIndex: 2,
  attempt: 7,
  tries: 1,
}
const timeout = {
  candidates: [],
  tokens: 10,
  elapsedMs: 10,
  stopped: 'timeout',
}

beforeEach(() => {
  jest.resetAllMocks()
  plan.mockResolvedValue({ tasks: [T1], reason: 'r', by: 'model', tokens: 1 })
  verifyGraph.mockResolvedValue({
    subgraph: { symbols: [], edges: [], files: [] },
    evidence: { sightings: [], fileSightings: [], missingFiles: [] },
  })
  verify.mockResolvedValue({ accepted: [], rejected: [] })
})

describe('every batch keeps its own infrastructure retry', () => {
  it('a later batch on its first try is retried, whatever the row’s attempt count', async () => {
    hunt.mockResolvedValue(timeout)
    requeue.mockResolvedValue({ requeued: true, attempt: 8 })
    await expect(securityHuntWorkflow(BATCH_3)).resolves.toMatchObject({
      outcome: 'REQUEUED',
    })
    expect(requeue).toHaveBeenCalledTimes(1)
    expect(persist).not.toHaveBeenCalled()
  })

  it('the service agrees: the batch’s tries are the budget, and the retry carries the next try', async () => {
    repo.hasNewerScanThan.mockResolvedValue(false)
    repo.claimHuntRetry.mockResolvedValue(true)
    startHunt.mockResolvedValue('run_8')
    await expect(
      securityHuntOpsService.requeueFaultedHunt({
        job: BATCH_3,
        reason: 'sandbox create failed',
        tokenSpent: 0,
        audit: {},
      })
    ).resolves.toEqual({ requeued: true, attempt: 8 })
    expect(startHunt).toHaveBeenCalledWith(
      expect.objectContaining({ attempt: 8, tries: 2, batchIndex: 2 })
    )
  })

  it('a batch that already had its retry is not retried again: one retry, as before', async () => {
    hunt.mockResolvedValue(timeout)
    await expect(
      securityHuntWorkflow({ ...BATCH_3, attempt: 8, tries: HUNT_MAX_ATTEMPTS })
    ).resolves.toMatchObject({ outcome: 'PARTIAL' })
    expect(requeue).not.toHaveBeenCalled()
    // Out of tries on the last batch: the layer lands PARTIAL, owned.
    expect(persist.mock.calls[0]![0].partialCauses).toEqual(['HUNT_INCOMPLETE'])
    // One retry per batch: stage A's try plus one.
    expect(HUNT_MAX_ATTEMPTS).toBe(2)
  })
})
