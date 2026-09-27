/**
 * @jest-environment node
 *
 * LUM-832 — a hunt task can fall short for two reasons that want different
 * remedies. Our infrastructure broke (random → retry the run once). Or the
 * budget WE set ran out (structural → the same run would hit the same wall).
 * The second is coverage owed, not a fault: it is not retried with the same
 * budget, the layer ends unfinished at once (HUNT_BUDGET_SHORT), and what the
 * finished tasks found is kept. Parity with CodeRabbit, not more (user
 * ruling): no further continuation.
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

import { securityHuntWorkflow } from '@/lib/workflows/security-hunt'
import {
  buildVerifySubgraphStep,
  planHuntStep,
  huntTaskStep,
  mechanicalVerifyStep,
  falsifierStep,
  persistHuntFindingsStep,
  requeueHuntStep,
  continueHuntStep,
} from '@/lib/workflows/security-hunt.steps'
import {
  huntShortfall,
  type HuntJob,
  type HuntTask,
} from '@/lib/services/security-hunt.config'
import { summarizeScanReliability } from '@/lib/security-scan/reliability'
import {
  partialCauseClass,
  scanCoverageState,
} from '@/shared/src/security-scan'

const plan = planHuntStep as jest.Mock
const hunt = huntTaskStep as jest.Mock
const verifyGraph = buildVerifySubgraphStep as jest.Mock
const verify = mechanicalVerifyStep as jest.Mock
const falsify = falsifierStep as jest.Mock
const persist = persistHuntFindingsStep as jest.Mock
const requeue = requeueHuntStep as jest.Mock
const cont = continueHuntStep as jest.Mock

const JOB: HuntJob = {
  scanId: 's1',
  pullRequestId: 'pr1',
  taskId: 't1',
  workspaceId: 'w1',
  repo: 'o/r',
  prNumber: 7,
  headSha: 'a'.repeat(40),
  reasons: ['diff:sink:prisma-raw'],
  touchedSourcePaths: ['lib/a.ts', 'lib/b.ts'],
  managedScanStarted: true,
}
const T1: HuntTask = {
  id: 't1',
  objective: 'raw SQL from req.query',
  category: 'injection',
  startingPoints: ['lib/a.ts'],
}
const T2: HuntTask = {
  id: 't2',
  objective: 'workspace id reaches prisma unchecked',
  category: 'idor',
  startingPoints: ['lib/b.ts'],
}
const candidate = {
  category: 'injection',
  cwe: 'CWE-89',
  severity: 'HIGH',
  sink: { symbol: 's', file: 'lib/a.ts', line: 2 },
  entry: { symbol: 'x', file: 'lib/a.ts', line: 1 },
  call_chain: [{ from: 'x', to: 's' }],
  precondition: 'p',
  claim: 'c',
  reachability: 'EXTERNAL',
  fingerprint: 'fp-1',
}
const noBudgetWrapUp = {
  candidates: [],
  tokens: 100,
  elapsedMs: 1000,
  stopped: 'budget',
  wrapUp: { ran: false, skipped: 'no-budget' },
}

beforeEach(() => {
  jest.resetAllMocks()
  plan.mockResolvedValue({
    tasks: [T1, T2],
    reason: 'r',
    by: 'model',
    tokens: 10,
  })
  verifyGraph.mockResolvedValue({
    subgraph: { symbols: [], edges: [], files: [] },
    evidence: { sightings: [], fileSightings: [], missingFiles: [] },
  })
  verify.mockImplementation(async ({ candidates }) => ({
    accepted: candidates,
    rejected: [],
  }))
  falsify.mockResolvedValue({ verdict: 'INCONCLUSIVE', reason: 'r', tokens: 5 })
})

describe('budget-short hunt ends as coverage owed without a same-budget retry', () => {
  it('sorts a task that fell short by why: our budget, or our infrastructure', () => {
    const cases: Array<
      [string, Parameters<typeof huntShortfall>[0], string | null]
    > = [
      ['answered', { stopped: 'done' }, null],
      [
        'answered on a budget stop',
        { stopped: 'budget', wrapUp: { ran: true, submitted: 0 } },
        null,
      ],
      ['turn never came', { stopped: 'skipped' }, 'budget'],
      [
        'no budget left to ask',
        { stopped: 'budget', wrapUp: { ran: false, skipped: 'no-budget' } },
        'budget',
      ],
      [
        'no time left to ask',
        { stopped: 'steps', wrapUp: { ran: false, skipped: 'no-time' } },
        'budget',
      ],
      [
        'hand-over turned off',
        { stopped: 'no-progress', wrapUp: { ran: false, skipped: 'disabled' } },
        'budget',
      ],
      ['timeout', { stopped: 'timeout' }, 'infra'],
      ['batch threw', { stopped: 'error' }, 'infra'],
      [
        'wrap-up errored',
        { stopped: 'budget', wrapUp: { ran: false, error: 'gateway 500' } },
        'infra',
      ],
      [
        'provider ignored the forced call',
        {
          stopped: 'budget',
          wrapUp: { ran: true, submitted: 0 },
          wrapUpWarnings: ['x'],
        },
        'infra',
      ],
      ['no wrap-up facts (pre-LUM-831 replay)', { stopped: 'steps' }, 'infra'],
    ]
    for (const [name, row, want] of cases) {
      expect([name, huntShortfall(row)]).toEqual([name, want])
    }
    expect(partialCauseClass('HUNT_BUDGET_SHORT')).toBe('COVERAGE_OWED')
  })

  it('a task whose turn the budget never reached ends the layer PARTIAL at once: no retry, no continuation, findings kept', async () => {
    hunt.mockResolvedValueOnce({
      candidates: [candidate],
      tokens: 100,
      elapsedMs: 10_000_000,
      stopped: 'done',
    })
    await expect(securityHuntWorkflow(JOB)).resolves.toMatchObject({
      outcome: 'PARTIAL',
    })
    expect(requeue).not.toHaveBeenCalled()
    expect(cont).not.toHaveBeenCalled()
    expect(hunt).toHaveBeenCalledTimes(1)
    const persisted = persist.mock.calls[0]![0]
    expect(persisted.stage).toBe('PARTIAL')
    expect(persisted.partialCauses).toEqual(['HUNT_BUDGET_SHORT'])
    // What T1 found is not thrown away with T2's shortfall.
    expect(persisted.findings).toHaveLength(1)
    // …and the customer reads it as unfinished, never as checked.
    expect(
      scanCoverageState({
        status: 'FINDINGS',
        stages: { secrets: 'RAN', hunt: 'PARTIAL' },
        partial: true,
      })
    ).toBe('UNFINISHED')
  })

  it('a task whose wrap-up had no budget left is not retried either', async () => {
    hunt.mockResolvedValueOnce({ ...noBudgetWrapUp }).mockResolvedValueOnce({
      candidates: [],
      tokens: 100,
      elapsedMs: 1000,
      stopped: 'done',
    })
    await expect(securityHuntWorkflow(JOB)).resolves.toMatchObject({
      outcome: 'PARTIAL',
    })
    expect(requeue).not.toHaveBeenCalled()
    // Pass 2 only re-runs transient stops; a budget stop is not one.
    expect(hunt).toHaveBeenCalledTimes(2)
    expect(persist.mock.calls[0]![0].partialCauses).toEqual([
      'HUNT_BUDGET_SHORT',
    ])
  })

  it('a run that also had an infrastructure fault is retried as a whole — the fault is ours to redo', async () => {
    hunt
      .mockResolvedValueOnce({
        candidates: [],
        tokens: 10,
        elapsedMs: 10,
        stopped: 'timeout',
      })
      .mockResolvedValueOnce(noBudgetWrapUp)
      .mockResolvedValueOnce({
        candidates: [],
        tokens: 10,
        elapsedMs: 10,
        stopped: 'timeout',
      })
    requeue.mockResolvedValue({ requeued: true, attempt: 2 })
    await expect(securityHuntWorkflow(JOB)).resolves.toMatchObject({
      outcome: 'REQUEUED',
    })
    expect(persist).not.toHaveBeenCalled()
  })

  it('the reliability read-out counts a budget shortfall as coverage owed, never as our fault', () => {
    const r = summarizeScanReliability([
      {
        status: 'CLEAN',
        stages: { secrets: 'RAN', hunt: 'PARTIAL' },
        partial: true,
        partialCauses: ['HUNT_BUDGET_SHORT'],
        huntAudit: null,
      },
    ])
    expect(r.ourFault).toBe(0)
    expect(r.coverageOwedOnly).toBe(1)
  })
})
