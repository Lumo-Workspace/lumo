/**
 * @jest-environment node
 *
 * LUM-832 — a hunt task can fall short for two reasons that want opposite
 * remedies. Our infrastructure broke (random → run it again). Or the budget
 * WE set ran out (structural → the same run hits the same wall, so a retry
 * buys cost, not certainty). The second is coverage we owe: the short tasks
 * are continued ONCE in a run of their own with a fresh budget, what already
 * landed is kept (and not landed twice), and a task still short after that
 * reads as unfinished on our side.
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
jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    $transaction: jest.fn(),
    prSecurityScan: { findUnique: jest.fn(), update: jest.fn() },
    prSecurityFinding: { createMany: jest.fn(), findMany: jest.fn() },
  },
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
import { prisma } from '@/lib/db/prisma'
import { prSecurityScanRepository } from '@/lib/repositories/pr-security-scan.repository'
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
const candidate = (fp: string) => ({
  category: 'injection',
  cwe: 'CWE-89',
  severity: 'HIGH',
  sink: { symbol: 's', file: 'lib/a.ts', line: 2 },
  entry: { symbol: 'x', file: 'lib/a.ts', line: 1 },
  call_chain: [{ from: 'x', to: 's' }],
  precondition: 'p',
  claim: 'c',
  reachability: 'EXTERNAL',
  fingerprint: fp,
})
const done = (candidates: unknown[] = []) => ({
  candidates,
  tokens: 100,
  elapsedMs: 1000,
  stopped: 'done',
})
/** A task whose search hit its budget and had none left to be asked. */
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
  cont.mockResolvedValue(true)
})

describe('budget-short hunt continues its unfinished tasks instead of retrying', () => {
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

  it('a task whose turn the budget never reached is continued, not retried: what landed is kept, the rest runs with a fresh budget', async () => {
    hunt.mockResolvedValueOnce({
      ...done([candidate('fp-1')]),
      elapsedMs: 10_000_000,
    })
    const out = await securityHuntWorkflow(JOB)
    expect(out).toMatchObject({ outcome: 'CONTINUED' })
    // Not a fault: the retry path is never asked.
    expect(requeue).not.toHaveBeenCalled()
    // t1's finding lands now, with the layer still in progress and no cause.
    expect(persist).toHaveBeenCalledTimes(1)
    expect(persist.mock.calls[0]![0]).toMatchObject({
      stage: 'PENDING',
      partialCauses: [],
    })
    expect(persist.mock.calls[0]![0].findings).toHaveLength(1)
    // The continuation: t2 only, same job, the fence up, a fresh try budget.
    const next = cont.mock.calls[0]![0].next as HuntJob
    expect(next.resumeTasks).toEqual([T2])
    expect(next.attempt).toBe(2)
    expect(next.tries).toBe(1)
    expect(next.carriedStage).toBe('RAN')
    expect(next.managedScanStarted).toBe(false)
    // …which the customer reads as still scanning.
    expect(
      scanCoverageState({
        status: 'FINDINGS',
        stages: { secrets: 'RAN', hunt: 'PENDING' },
        partial: false,
      })
    ).toBe('IN_PROGRESS')
  })

  it('the continuation hunts only the short tasks, without re-planning, and ends the layer RAN', async () => {
    hunt.mockResolvedValue(done())
    const out = await securityHuntWorkflow({
      ...JOB,
      attempt: 2,
      tries: 1,
      resumeTasks: [T2],
      carriedStage: 'RAN',
    })
    expect(out).toMatchObject({ outcome: 'RAN' })
    expect(plan).not.toHaveBeenCalled()
    expect(hunt).toHaveBeenCalledTimes(1)
    expect(hunt.mock.calls[0]![0].task).toEqual(T2)
    expect(persist.mock.calls[0]![0]).toMatchObject({
      stage: 'RAN',
      partialCauses: [],
    })
    expect(persist.mock.calls[0]![0].audit.plannedBy).toBe('resumed')
    expect(cont).not.toHaveBeenCalled()
  })

  it('a task still short after its one continuation is not continued again: the layer is PARTIAL with HUNT_BUDGET_SHORT', async () => {
    hunt.mockResolvedValue(noBudgetWrapUp)
    const out = await securityHuntWorkflow({
      ...JOB,
      attempt: 2,
      tries: 1,
      resumeTasks: [T2],
      carriedStage: 'RAN',
    })
    expect(out).toMatchObject({ outcome: 'PARTIAL' })
    expect(cont).not.toHaveBeenCalled()
    expect(requeue).not.toHaveBeenCalled()
    expect(persist.mock.calls[0]![0]).toMatchObject({
      stage: 'PARTIAL',
      partialCauses: ['HUNT_BUDGET_SHORT'],
    })
  })

  it('a run with an infrastructure fault is retried as a whole, budget-short tasks included', async () => {
    hunt
      .mockResolvedValueOnce({ ...done(), stopped: 'timeout' })
      .mockResolvedValueOnce(noBudgetWrapUp)
      .mockResolvedValueOnce({ ...done(), stopped: 'timeout' })
    requeue.mockResolvedValue({ requeued: true, attempt: 2 })
    await expect(securityHuntWorkflow(JOB)).resolves.toMatchObject({
      outcome: 'REQUEUED',
    })
    expect(cont).not.toHaveBeenCalled()
    expect(persist).not.toHaveBeenCalled()
  })

  it('the continuation’s findings never land twice: fingerprints already on the scan are dropped', async () => {
    const scan = prisma.prSecurityScan as unknown as {
      findUnique: jest.Mock
      update: jest.Mock
    }
    const finding = prisma.prSecurityFinding as unknown as {
      createMany: jest.Mock
      findMany: jest.Mock
    }
    ;(prisma.$transaction as jest.Mock).mockImplementation(
      async (fn: (tx: unknown) => unknown) =>
        fn({ prSecurityScan: scan, prSecurityFinding: finding })
    )
    scan.findUnique.mockResolvedValue({
      stages: { hunt: 'PENDING' },
      partial: false,
      partialCauses: [],
      huntAttempts: 2,
      tokenSpent: 300,
    })
    finding.findMany.mockResolvedValue([{ fingerprint: 'fp-1' }])
    const row = (fingerprint: string) =>
      ({ scanId: 's1', fingerprint }) as Parameters<
        typeof prSecurityScanRepository.persistHuntResult
      >[1][number]
    await prSecurityScanRepository.persistHuntResult(
      's1',
      [row('fp-1'), row('fp-2'), row('fp-2')],
      {
        hunt: 'RAN',
        huntAudit: {},
        tokenSpent: 50,
        partialCauses: [],
        attempt: 2,
      }
    )
    expect(finding.createMany).toHaveBeenCalledWith({ data: [row('fp-2')] })
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
