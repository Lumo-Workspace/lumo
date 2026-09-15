/** @jest-environment node */
jest.mock('@/lib/workflows/security-hunt.steps', () => ({
  buildVerifySubgraphStep: jest.fn(),
  planHuntStep: jest.fn(),
  huntTaskStep: jest.fn(),
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
  buildVerifySubgraphStep,
  planHuntStep,
  huntTaskStep,
  mechanicalVerifyStep,
  falsifierStep,
  persistHuntFindingsStep,
  markHuntFailedStep,
} from '@/lib/workflows/security-hunt.steps'
import { syncPrReviewStep } from '@/lib/workflows/security-pr-review.steps'
import {
  HUNT_CATEGORIES,
  HUNT_MAX_PLANNED_TASKS,
  HUNT_TOKEN_BUDGET,
  HUNT_TIME_BUDGET_MS,
  HUNT_TASK_TIME_MS,
  HUNT_TASK_TOKEN_MAX,
  HUNT_MAX_FALSIFIED,
  type HuntTask,
} from '@/lib/services/security-hunt.config'
import { HUNT_CATEGORIES as CANDIDATE_CATEGORIES } from '@/lib/security-scan/hunt/candidate'

const verifyGraph = buildVerifySubgraphStep as jest.Mock
const plan = planHuntStep as jest.Mock
const hunt = huntTaskStep as jest.Mock
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
  reasons: ['diff:sink:prisma-raw'],
  touchedSourcePaths: ['lib/s.ts'],
  managedScanStarted: true,
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
/**
 * LUM-758: the planning step emits a TASK GRAPH capped at
 * HUNT_MAX_PLANNED_TASKS, so every case below runs two planned tasks, not six
 * categories. A six-category fixture would assert a state production can no
 * longer reach.
 */
const PLANNED: HuntTask[] = [
  {
    id: 't1',
    objective: 'raw SQL built from req.query in lib/db.ts',
    category: 'injection',
    startingPoints: ['lib/db.ts'],
  },
  {
    id: 't2',
    objective: 'workspace id from the path reaches prisma unchecked',
    category: 'idor',
    startingPoints: [],
  },
]

const batch = (
  over: Partial<{
    candidates: unknown[]
    tokens: number
    elapsedMs: number
    stopped: string
    error: string
    sandbox: 'attached' | 'created'
    egressDenied: boolean
    tools: { present: string[]; missing: string[]; unverified: string[] }
    wrappedUp: boolean
    wrapUpWarnings: string[]
    trace: unknown[]
    stop: unknown
    wrapUp: unknown
    compress: {
      calls: number
      noOpCalls: number
      inputChars: number
      outputChars: number
      tokens: number
    }
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
  verifyGraph.mockImplementation(async () => {
    order.push('buildVerifyGraph')
    return SUBGRAPH
  })
  plan.mockResolvedValue({
    tasks: [...PLANNED],
    reason: 'legacy fixture',
    by: 'model',
    tokens: 0,
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
  it('runs one batch per PLANNED task, verifies once, falsifies each survivor, persists only INCONCLUSIVE ones, syncs last', async () => {
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
      // LUM-758: two planned batches, and the plan step itself spent 0.
      tokenSpent: 1000 + 500 + 40 + 60,
    })
    expect(hunt).toHaveBeenCalledTimes(2)
    expect(hunt.mock.calls.map(c => c[0].task)).toEqual([...PLANNED])
    // LUM-762: every batch is bounded by the per-task ceiling, so a wedged
    // task can no longer spend the whole scan's window.
    expect(hunt.mock.calls[0]![0]).toMatchObject({
      job: JOB,
      tokenBudget: HUNT_TASK_TOKEN_MAX,
      timeBudgetMs: HUNT_TASK_TIME_MS,
    })
    // LUM-758 Task 10: the subgraph is not the agent's field of view, so it
    // is not serialised into a batch's step input at all.
    expect(hunt.mock.calls[0]![0].subgraph).toBeUndefined()
    expect(hunt.mock.calls[1]![0]).toMatchObject({
      tokenBudget: HUNT_TASK_TOKEN_MAX,
      timeBudgetMs: HUNT_TASK_TIME_MS,
    })
    // LUM-758 Task 10: the gate's graph is built AFTER the hunt, from the
    // candidates it is about to judge — not from a window drawn before the
    // agent had read a line.
    expect(verifyGraph).toHaveBeenCalledWith({
      job: JOB,
      candidates: [{ raw: 1 }, { raw: 2 }, { raw: 3 }],
    })
    expect(order.indexOf('buildVerifyGraph')).toBeGreaterThan(
      order.lastIndexOf('hunt')
    )
    expect(order.indexOf('verify')).toBeGreaterThan(
      order.indexOf('buildVerifyGraph')
    )
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
    expect(persisted.audit.planned).toEqual([...PLANNED])
    expect(persisted.audit.tasks).toHaveLength(2)
    // LUM-758: an audit row names the TASK it came from — its id and the
    // objective the model was given — on top of the category that types it.
    expect(persisted.audit.tasks[0]).toEqual({
      taskId: PLANNED[0]!.id,
      objective: PLANNED[0]!.objective,
      category: 'injection',
      candidates: 2,
      tokens: 1000,
      elapsedMs: 5000,
      stopped: 'done',
    })
    expect(order[order.length - 1]).toBe('sync')
    expect(order.filter(o => o === 'hunt')).toHaveLength(2)
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
    // LUM-762: the layer is only PARTIAL once the task's retry fails too.
    hunt.mockImplementation(async (input: { task: HuntTask }) =>
      input.task.id === 't2'
        ? batch({ stopped: 'error', error: 'gateway 500' })
        : batch()
    )
    await expect(securityHuntWorkflow(JOB)).resolves.toMatchObject({
      outcome: 'PARTIAL',
    })
    expect(hunt).toHaveBeenCalledTimes(3) // 2 planned + one retry of t2
    const rows = persist.mock.calls[0]![0].audit.tasks
    expect(rows[1].stopped).toBe('error')
    expect(rows[rows.length - 1]).toMatchObject({
      taskId: 't2',
      category: 'idor',
      stopped: 'error',
    })
  })

  it('LUM-762 retries a failed task once and ends RAN when the retry succeeds', async () => {
    hunt.mockImplementationOnce(async () =>
      batch({ stopped: 'timeout', error: 'Delay was aborted', tokens: 0 })
    )
    await expect(securityHuntWorkflow(JOB)).resolves.toMatchObject({
      outcome: 'RAN',
    })
    // 2 planned + one retry of the first planned task.
    expect(hunt).toHaveBeenCalledTimes(3)
    expect(hunt.mock.calls[2]![0]).toMatchObject({
      task: PLANNED[0],
      timeBudgetMs: HUNT_TASK_TIME_MS,
    })
    const persisted = persist.mock.calls[0]![0]
    expect(persisted.partial).toBe(false)
    const attempts = persisted.audit.tasks.filter(
      (c: { taskId: string }) => c.taskId === 't1'
    )
    expect(attempts.map((c: { stopped: string }) => c.stopped)).toEqual([
      'timeout',
      'done',
    ])
  })

  it('LUM-762 caps each task at the per-task time and token ceiling', async () => {
    hunt.mockImplementationOnce(async () =>
      batch({
        elapsedMs: HUNT_TIME_BUDGET_MS - 10_000,
        tokens: HUNT_TOKEN_BUDGET - 4_000,
      })
    )
    await securityHuntWorkflow(JOB)
    expect(hunt.mock.calls[0]![0]).toMatchObject({
      timeBudgetMs: HUNT_TASK_TIME_MS,
      tokenBudget: HUNT_TASK_TOKEN_MAX,
    })
    // Second task: only the remainder is left, and that is less than the
    // ceiling — the batch gets the smaller of the two.
    expect(hunt.mock.calls[1]![0]).toMatchObject({
      timeBudgetMs: 10_000,
      tokenBudget: 4_000,
    })
    // LUM-758: the ceiling arithmetic is sized to the PLANNED TASK count, not
    // to all six categories. At 120k/240s a full six never fit (6 × 60s =
    // 360s); a full plan of HUNT_MAX_PLANNED_TASKS does, with room left for
    // the retry pass to re-run at least one of them on a fresh window.
    expect(HUNT_TASK_TIME_MS * HUNT_MAX_PLANNED_TASKS).toBeLessThanOrEqual(
      HUNT_TIME_BUDGET_MS
    )
    expect(HUNT_TASK_TOKEN_MAX * HUNT_MAX_PLANNED_TASKS).toBeLessThanOrEqual(
      HUNT_TOKEN_BUDGET
    )
    expect(HUNT_MAX_PLANNED_TASKS).toBeLessThan(HUNT_CATEGORIES.length)
    // A full plan plus one retry still fits in the scan's window.
    expect(
      HUNT_TASK_TIME_MS * (HUNT_MAX_PLANNED_TASKS + 1)
    ).toBeLessThanOrEqual(HUNT_TIME_BUDGET_MS)
    expect(
      HUNT_TASK_TOKEN_MAX * (HUNT_MAX_PLANNED_TASKS + 1)
    ).toBeLessThanOrEqual(HUNT_TOKEN_BUDGET)
  })

  it('LUM-762 records unrun tasks as skipped in huntAudit', async () => {
    hunt.mockImplementationOnce(async () =>
      batch({ elapsedMs: HUNT_TIME_BUDGET_MS })
    )
    await expect(securityHuntWorkflow(JOB)).resolves.toMatchObject({
      outcome: 'PARTIAL',
    })
    expect(hunt).toHaveBeenCalledTimes(1)
    const rows = persist.mock.calls[0]![0].audit.tasks
    expect(rows.map((c: { taskId: string }) => c.taskId)).toEqual(
      PLANNED.map(t => t.id)
    )
    expect(rows.slice(1)).toEqual(
      PLANNED.slice(1).map(t => ({
        taskId: t.id,
        objective: t.objective,
        category: t.category,
        candidates: 0,
        tokens: 0,
        elapsedMs: 0,
        stopped: 'skipped',
      }))
    )
  })

  it('LUM-758 records which VM the hunt ran on, and keeps one open-egress batch visible', async () => {
    hunt
      .mockImplementationOnce(async () =>
        batch({ sandbox: 'created', egressDenied: true })
      )
      // A batch that ran with a route out must not be papered over by a later
      // one that did not: `egressDenied` is an AND across the run.
      .mockImplementationOnce(async () =>
        batch({ sandbox: 'attached', egressDenied: false })
      )

    await securityHuntWorkflow(JOB)

    const { audit } = persist.mock.calls[0]![0]
    // `created` wins over a later `attached`: the field answers "did the 30 s
    // poll find the managed scan's VM", and last-writer-wins made a run that
    // had to boot its own VM for batch 1 read as if it never did. The
    // per-batch detail is still in `audit.tasks`.
    expect(audit.sandbox).toBe('created')
    expect(audit.egressDenied).toBe(false)
  })

  it('LUM-758 §6.3 sums what compression cost and saved across every batch', async () => {
    hunt
      .mockImplementationOnce(async () =>
        batch({
          tokens: 5_000,
          compress: {
            calls: 2,
            noOpCalls: 0,
            inputChars: 12_000,
            outputChars: 1_500,
            tokens: 300,
          },
        })
      )
      .mockImplementationOnce(async () =>
        batch({
          tokens: 4_000,
          compress: {
            calls: 1,
            noOpCalls: 0,
            inputChars: 6_000,
            outputChars: 900,
            tokens: 150,
          },
        })
      )

    await securityHuntWorkflow(JOB)

    const persisted = persist.mock.calls[0]![0]
    expect(persisted.audit.compress).toEqual({
      calls: 3,
      noOpCalls: 0,
      inputChars: 18_000,
      outputChars: 2_400,
      tokens: 450,
    })
    // The compression tokens are INSIDE each batch's `tokens`, so they are
    // inside `tokenSpent` — they are not added a second time here. That is
    // the whole reason `huntBatch` folds them in rather than reporting them
    // on the side.
    expect(persisted.tokenSpent).toBe(9_000)
  })

  it('LUM-758 §6.3 leaves `compress` absent when no command was ever compressed', async () => {
    hunt.mockImplementation(async () =>
      batch({
        compress: {
          calls: 0,
          noOpCalls: 0,
          inputChars: 0,
          outputChars: 0,
          tokens: 0,
        },
      })
    )
    await securityHuntWorkflow(JOB)
    // Four zeros would be indistinguishable from "the step is switched off";
    // absent says "nothing crossed the threshold".
    expect(persist.mock.calls[0]![0].audit.compress).toBeUndefined()
  })

  it('LUM-758 an attached-only run still reads attached', async () => {
    hunt.mockImplementation(async () =>
      batch({ sandbox: 'attached', egressDenied: false })
    )
    await securityHuntWorkflow(JOB)
    expect(persist.mock.calls[0]![0].audit.sandbox).toBe('attached')
  })

  it('LUM-782 probe: folds each batch’s tool inventory pessimistically — missing on any VM is missing for the run', async () => {
    hunt
      .mockImplementationOnce(async () =>
        batch({
          tools: { present: ['rg', 'grep'], missing: [], unverified: ['wc'] },
        })
      )
      // A second batch may land on a different VM (attach vs create), so a
      // tool it found missing is missing for the run, and a tool the first
      // batch could not verify is not verified by the second's VM.
      .mockImplementationOnce(async () =>
        batch({
          tools: { present: ['grep', 'wc'], missing: ['rg'], unverified: [] },
        })
      )

    await securityHuntWorkflow(JOB)

    expect(persist.mock.calls[0]![0].audit.tools).toEqual({
      present: ['grep'],
      missing: ['rg'],
      unverified: ['wc'],
    })
  })

  it('LUM-782 probe: leaves `tools` unset when no batch ever got a VM', async () => {
    await securityHuntWorkflow(JOB)
    // Absent means "never probed" — the same as every pre-LUM-782 row.
    expect(persist.mock.calls[0]![0].audit.tools).toBeUndefined()
  })

  it('LUM-782 missing: a batch that refuses to start for want of a search tool lands the layer FAILED with that reason', async () => {
    const reason =
      "sandbox has none of the hunt's search tools on PATH (rg, grep all missing); refusing to run the agent"
    hunt.mockImplementation(async () => {
      throw new Error(reason)
    })

    await expect(securityHuntWorkflow(JOB)).resolves.toEqual({
      outcome: 'FAILED',
      scanId: 's1',
      reason,
    })
    // Not a PARTIAL claiming the hunt ran: nothing was submitted, nothing
    // is persisted as a result, and the reason is on the row.
    expect(persist).not.toHaveBeenCalled()
    expect(markFailed).toHaveBeenCalledWith('s1', reason, 0)
  })

  it('LUM-758 leaves the sandbox fields unset when no batch ever got a VM', async () => {
    // Pre-Task-9 batches carry neither field; an absent VM is not "attached".
    await securityHuntWorkflow(JOB)
    const { audit } = persist.mock.calls[0]![0]
    expect(audit.sandbox).toBeUndefined()
    expect(audit.egressDenied).toBeUndefined()
  })

  /**
   * LUM-758 Task 10 — THE regression this task exists to prevent. The
   * ≤40-file cap used to be the agent's whole field of view AND the source of
   * `audit.subgraph.partial` AND the layer's `partial`, which is why PARTIAL
   * was the routine outcome. The cap now only bounds what VERIFICATION reads.
   */
  it('LUM-758 the verification subgraph never makes the layer PARTIAL', async () => {
    hunt.mockImplementation(async () => batch({ candidates: [{ raw: 1 }] }))
    // A graph built from one candidate's files — i.e. a "small" one, which
    // under the old rule was indistinguishable from a truncated one.
    verifyGraph.mockImplementation(async () => SUBGRAPH)

    await expect(securityHuntWorkflow(JOB)).resolves.toMatchObject({
      outcome: 'RAN',
    })
    const persisted = persist.mock.calls[0]![0]
    expect(persisted.partial).toBe(false)
    expect(persisted.audit.subgraph).toEqual({
      files: 1,
      symbols: 1,
      edges: 1,
      partial: false,
    })
  })

  it('LUM-758 does not build a verification subgraph when no candidate was submitted', async () => {
    await expect(securityHuntWorkflow(JOB)).resolves.toMatchObject({
      outcome: 'RAN',
    })
    // Booting or attaching a VM to graph zero files buys nothing.
    expect(verifyGraph).not.toHaveBeenCalled()
    expect(verify).toHaveBeenCalledWith({
      subgraph: { symbols: [], edges: [], files: [] },
      candidates: [],
    })
    expect(persist.mock.calls[0]![0].audit.subgraph).toEqual({
      files: 0,
      symbols: 0,
      edges: 0,
      partial: false,
    })
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

  /**
   * LUM-758 Task 9 — the regression this pins: a batch now acquires a sandbox
   * VM before it can think, and that acquisition THROWS (a transient VM
   * failure belongs to the step's retry policy, not to a hunt result). Once
   * those retries are exhausted the throw reaches the workflow, and the
   * catch-all used to answer it with FAILED and an empty finding list — for a
   * run whose first two tasks had already submitted candidates.
   */
  it('LUM-758 keeps the earlier tasks findings as PARTIAL when a later batch throws', async () => {
    plan.mockResolvedValue({
      tasks: [
        ...PLANNED,
        { id: 't3', objective: 'third', category: 'ssrf', startingPoints: [] },
      ],
      reason: 'three tasks',
      by: 'model',
      tokens: 0,
    })
    hunt
      .mockImplementationOnce(async () => batch({ candidates: [{ raw: 1 }] }))
      .mockImplementationOnce(async () => batch({ candidates: [{ raw: 2 }] }))
      // The checkout never landed inside HUNT_CHECKOUT_WAIT_MS; the step's
      // retries are already spent by the time the workflow sees this.
      .mockImplementationOnce(async () => {
        throw new Error('checkout never landed')
      })
    verify.mockImplementationOnce(async () => ({
      accepted: [candidate(1), candidate(2)],
      rejected: [],
    }))

    await expect(securityHuntWorkflow(JOB)).resolves.toMatchObject({
      outcome: 'PARTIAL',
      scanId: 's1',
      findings: 2,
    })

    // FAILED would have been persisted by markHuntFailedStep, with `[]`.
    expect(markFailed).not.toHaveBeenCalled()
    expect(persist).toHaveBeenCalledTimes(1)
    const persisted = persist.mock.calls[0]![0]
    expect(persisted.stage).toBe('PARTIAL')
    expect(persisted.partial).toBe(true)
    expect(persisted.findings).toHaveLength(2)
    // Both batches candidates went through the mechanical gate…
    expect(verify).toHaveBeenCalledWith(
      expect.objectContaining({ candidates: [{ raw: 1 }, { raw: 2 }] })
    )
    expect(persisted.audit.candidates).toBe(2)
    // …and the cause of the PARTIAL is not lost.
    expect(persisted.audit.error).toBe('checkout never landed')
    expect(sync).toHaveBeenCalledWith('s1')
  })

  it('LUM-758 a batch that throws before any candidate exists is still FAILED', async () => {
    hunt.mockImplementationOnce(async () => {
      throw new Error('sandbox unavailable')
    })
    await expect(securityHuntWorkflow(JOB)).resolves.toEqual({
      outcome: 'FAILED',
      scanId: 's1',
      reason: 'sandbox unavailable',
    })
    expect(persist).not.toHaveBeenCalled()
    expect(markFailed).toHaveBeenCalledWith('s1', 'sandbox unavailable', 0)
  })

  it('marks the scan FAILED when the verification subgraph step exhausts its retries, then still syncs', async () => {
    hunt.mockImplementation(async () =>
      batch({ candidates: [{ raw: 1 }], tokens: 200 })
    )
    verifyGraph.mockImplementationOnce(async () => {
      throw new Error('sandbox gone')
    })
    await expect(securityHuntWorkflow(JOB)).resolves.toEqual({
      outcome: 'FAILED',
      scanId: 's1',
      reason: 'sandbox gone',
    })
    // The graph is the mechanical gate's only input: without one there is no
    // honest way to judge a candidate, so this stays unrecoverable.
    expect(markFailed).toHaveBeenCalledWith('s1', 'sandbox gone', 400)
    expect(persist).not.toHaveBeenCalled()
    expect(verify).not.toHaveBeenCalled()
    expect(order[order.length - 1]).toBe('sync')
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
    // Two planned task batches at 200 tokens each; the plan step spent 0.
    expect(markFailed).toHaveBeenCalledWith('s1', 'verifier down', 400)
  })

  it('a failing markFailed does not change the FAILED outcome', async () => {
    hunt.mockImplementationOnce(async () => {
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

// LUM-758 follow-up — the wrap-up flag has to reach the persisted audit, or
// "how often did the agent have to be asked" is computed, returned and then
// silently dropped. That is the same shape of gap the compression no-op counter
// was added to close, and it is invisible without a test: every other
// assertion passes while the number nobody can read stays zero.
// The RETRY pass writes its own audit row, and dropping the flag there is
// invisible: the pass-1 test above stays green while every retried task reads
// as "submitted on its own".
it('carries wrappedUp on the retry pass row too', async () => {
  plan.mockResolvedValue({
    tasks: [
      { id: 't1', objective: 'o1', category: 'idor', startingPoints: [] },
    ],
    reason: 'one signal',
    by: 'model',
    tokens: 100,
  })
  hunt
    .mockImplementationOnce(async () => batch({ stopped: 'timeout' }))
    .mockImplementationOnce(async () =>
      batch({ stopped: 'budget', wrappedUp: true })
    )

  await securityHuntWorkflow(JOB)

  const rows = persist.mock.calls[0]![0].audit.tasks
  // Two rows for one task, in attempt order — the retry's is the outcome.
  expect(rows).toHaveLength(2)
  expect(rows[0]!.wrappedUp).toBeUndefined()
  expect(rows[1]).toMatchObject({ taskId: 't1', wrappedUp: true })
})

// `wrapUpWarnings` rides the same two rows and is dropped the same way. It is
// the difference between "we asked and it had nothing" and "we never managed
// to ask"; only one of those says anything about whether the agent converges.
it('carries wrapUpWarnings onto both the first-pass and retry audit rows', async () => {
  plan.mockResolvedValue({
    tasks: [
      { id: 't1', objective: 'o1', category: 'idor', startingPoints: [] },
      { id: 't2', objective: 'o2', category: 'ssrf', startingPoints: [] },
    ],
    reason: 'two signals',
    by: 'model',
    tokens: 100,
  })
  hunt
    .mockImplementationOnce(async () =>
      batch({ stopped: 'budget', wrapUpWarnings: ['{"type":"a"}'] })
    )
    .mockImplementationOnce(async () => batch({ stopped: 'timeout' }))
    .mockImplementationOnce(async () =>
      batch({ stopped: 'budget', wrapUpWarnings: ['{"type":"b"}'] })
    )

  await securityHuntWorkflow(JOB)

  const rows = persist.mock.calls[0]![0].audit.tasks
  expect(rows[0]).toMatchObject({
    taskId: 't1',
    wrapUpWarnings: ['{"type":"a"}'],
  })
  expect(
    rows.find(
      (r: { taskId: string; stopped: string }) =>
        r.taskId === 't2' && r.stopped === 'timeout'
    )!.wrapUpWarnings
  ).toBeUndefined()
  expect(rows[rows.length - 1]).toMatchObject({
    wrapUpWarnings: ['{"type":"b"}'],
  })
})

it('carries wrappedUp from the batch into the persisted task audit', async () => {
  plan.mockResolvedValue({
    tasks: [
      { id: 't1', objective: 'o1', category: 'idor', startingPoints: [] },
      { id: 't2', objective: 'o2', category: 'ssrf', startingPoints: [] },
    ],
    reason: 'two signals',
    by: 'model',
    tokens: 100,
  })
  hunt
    .mockImplementationOnce(async () =>
      batch({ stopped: 'budget', wrappedUp: true })
    )
    .mockImplementationOnce(async () => batch({ stopped: 'done' }))

  await securityHuntWorkflow(JOB)

  const rows = persist.mock.calls[0]![0].audit.tasks
  expect(rows[0]).toMatchObject({ taskId: 't1', wrappedUp: true })
  // An agent that decided for itself is not marked — absent means "did not
  // need asking", and must never be confused with `false` meaning "we asked
  // and it refused".
  expect(rows[1]!.wrappedUp).toBeUndefined()
})

// LUM-781 — the trace, the stop facts and the wrap-up facts ride the same two
// audit rows as `wrappedUp`, and would be dropped the same way. Together they
// are what turns "budget stop, 0 candidates" into an answer to whether the
// agent was advancing toward a conclusion or still mapping.
it('LUM-781 carries trace, stop and wrapUp onto both the first-pass and retry audit rows, and leaves an empty trace absent', async () => {
  plan.mockResolvedValue({
    tasks: [
      { id: 't1', objective: 'o1', category: 'idor', startingPoints: [] },
      { id: 't2', objective: 'o2', category: 'ssrf', startingPoints: [] },
    ],
    reason: 'two signals',
    by: 'model',
    tokens: 100,
  })
  const trace = [
    {
      i: 1,
      tool: 'run_shell',
      text: 'Reading the handler.',
      inputTokens: 100,
      outputTokens: 10,
    },
  ]
  const stop = {
    by: 'budget',
    spent: 900,
    budget: 1000,
    reserve: 100,
    lastStep: 300,
    steps: 3,
  }
  const wrapUp = { ran: true, submitted: 0, tokens: 200 }
  hunt
    .mockImplementationOnce(async () =>
      batch({ stopped: 'budget', trace, stop, wrapUp })
    )
    // A batch that timed out before any step completed: `trace` is the empty
    // array the service always returns, `stop` still says why.
    .mockImplementationOnce(async () =>
      batch({ stopped: 'timeout', trace: [], stop: { ...stop, by: 'timeout' } })
    )
    .mockImplementationOnce(async () =>
      batch({
        stopped: 'budget',
        trace: [{ i: 1, tool: 'submit_candidates' }],
        stop,
        wrapUp: { ran: false, skipped: 'submitted' },
      })
    )

  await securityHuntWorkflow(JOB)

  const rows = persist.mock.calls[0]![0].audit.tasks
  expect(rows[0]).toMatchObject({ taskId: 't1', trace, stop, wrapUp })
  const timedOut = rows.find(
    (r: { taskId: string; stopped: string }) =>
      r.taskId === 't2' && r.stopped === 'timeout'
  )!
  expect(timedOut.trace).toBeUndefined()
  expect(timedOut.stop).toEqual({ ...stop, by: 'timeout' })
  expect(timedOut.wrapUp).toBeUndefined()
  // The retry pass writes its own row and carries all three too.
  expect(rows[rows.length - 1]).toMatchObject({
    taskId: 't2',
    stopped: 'budget',
    trace: [{ i: 1, tool: 'submit_candidates' }],
    stop,
    wrapUp: { ran: false, skipped: 'submitted' },
  })
})
