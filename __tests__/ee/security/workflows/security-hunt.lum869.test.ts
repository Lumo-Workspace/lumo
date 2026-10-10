/**
 * @jest-environment node
 *
 * LUM-869 — the hunt used to wait for the managed scan's hand-off inside its
 * first batch, out of that batch's own window, and the 90 s it allowed lost
 * the race to a 126 s scan anyway. The wait now runs in a step of its own,
 * before pass 1, and a batch's window is the same whether or not it ran.
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
  awaitManagedScanStep,
  buildVerifySubgraphStep,
  planHuntStep,
  huntTaskStep,
  mechanicalVerifyStep,
} from '@/lib/workflows/security-hunt.steps'
import {
  HUNT_BATCH_WINDOW_CEILING_MS,
  HUNT_MANAGED_SCAN_HANDOFF_WAIT_MS,
  type HuntJob,
  type HuntTask,
} from '@/ee/security/services/security-hunt.config'

const wait = awaitManagedScanStep as jest.Mock
const plan = planHuntStep as jest.Mock
const hunt = huntTaskStep as jest.Mock

const T1: HuntTask = {
  id: 't1',
  objective: 'o',
  category: 'injection',
  startingPoints: ['lib/x.ts'],
}
const JOB: HuntJob = {
  scanId: 's1',
  pullRequestId: 'pr1',
  taskId: 't1',
  workspaceId: 'w1',
  repo: 'o/r',
  prNumber: 7,
  headSha: 'a'.repeat(40),
  reasons: ['diff:sink:prisma-raw'],
  touchedSourcePaths: ['lib/x.ts'],
  managedScanStarted: true,
}

beforeEach(() => {
  jest.resetAllMocks()
  plan.mockResolvedValue({ tasks: [T1], reason: 'r', by: 'model', tokens: 1 })
  hunt.mockResolvedValue({
    candidates: [],
    tokens: 10,
    elapsedMs: 10,
    stopped: 'done',
  })
  ;(buildVerifySubgraphStep as jest.Mock).mockResolvedValue({
    subgraph: { symbols: [], edges: [], files: [] },
    evidence: { sightings: [], fileSightings: [], missingFiles: [] },
  })
  ;(mechanicalVerifyStep as jest.Mock).mockResolvedValue({
    accepted: [],
    rejected: [],
  })
})

describe('LUM-869 hand-off wait', () => {
  it('LUM-869 hunt waits for the managed scan outside the batch clock', async () => {
    // Bounds: longer than the measured 126 s scan, inside a 300 s step.
    expect(HUNT_MANAGED_SCAN_HANDOFF_WAIT_MS).toBeGreaterThan(126_000)
    expect(HUNT_MANAGED_SCAN_HANDOFF_WAIT_MS).toBeLessThanOrEqual(
      HUNT_BATCH_WINDOW_CEILING_MS
    )

    // No managed scan: no wait, and the batch's window as allocated.
    wait.mockResolvedValue(true)
    await securityHuntWorkflow({ ...JOB, managedScanStarted: false })
    expect(wait).not.toHaveBeenCalled()
    const alone = hunt.mock.calls[0][0].timeBudgetMs

    // A managed scan: the wait runs first, in its own step …
    hunt.mockClear()
    await securityHuntWorkflow(JOB)
    expect(wait).toHaveBeenCalledWith({ scanId: 's1' })
    expect(wait.mock.invocationCallOrder[0]).toBeLessThan(
      hunt.mock.invocationCallOrder[0]!
    )
    // … and the batch's window is exactly what it was without one.
    expect(hunt.mock.calls[0][0].timeBudgetMs).toBe(alone)

    // A wait that failed outright is an optimisation lost, not a hunt lost.
    hunt.mockClear()
    wait.mockRejectedValue(new Error('step retries exhausted'))
    await expect(securityHuntWorkflow(JOB)).resolves.toMatchObject({
      outcome: expect.not.stringMatching(/FAILED/),
    })
    expect(hunt).toHaveBeenCalledTimes(1)
  })
})
