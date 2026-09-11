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
} from '@/lib/services/security-hunt.config'
import {
  planFallback,
  categoriesToTasks,
} from '@/lib/security-scan/hunt/plan-fallback'

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
 * LUM-758 Task 10 — short circuit A is a DIFF-level test now. There is no
 * up-front subgraph to find empty, and building one just to decide whether to
 * plan is the cost this task removes. `evaluateHuntTrigger` skips non-source
 * files outright, so no `diff:`-prefixed reason means no TypeScript source in
 * the diff carried an entry / sink / control signal — nothing to hunt, and
 * not one LLM call is worth making.
 */
it('skips before planning when no diff: reason says a TypeScript source was touched', async () => {
  // A HIGH from stage A alone still triggers the layer (`evaluateHuntTrigger`
  // adds `stage-a:high` regardless of the files), and it is exactly the case
  // that used to build a 40-file subgraph to learn there was nothing in it.
  const result = await securityHuntWorkflow({
    ...JOB,
    reasons: ['stage-a:high'],
  })

  expect(plan).not.toHaveBeenCalled()
  expect(hunt).not.toHaveBeenCalled()
  expect(verifyGraph).not.toHaveBeenCalled()
  expect(result.outcome).toBe('SKIPPED')
  const persisted = persist.mock.calls[0][0]
  expect(persisted.stage).toBe('SKIPPED')
  expect(persisted.audit.planned).toEqual([])
  expect(persisted.tokenSpent).toBe(0)
})

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
  expect(persist.mock.calls[0][0].partial).toBe(false)
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
  expect(persist.mock.calls[0][0].partial).toBe(true)
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

  // Narrowing: the FAILED variant of HuntResult carries no `tokenSpent`.
  if (result.outcome === 'FAILED') throw new Error(result.reason)
  // 900 (plan) + 1000 (one task batch)
  expect(result.tokenSpent).toBe(1_900)
})
