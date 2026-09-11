/** @jest-environment node */
jest.mock('@/lib/workflows/security-hunt.steps', () => ({
  buildSubgraphStep: jest.fn(),
  planHuntStep: jest.fn(),
  huntCategoryStep: jest.fn(),
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
  buildSubgraphStep,
  planHuntStep,
  huntCategoryStep,
  mechanicalVerifyStep,
  persistHuntFindingsStep,
} from '@/lib/workflows/security-hunt.steps'
import { HUNT_CATEGORIES } from '@/lib/services/security-hunt.config'

const build = buildSubgraphStep as jest.Mock
const plan = planHuntStep as jest.Mock
const hunt = huntCategoryStep as jest.Mock
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
const EMPTY_SUBGRAPH = { symbols: [], edges: [], files: [] }

const batch = (n = 0) => ({
  candidates: [],
  tokens: 1_000,
  elapsedMs: 100,
  stopped: 'done' as const,
  _n: n,
})

beforeEach(() => {
  jest.clearAllMocks()
  build.mockResolvedValue({ subgraph: SUBGRAPH, partial: false })
  verify.mockResolvedValue({ accepted: [], rejected: [] })
  persist.mockResolvedValue({ written: 0 })
  hunt.mockResolvedValue(batch())
})

it('plan returns empty categories: no hunt LLM step and the layer is SKIPPED', async () => {
  plan.mockResolvedValue({
    categories: [],
    reason: 'no entry reaches a sink in this diff',
    by: 'model',
    tokens: 300,
  })

  const result = await securityHuntWorkflow(JOB)

  expect(hunt).not.toHaveBeenCalled()
  expect(result.outcome).toBe('SKIPPED')
  const persisted = persist.mock.calls[0][0]
  expect(persisted.audit.planned).toEqual([])
  expect(persisted.audit.plannedReason).toBe(
    'no entry reaches a sink in this diff'
  )
  expect(persisted.stage).toBe('SKIPPED')
})

it('skips before planning when the subgraph is empty', async () => {
  build.mockResolvedValue({ subgraph: EMPTY_SUBGRAPH, partial: false })

  const result = await securityHuntWorkflow(JOB)

  expect(plan).not.toHaveBeenCalled()
  expect(hunt).not.toHaveBeenCalled()
  expect(result.outcome).toBe('SKIPPED')
})

it('plan failure falls back to deterministic mapping, at most two categories, never all six', async () => {
  plan.mockResolvedValue({
    categories: ['injection'],
    reason: 'plan unavailable: gateway timeout',
    by: 'fallback',
    tokens: 0,
  })

  await securityHuntWorkflow(JOB)

  const ran = hunt.mock.calls.map(c => c[0].category)
  expect(ran).toEqual(['injection'])
  expect(ran.length).toBeLessThanOrEqual(2)
  expect(ran.length).toBeLessThan(HUNT_CATEGORIES.length)
  const persisted = persist.mock.calls[0][0]
  expect(persisted.audit.plannedBy).toBe('fallback')
})

it('partial is judged only over planned categories', async () => {
  plan.mockResolvedValue({
    categories: ['injection', 'idor'],
    reason: 'raw prisma call added on an unauthenticated route',
    by: 'model',
    tokens: 400,
  })

  const result = await securityHuntWorkflow(JOB)

  expect(hunt).toHaveBeenCalledTimes(2)
  expect(result.outcome).toBe('RAN')
  expect(persist.mock.calls[0][0].partial).toBe(false)
})

it('a planned category that never finishes still makes the layer PARTIAL', async () => {
  plan.mockResolvedValue({
    categories: ['injection', 'idor'],
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
    categories: ['injection'],
    reason: 'raw prisma',
    by: 'model',
    tokens: 900,
  })

  const result = await securityHuntWorkflow(JOB)

  // Narrowing: the FAILED variant of HuntResult carries no `tokenSpent`.
  if (result.outcome === 'FAILED') throw new Error(result.reason)
  // 900 (plan) + 1000 (one category batch)
  expect(result.tokenSpent).toBe(1_900)
})
