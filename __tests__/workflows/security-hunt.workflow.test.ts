/** @jest-environment node */
jest.mock('@/lib/workflows/security-hunt.steps', () => ({
  buildSubgraphStep: jest.fn(),
  huntCategoryStep: jest.fn(),
  mechanicalVerifyStep: jest.fn(),
  falsifierStep: jest.fn(),
  persistHuntFindingsStep: jest.fn(),
  markHuntFailedStep: jest.fn(),
}))
jest.mock('@/lib/workflows/security-sarif-ingest.steps', () => ({
  persistSarifFindingsStep: jest.fn(),
  markSarifExternalFailedStep: jest.fn(),
  deleteSarifBlobStep: jest.fn(),
}))
// LUM-740: the helper module now also wraps the suggested-disposition step.
jest.mock('@/lib/workflows/security-suggest.steps', () => ({
  suggestDispositionsStep: jest.fn().mockResolvedValue(undefined),
}))
jest.mock('@/lib/workflows/security-pr-review.steps', () => ({
  syncPrReviewStep: jest.fn().mockResolvedValue(undefined),
}))

import { securityHuntWorkflow } from '@/lib/workflows/security-hunt'
import {
  buildSubgraphStep,
  huntCategoryStep,
  mechanicalVerifyStep,
  falsifierStep,
  persistHuntFindingsStep,
  markHuntFailedStep,
} from '@/lib/workflows/security-hunt.steps'
import { syncPrReviewStep } from '@/lib/workflows/security-pr-review.steps'
import {
  HUNT_CATEGORIES,
  HUNT_TOKEN_BUDGET,
  HUNT_TIME_BUDGET_MS,
  HUNT_MAX_FALSIFIED,
} from '@/lib/services/security-hunt.config'
import { HUNT_CATEGORIES as CANDIDATE_CATEGORIES } from '@/lib/security-scan/hunt/candidate'

const build = buildSubgraphStep as jest.Mock
const hunt = huntCategoryStep as jest.Mock
const verify = mechanicalVerifyStep as jest.Mock
const falsify = falsifierStep as jest.Mock
const persist = persistHuntFindingsStep as jest.Mock
const markFailed = markHuntFailedStep as jest.Mock
const sync = syncPrReviewStep as jest.Mock

const JOB = {
  scanId: 's1',
  pullRequestId: 'pr1',
  taskId: 't1',
  workspaceId: 'w1',
  repo: 'o/r',
  prNumber: 7,
  headSha: 'a'.repeat(40),
}
const SUBGRAPH = {
  symbols: [
    {
      id: 'x',
      kind: 'entry',
      file: 'a.ts',
      line: 1,
      name: 'x',
      rule: null,
      controls: [],
    },
  ],
  edges: [{ from: 'x', to: 'y' }],
  files: [{ path: 'a.ts', lineCount: 3, touched: true }],
}
const candidate = (n: number) => ({
  category: 'idor',
  cwe: 'CWE-639',
  severity: 'MEDIUM',
  sink: { symbol: `s${n}`, file: 'a.ts', line: 2 },
  entry: { symbol: 'x', file: 'a.ts', line: 1 },
  call_chain: [{ from: 'x', to: `s${n}` }],
  precondition: 'p',
  claim: `c${n}`,
  reachability: 'EXTERNAL',
  fingerprint: `f${n}`,
})
const batch = (
  over: Partial<{
    candidates: unknown[]
    tokens: number
    elapsedMs: number
    stopped: string
    error: string
  }> = {}
) => ({
  candidates: [],
  tokens: 100,
  elapsedMs: 1000,
  stopped: 'done',
  ...over,
})

let order: string[]
beforeEach(() => {
  jest.resetAllMocks()
  order = []
  build.mockImplementation(async () => {
    order.push('build')
    return { subgraph: SUBGRAPH, partial: false }
  })
  hunt.mockImplementation(async () => {
    order.push('hunt')
    return batch()
  })
  verify.mockImplementation(async () => {
    order.push('verify')
    return { accepted: [], rejected: [] }
  })
  falsify.mockImplementation(async () => {
    order.push('falsify')
    return { verdict: 'INCONCLUSIVE', reason: 'r', tokens: 50 }
  })
  persist.mockImplementation(async () => {
    order.push('persist')
    return { written: 0 }
  })
  markFailed.mockImplementation(async () => {
    order.push('markFailed')
  })
  sync.mockImplementation(async () => {
    order.push('sync')
  })
})

describe('LUM-739 hunt workflow', () => {
  it('runs one batch per category with decreasing budgets, verifies once, falsifies each survivor, persists only INCONCLUSIVE ones, syncs last', async () => {
    hunt
      .mockImplementationOnce(async () => {
        order.push('hunt')
        return batch({
          candidates: [{ raw: 1 }, { raw: 2 }],
          tokens: 1000,
          elapsedMs: 5000,
        })
      })
      .mockImplementationOnce(async () => {
        order.push('hunt')
        return batch({ candidates: [{ raw: 3 }], tokens: 500, elapsedMs: 2000 })
      })
    verify.mockImplementationOnce(async () => {
      order.push('verify')
      return {
        accepted: [candidate(1), candidate(2)],
        rejected: [{ reason: 'duplicate', category: 'idor', sink: 's9' }],
      }
    })
    falsify
      .mockImplementationOnce(async () => {
        order.push('falsify')
        return { verdict: 'REJECT', reason: 'guarded', tokens: 40 }
      })
      .mockImplementationOnce(async () => {
        order.push('falsify')
        return { verdict: 'INCONCLUSIVE', reason: 'no check', tokens: 60 }
      })

    await expect(securityHuntWorkflow(JOB)).resolves.toEqual({
      outcome: 'RAN',
      scanId: 's1',
      findings: 1,
      tokenSpent: 1000 + 500 + 4 * 100 + 40 + 60,
    })
    expect(hunt).toHaveBeenCalledTimes(6)
    expect(hunt.mock.calls.map(c => c[0].category)).toEqual([
      ...HUNT_CATEGORIES,
    ])
    expect(hunt.mock.calls[0]![0]).toMatchObject({
      job: JOB,
      subgraph: SUBGRAPH,
      tokenBudget: HUNT_TOKEN_BUDGET,
      timeBudgetMs: HUNT_TIME_BUDGET_MS,
    })
    expect(hunt.mock.calls[1]![0]).toMatchObject({
      tokenBudget: HUNT_TOKEN_BUDGET - 1000,
      timeBudgetMs: HUNT_TIME_BUDGET_MS - 5000,
    })
    expect(verify).toHaveBeenCalledWith({
      subgraph: SUBGRAPH,
      candidates: [{ raw: 1 }, { raw: 2 }, { raw: 3 }],
    })
    expect(falsify).toHaveBeenCalledTimes(2)
    expect(falsify.mock.calls[0]![0]).toEqual({
      job: JOB,
      candidate: candidate(1),
    })
    const persisted = persist.mock.calls[0]![0]
    expect(persisted.findings).toEqual([
      { ...candidate(2), falsifierReason: 'no check' },
    ])
    expect(persisted.partial).toBe(false)
    expect(persisted.audit).toMatchObject({
      candidates: 3,
      rejected: [{ reason: 'duplicate' }],
      falsifierRejects: 1,
      falsifierRejected: [{ category: 'idor', sink: 's1', reason: 'guarded' }],
      subgraph: { files: 1, symbols: 1, edges: 1, partial: false },
    })
    expect(persisted.audit.categories).toHaveLength(6)
    expect(persisted.audit.categories[0]).toEqual({
      category: 'idor',
      candidates: 2,
      tokens: 1000,
      elapsedMs: 5000,
      stopped: 'done',
    })
    expect(order[order.length - 1]).toBe('sync')
    expect(order.filter(o => o === 'hunt')).toHaveLength(6)
    expect(order.indexOf('verify')).toBeGreaterThan(order.lastIndexOf('hunt'))
    expect(markFailed).not.toHaveBeenCalled()
  })

  it('stops launching batches once the token budget is spent and stamps PARTIAL', async () => {
    hunt.mockImplementationOnce(async () =>
      batch({ tokens: HUNT_TOKEN_BUDGET, stopped: 'budget' })
    )
    await expect(securityHuntWorkflow(JOB)).resolves.toMatchObject({
      outcome: 'PARTIAL',
    })
    expect(hunt).toHaveBeenCalledTimes(1)
    expect(persist.mock.calls[0]![0].partial).toBe(true)
  })

  it('stops launching batches once the time budget is spent', async () => {
    hunt.mockImplementationOnce(async () =>
      batch({ elapsedMs: HUNT_TIME_BUDGET_MS })
    )
    await expect(securityHuntWorkflow(JOB)).resolves.toMatchObject({
      outcome: 'PARTIAL',
    })
    expect(hunt).toHaveBeenCalledTimes(1)
  })

  it('a batch that errored or timed out makes the layer PARTIAL but the run continues', async () => {
    hunt.mockImplementationOnce(async () =>
      batch({ stopped: 'error', error: 'gateway 500' })
    )
    await expect(securityHuntWorkflow(JOB)).resolves.toMatchObject({
      outcome: 'PARTIAL',
    })
    expect(hunt).toHaveBeenCalledTimes(6)
    expect(persist.mock.calls[0]![0].audit.categories[0].stopped).toBe('error')
  })

  it('a truncated subgraph makes the layer PARTIAL', async () => {
    build.mockImplementationOnce(async () => ({
      subgraph: SUBGRAPH,
      partial: true,
    }))
    await expect(securityHuntWorkflow(JOB)).resolves.toMatchObject({
      outcome: 'PARTIAL',
    })
    expect(persist.mock.calls[0]![0].audit.subgraph.partial).toBe(true)
  })

  it('falsifies at most HUNT_MAX_FALSIFIED candidates and marks the rest as partial', async () => {
    verify.mockImplementationOnce(async () => ({
      accepted: Array.from({ length: HUNT_MAX_FALSIFIED + 3 }, (_, i) =>
        candidate(i)
      ),
      rejected: [],
    }))
    await expect(securityHuntWorkflow(JOB)).resolves.toMatchObject({
      outcome: 'PARTIAL',
      findings: HUNT_MAX_FALSIFIED,
    })
    expect(falsify).toHaveBeenCalledTimes(HUNT_MAX_FALSIFIED)
  })

  it('marks the scan FAILED (with 0 tokens) when the subgraph step exhausts its retries, then still syncs', async () => {
    build.mockImplementationOnce(async () => {
      throw new Error('GitHub 502')
    })
    await expect(securityHuntWorkflow(JOB)).resolves.toEqual({
      outcome: 'FAILED',
      scanId: 's1',
      reason: 'GitHub 502',
    })
    expect(markFailed).toHaveBeenCalledWith('s1', 'GitHub 502', 0)
    expect(persist).not.toHaveBeenCalled()
    expect(order).toEqual(['markFailed', 'sync'])
  })

  it('a falsifier failure after tokens were spent reports the tokens spent so far', async () => {
    hunt.mockImplementation(async () => batch({ tokens: 200 }))
    verify.mockImplementationOnce(async () => ({
      accepted: [candidate(1)],
      rejected: [],
    }))
    falsify.mockImplementationOnce(async () => {
      throw new Error('verifier down')
    })
    await expect(securityHuntWorkflow(JOB)).resolves.toMatchObject({
      outcome: 'FAILED',
      reason: 'verifier down',
    })
    expect(markFailed).toHaveBeenCalledWith('s1', 'verifier down', 1200)
  })

  it('a failing markFailed does not change the FAILED outcome', async () => {
    build.mockImplementationOnce(async () => {
      throw new Error('boom')
    })
    markFailed.mockImplementationOnce(async () => {
      throw new Error('db down')
    })
    await expect(securityHuntWorkflow(JOB)).resolves.toMatchObject({
      outcome: 'FAILED',
      reason: 'boom',
    })
    expect(sync).toHaveBeenCalledWith('s1')
  })

  it('the config category list equals the candidate module list', () => {
    expect([...HUNT_CATEGORIES]).toEqual([...CANDIDATE_CATEGORIES])
  })
})
