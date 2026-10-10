/** @jest-environment node */
jest.mock('@/lib/workflows/security-hunt.steps', () => ({
  buildVerifySubgraphStep: jest.fn(),
  planHuntStep: jest.fn(),
  huntTaskStep: jest.fn(),
  mechanicalVerifyStep: jest.fn(),
  falsifierStep: jest.fn(),
  persistHuntFindingsStep: jest.fn(),
  markHuntFailedStep: jest.fn(),
  // LUM-832: undefined → the re-queue is skipped and the run persists as before.
  requeueHuntStep: jest.fn(),
  continueHuntStep: jest.fn(),
  awaitManagedScanStep: jest.fn(),
}))
// `security-scan-helpers` pulls in the SARIF ingest steps, which reach
// octokit (ESM) at import time — the same mock the legacy workflow suite needs.
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

import { securityHuntWorkflow } from '@/lib/workflows/security-hunt'
import {
  buildVerifySubgraphStep,
  planHuntStep,
  huntTaskStep,
  mechanicalVerifyStep,
  persistHuntFindingsStep,
} from '@/lib/workflows/security-hunt.steps'
import {
  HUNT_CATEGORIES,
  HUNT_MAX_PLANNED_TASKS,
  type HuntTask,
} from '@/ee/security/services/security-hunt.config'
import {
  planFallback,
  categoriesToTasks,
} from '@/ee/security/security-scan/hunt/plan-fallback'

const verifyGraph = buildVerifySubgraphStep as jest.Mock
const plan = planHuntStep as jest.Mock
const hunt = huntTaskStep as jest.Mock
const verify = mechanicalVerifyStep as jest.Mock
const persist = persistHuntFindingsStep as jest.Mock

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

const task = (
  id: string,
  category: HuntTask['category'],
  objective = `investigate ${category} on a.ts`
): HuntTask => ({ id, objective, category, startingPoints: ['a.ts'] })

const batch = (n = 0) => ({
  candidates: [],
  tokens: 1_000,
  elapsedMs: 100,
  stopped: 'done' as const,
  _n: n,
})

beforeEach(() => {
  jest.clearAllMocks()
  verifyGraph.mockResolvedValue(SUBGRAPH)
  verify.mockResolvedValue({ accepted: [], rejected: [] })
  persist.mockResolvedValue({ written: 0 })
  hunt.mockResolvedValue(batch())
})

it('plan returns an empty task list: no hunt LLM step and the layer is SKIPPED', async () => {
  plan.mockResolvedValue({
    tasks: [],
    reason: 'no entry reaches a sink in this diff',
    by: 'model',
    tokens: 300,
  })

  const result = await securityHuntWorkflow(JOB)

  expect(hunt).not.toHaveBeenCalled()
  expect(result.outcome).toBe('SKIPPED')
  const persisted = persist.mock.calls[0][0]
  expect(persisted.audit.planned).toEqual([])
  expect(persisted.audit.tasks).toEqual([])
  expect(persisted.audit.plannedReason).toBe(
    'no entry reaches a sink in this diff'
  )
  expect(persisted.stage).toBe('SKIPPED')
})

/**
 * LUM-758 Task 10 — short circuit A is a DIFF-level test now: there is no
 * up-front subgraph to find empty, and building one just to decide whether to
 * plan is the cost this task removes. What it asks is "does this diff give
 * the hunt anywhere to start", and the answer is `touchedSourcePaths`, which
 * stage A hands down from the very `files` the trigger read.
 *
 * A PR that touched no TS/TSX at all is the genuine skip, whatever fired.
 */
it('skips before planning when the diff touched no TypeScript source at all', async () => {
  // A HIGH from stage A alone still triggers the layer (`evaluateHuntTrigger`
  // adds `stage-a:high` regardless of the files), and it is exactly the case
  // that used to build a 40-file subgraph to learn there was nothing in it.
  const result = await securityHuntWorkflow({
    ...JOB,
    reasons: ['stage-a:high'],
    touchedSourcePaths: [],
  })

  expect(plan).not.toHaveBeenCalled()
  expect(hunt).not.toHaveBeenCalled()
  expect(verifyGraph).not.toHaveBeenCalled()
  expect(result.outcome).toBe('SKIPPED')
  const persisted = persist.mock.calls[0][0]
  expect(persisted.stage).toBe('SKIPPED')
  expect(persisted.audit.planned).toEqual([])
  expect(persisted.audit.plannedReason).toBe(
    'the diff touched no TypeScript source'
  )
  // NOT `fallback`. No planner ran here, so booking this as a planner failure
  // would inflate the model-failure rate in the very read-out three deferred
  // launch decisions are waiting on (LUM-758 fifth review).
  expect(persisted.audit.plannedBy).toBe('not-attempted')
  expect(persisted.tokenSpent).toBe(0)
})

/**
 * LUM-758 fifth review — the DEPLOY BOUNDARY. `reasons`,
 * `touchedSourcePaths` and `managedScanStarted` all arrived on this branch as
 * REQUIRED `HuntJob` fields with no default, so for one deploy window every
 * run the previous deployment had already queued arrives without them. Before
 * the `?? []` defaults, `job.reasons.some(...)` threw, the inner catch turned
 * the throw into `raw.length === 0`, and the scan landed FAILED — inside the
 * very week the ≥80% RAN-or-SKIPPED acceptance metric is measured over.
 *
 * The cast is the point of the test: TypeScript says these fields exist, and
 * the old jobs sitting in the queue say otherwise.
 */
it('an in-flight job from the previous deployment SKIPS instead of FAILING', async () => {
  const legacy = {
    scanId: 's1',
    pullRequestId: 'pr1',
    taskId: 't1',
    workspaceId: 'w1',
    repo: 'o/r',
    prNumber: 7,
    headSha: 'a'.repeat(40),
  } as unknown as Parameters<typeof securityHuntWorkflow>[0]

  const result = await securityHuntWorkflow(legacy)

  expect(result.outcome).toBe('SKIPPED')
  expect(plan).not.toHaveBeenCalled()
  expect(hunt).not.toHaveBeenCalled()
  const persisted = persist.mock.calls[0][0]
  expect(persisted.stage).toBe('SKIPPED')
  expect(persisted.audit.plannedBy).toBe('not-attempted')
  expect(persisted.audit.plannedReason).toBe(
    'the diff touched no TypeScript source'
  )
})

/**
 * The other TWO of `evaluateHuntTrigger`'s three conditions. Neither leaves a
 * `diff:` reason, so a short circuit that only tested that prefix skipped
 * them outright — after stage A had already kept the managed scan's VM alive
 * on the hunt's longer timeout and stamped `stages.hunt = PENDING`. A HIGH
 * secrets/judge finding, or an open L4 crossing, ALONGSIDE changed source is
 * exactly the PR worth planning for.
 */
it.each([['stage-a:high'], ['l4:open-crossing']])(
  'a %s PR that touched source still reaches the planner',
  async reason => {
    plan.mockResolvedValue({
      tasks: [task('t1', 'idor')],
      reason: 'high finding next to changed code',
      by: 'model',
      tokens: 200,
    })

    const result = await securityHuntWorkflow({
      ...JOB,
      reasons: [reason],
      touchedSourcePaths: ['lib/s.ts'],
    })

    expect(plan).toHaveBeenCalledTimes(1)
    expect(hunt).toHaveBeenCalledTimes(1)
    expect(result.outcome).not.toBe('SKIPPED')
  }
)

it('plan failure falls back to deterministic category tasks, at most three, never all six', async () => {
  // Reasons that hit four fallback categories at once (injection twice, ssrf,
  // prompt_injection, plus an uncontrolled entry → idor): the real
  // deterministic planner is what decides how wide that gets, so drive the
  // mocked step with its actual output rather than a hand-written array.
  const job = {
    ...JOB,
    reasons: [
      'diff:sink:prisma-raw',
      'diff:sink:child-process',
      'diff:sink:fetch',
      'diff:sink:llm-call',
      'diff:entry:app/api/x/route.ts',
    ],
  }
  const tasks = categoriesToTasks(planFallback(job.reasons))
  plan.mockResolvedValue({
    tasks,
    reason: 'plan unavailable: gateway timeout',
    by: 'fallback',
    tokens: 0,
  })

  await securityHuntWorkflow(job)

  const ran = hunt.mock.calls.map(c => c[0].task)
  expect(ran.map((t: HuntTask) => t.category)).toEqual([
    'injection',
    'idor',
    'ssrf',
  ])
  expect(ran.length).toBeLessThanOrEqual(HUNT_MAX_PLANNED_TASKS)
  expect(HUNT_MAX_PLANNED_TASKS).toBeLessThan(HUNT_CATEGORIES.length)
  expect(ran.length).toBeLessThan(HUNT_CATEGORIES.length)
  // Every fallback task is a real task, not a bare category label.
  for (const t of ran as HuntTask[])
    expect(t.objective.length).toBeGreaterThan(20)
  const persisted = persist.mock.calls[0][0]
  expect(persisted.audit.plannedBy).toBe('fallback')
  expect(persisted.audit.planned).toEqual(tasks)
})

/**
 * LUM-764 — the floor rule's price has to be readable after the fact: a scan
 * that would have been SKIPPED and was held open by the mechanical signals
 * says so on the row. Both fields are copied verbatim from the plan step, and
 * both default when an in-flight run replays a result queued by the previous
 * deployment.
 */
it('the audit records whether the plan saw task context and which categories the floor forced', async () => {
  plan.mockResolvedValue({
    tasks: [task('p1', 'injection'), task('p2', 'idor')],
    reason: 'raised to the floor',
    by: 'model',
    tokens: 90,
    taskContext: true,
    floorForced: ['idor'],
  })

  await securityHuntWorkflow(JOB)

  const persisted = persist.mock.calls[0][0]
  expect(persisted.audit.taskContext).toBe(true)
  expect(persisted.audit.floorForced).toEqual(['idor'])

  // A plan from the previous deployment carries neither field.
  persist.mockClear()
  plan.mockResolvedValue({
    tasks: [task('t1', 'injection')],
    reason: 'pre-LUM-764 plan',
    by: 'model',
    tokens: 40,
  })
  await securityHuntWorkflow(JOB)
  const legacy = persist.mock.calls[0][0]
  expect(legacy.audit.taskContext).toBe(false)
  expect(legacy.audit.floorForced).toEqual([])
})

it('partial is judged only over planned tasks', async () => {
  // Two tasks share a category on purpose: a plan is a list of objectives,
  // not a set of labels, and the verdict must be read off the tasks.
  const tasks = [
    task('t1', 'injection', 'raw SQL built from req.query in lib/db.ts'),
    task(
      't2',
      'injection',
      'child_process.exec on a path from the request body'
    ),
    task('t3', 'idor', 'workspace id from the path reaches prisma unchecked'),
  ]
  plan.mockResolvedValue({
    tasks,
    reason: 'raw prisma call added on an unauthenticated route',
    by: 'model',
    tokens: 400,
  })

  const result = await securityHuntWorkflow(JOB)

  expect(hunt).toHaveBeenCalledTimes(3)
  expect(hunt.mock.calls.map(c => c[0].task.id)).toEqual(['t1', 't2', 't3'])
  // ssrf / prompt_injection / race / logic were never planned; none of them
  // may drag the verdict down — that bug is what made every scan PARTIAL.
  expect(result.outcome).toBe('RAN')
  expect(persist.mock.calls[0][0].partialCauses).toEqual([])
})

it('two tasks in the same category keep separate outcomes: the first stopping short still makes the layer PARTIAL', async () => {
  plan.mockResolvedValue({
    tasks: [
      task('t1', 'injection', 'raw SQL built from req.query in lib/db.ts'),
      task('t2', 'injection', 'child_process.exec on a request-derived path'),
    ],
    reason: 'two injection objectives',
    by: 'model',
    tokens: 0,
  })
  // t1 runs out of steps, t2 finishes. Keyed by category, t2's `done` would
  // overwrite t1's `steps` and the layer would wrongly report RAN.
  hunt
    .mockResolvedValueOnce({ ...batch(), stopped: 'steps' as const })
    .mockResolvedValueOnce(batch())

  const result = await securityHuntWorkflow(JOB)

  expect(hunt).toHaveBeenCalledTimes(2)
  expect(result.outcome).toBe('PARTIAL')
  expect(persist.mock.calls[0][0].partialCauses).toEqual(['HUNT_INCOMPLETE'])
})

it('the retry pass re-runs the task that failed, not its category sibling', async () => {
  plan.mockResolvedValue({
    tasks: [
      task('t1', 'injection', 'raw SQL built from req.query in lib/db.ts'),
      task('t2', 'injection', 'child_process.exec on a request-derived path'),
    ],
    reason: 'two injection objectives',
    by: 'model',
    tokens: 0,
  })
  hunt
    .mockResolvedValueOnce({ ...batch(), stopped: 'error' as const })
    .mockResolvedValueOnce(batch())

  const result = await securityHuntWorkflow(JOB)

  expect(hunt).toHaveBeenCalledTimes(3)
  expect(hunt.mock.calls[2][0].task.id).toBe('t1')
  expect(result.outcome).toBe('RAN')
  const rows = persist.mock.calls[0][0].audit.tasks
  expect(rows.map((r: { taskId: string }) => r.taskId)).toEqual([
    't1',
    't2',
    't1',
  ])
})

it('a planned task that never finishes still makes the layer PARTIAL', async () => {
  plan.mockResolvedValue({
    tasks: [task('t1', 'injection'), task('t2', 'idor')],
    reason: 'two signals',
    by: 'model',
    tokens: 400,
  })
  hunt
    .mockResolvedValueOnce(batch())
    .mockResolvedValueOnce({ ...batch(), stopped: 'steps' as const })

  const result = await securityHuntWorkflow(JOB)

  expect(result.outcome).toBe('PARTIAL')
})

it('counts the plan step tokens toward tokenSpent', async () => {
  plan.mockResolvedValue({
    tasks: [task('t1', 'injection')],
    reason: 'raw prisma',
    by: 'model',
    tokens: 900,
  })

  const result = await securityHuntWorkflow(JOB)

  // Narrowing: the FAILED / REQUEUED / DISABLED variants carry no `tokenSpent`.
  if (!('tokenSpent' in result)) throw new Error(result.outcome)
  // 900 (plan) + 1000 (one task batch)
  expect(result.tokenSpent).toBe(1_900)
})

// LUM-766 follow-up — the failure facts have to reach the persisted audit, or
// the next diagnosis is another experiment instead of a read. Three fields in
// this layer (`wrappedUp`, `wrapUpWarnings`, the located sites) were each
// computed, carried, and silently unreadable at exactly this hop.
it('persists HOW the planning call failed, not just that it fell back', async () => {
  plan.mockResolvedValue({
    tasks: [],
    reason:
      'plan unavailable: No object generated: the model did not return a response.',
    by: 'fallback',
    tokens: 0,
    planFailure: {
      message: 'No object generated: the model did not return a response.',
      finishReason: 'length',
      reasoningTokens: 7_940,
      outputTokens: 8_000,
      textPrefix: '',
    },
  })

  await securityHuntWorkflow(JOB)

  const { audit } = persist.mock.calls[0][0]
  expect(audit.planFailure).toEqual({
    message: 'No object generated: the model did not return a response.',
    finishReason: 'length',
    reasoningTokens: 7_940,
    outputTokens: 8_000,
    textPrefix: '',
  })
})

it('LUM-776: persists the envelope repair so a repaired {} is never read as a reasoned empty plan', async () => {
  plan.mockResolvedValue({
    tasks: [],
    reason: 'the planner returned no tasks and gave no reason',
    by: 'model',
    tokens: 12,
    planRepair: 'missing-tasks',
  })

  await securityHuntWorkflow(JOB)

  const audit = persist.mock.calls[0][0].audit
  expect(audit.plannedBy).toBe('model')
  expect(audit.planRepair).toBe('missing-tasks')
})

it('leaves planFailure off the audit when the planner answered', async () => {
  plan.mockResolvedValue({
    tasks: [],
    reason: 'nothing worth hunting',
    by: 'model',
    tokens: 300,
  })

  await securityHuntWorkflow(JOB)

  expect(persist.mock.calls[0][0].audit.planFailure).toBeUndefined()
  expect(persist.mock.calls[0][0].audit.planRepair).toBeUndefined()
})

// LUM-758 follow-up — the shell stats have to reach the persisted audit on BOTH
// passes. Four fields in this layer (`wrappedUp`, `wrapUpWarnings`, the located
// sites, `planFailure`) were each computed, carried, and silently unreadable at
// exactly this hop.
it('persists what the agent asked the shell for, on the first pass and the retry', async () => {
  plan.mockResolvedValue({
    tasks: [
      { id: 't1', objective: 'o1', category: 'idor', startingPoints: [] },
    ],
    reason: 'one signal',
    by: 'model',
    tokens: 100,
  })
  // Shaped like what `huntBatch` really returns — the earlier version mocked a
  // field the service never produced on a timeout, so it read as coverage of
  // that path while proving nothing about it.
  const shell = (refused: number) => ({
    calls: 3,
    refused,
    failed: 0,
    empty: 0,
    outputChars: 10,
    commands: [{ cmd: 'rg -n x lib/' }],
  })
  hunt
    .mockResolvedValueOnce({ ...batch(), stopped: 'timeout', shell: shell(3) })
    .mockResolvedValueOnce({ ...batch(), stopped: 'budget', shell: shell(1) })

  await securityHuntWorkflow(JOB)

  const rows = persist.mock.calls[0]![0].audit.tasks
  expect(rows).toHaveLength(2)
  expect(rows[0]!.shell).toMatchObject({ calls: 3, refused: 3 })
  expect(rows[1]!.shell).toMatchObject({ calls: 3, refused: 1 })
})

it('records a zeroed shell rather than omitting it when nothing ran', async () => {
  plan.mockResolvedValue({
    tasks: [
      { id: 't1', objective: 'o1', category: 'idor', startingPoints: [] },
    ],
    reason: 'one signal',
    by: 'model',
    tokens: 100,
  })
  hunt.mockResolvedValue({
    ...batch(),
    stopped: 'budget',
    shell: {
      calls: 0,
      refused: 0,
      failed: 0,
      empty: 0,
      outputChars: 0,
      commands: [],
    },
  })

  await securityHuntWorkflow(JOB)

  // `shell` is required on HuntBatchOutput now, so "the agent ran nothing" is
  // zeros — a fact — rather than an absent field indistinguishable from a
  // deployment that predates the change.
  expect(persist.mock.calls[0]![0].audit.tasks[0]!.shell).toEqual({
    calls: 0,
    refused: 0,
    failed: 0,
    empty: 0,
    outputChars: 0,
    commands: [],
  })
})
