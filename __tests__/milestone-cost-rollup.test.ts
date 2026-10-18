/** @jest-environment node */
jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    task: { findUnique: jest.fn() },
    session: { findMany: jest.fn(), count: jest.fn().mockResolvedValue(0) },
    hookEvent: { findMany: jest.fn() },
    verificationRun: { findMany: jest.fn() },
  },
}))

import { prisma } from '@/lib/db/prisma'
import { retrospectiveRepository } from '@/lib/repositories/retrospective.repository'

const taskFind = prisma.task.findUnique as jest.Mock
const sessionFind = prisma.session.findMany as jest.Mock
const hookFind = prisma.hookEvent.findMany as jest.Mock

beforeEach(() => {
  ;[taskFind, sessionFind, hookFind].forEach(m => m.mockReset())
  hookFind.mockResolvedValue([])
})

// t1: one measured session (10+20+5+0 = 35) plus one usage-less session (all
// null → contributes 0 but the task stays measured). t2: only a usage-less
// session → unmeasured. t3: no sessions at all → unmeasured.
const S1 = {
  id: 's1',
  taskId: 't1',
  inputTokens: 10,
  outputTokens: 20,
  cacheReadTokens: 5,
  cacheCreationTokens: 0,
}
const S1B = {
  id: 's1b',
  taskId: 't1',
  inputTokens: null,
  outputTokens: null,
  cacheReadTokens: null,
  cacheCreationTokens: null,
}
const S2 = {
  id: 's2',
  taskId: 't2',
  inputTokens: null,
  outputTokens: null,
  cacheReadTokens: null,
  cacheCreationTokens: null,
}

it('milestone cost rollup fail-closed and same-source', async () => {
  // --- batched rollup over the task set ---
  sessionFind.mockResolvedValue([S1, S1B, S2])
  const batched = await retrospectiveRepository.loadActualsForTasks([
    't1',
    't2',
    't3',
  ])
  expect(batched.tokenCost).toBe(35)
  expect(batched.measuredTasks).toBe(1)

  // --- same-source: Σ per-task loadActuals.tokenCost equals the batched sum ---
  taskFind.mockImplementation(({ where }: { where: { id: string } }) => {
    const sessions =
      where.id === 't1' ? [S1, S1B] : where.id === 't2' ? [S2] : []
    return Promise.resolve({ projectId: 'p1', sessions })
  })
  const perTask = await Promise.all([
    retrospectiveRepository.loadActuals('t1'),
    retrospectiveRepository.loadActuals('t2'),
    retrospectiveRepository.loadActuals('t3'),
  ])
  const perTaskSum = perTask.reduce((sum, a) => sum + (a?.tokenCost ?? 0), 0)
  expect(perTaskSum).toBe(batched.tokenCost)
  // t2 reads null (not measured), t3 has no sessions — neither fabricates a 0
  // that would break the identity.
  expect(perTask[1]?.tokenCost).toBeNull()

  // --- fail-closed: no measured task → tokenCost null, never a fake 0 ---
  sessionFind.mockResolvedValue([S2])
  const unmeasured = await retrospectiveRepository.loadActualsForTasks([
    't2',
    't3',
  ])
  expect(unmeasured.tokenCost).toBeNull()
  expect(unmeasured.measuredTasks).toBe(0)
  expect(unmeasured.activeTimeSec).toBe(0)
})

it('sums active time across the task set through the canonical turn windows', async () => {
  const t0 = new Date('2026-01-01T00:00:00Z')
  const at = (ms: number) => new Date(t0.getTime() + ms)
  sessionFind.mockResolvedValue([S1])
  // Two sessions (different tasks): 30s and 60s of turn-active time.
  hookFind.mockResolvedValue([
    { sessionId: 'sA', type: 'USER_PROMPT_SUBMIT', createdAt: at(0) },
    { sessionId: 'sA', type: 'STOP', createdAt: at(30_000) },
    { sessionId: 'sB', type: 'USER_PROMPT_SUBMIT', createdAt: at(0) },
    { sessionId: 'sB', type: 'STOP', createdAt: at(60_000) },
  ])
  const rollup = await retrospectiveRepository.loadActualsForTasks(['t1', 't2'])
  expect(rollup.activeTimeSec).toBe(90)
})

it('an empty task set short-circuits without querying', async () => {
  const rollup = await retrospectiveRepository.loadActualsForTasks([])
  expect(rollup).toEqual({
    tokenCost: null,
    activeTimeSec: 0,
    measuredTasks: 0,
    models: [],
    modelUnattributedTokens: 0,
  })
  expect(sessionFind).not.toHaveBeenCalled()
  expect(hookFind).not.toHaveBeenCalled()
})

it('merges per-model usage through the same measured gate (LUM-636)', async () => {
  sessionFind.mockResolvedValue([
    // Measured session with a per-model map.
    {
      ...S1, // 10+20+5+0 = 35
      usageByModel: {
        'claude-opus-4-5': {
          input: 10,
          output: 15,
          cacheRead: 5,
          cacheCreation: 0,
        },
      },
    },
    // Second measured-task session, map-less (pre-LUM-298): flat-only spend
    // becomes the explicit unattributed remainder.
    {
      taskId: 't1',
      inputTokens: 2,
      outputTokens: 3,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      usageByModel: null,
    },
    // Unmeasured task: even a present map contributes NOTHING (same gate as
    // the flat sum).
    {
      ...S2,
      usageByModel: {
        'claude-haiku-4-5': {
          input: 999,
          output: 999,
          cacheRead: 0,
          cacheCreation: 0,
        },
      },
    },
  ])
  const rollup = await retrospectiveRepository.loadActualsForTasks(['t1', 't2'])
  expect(rollup.tokenCost).toBe(40)
  expect(rollup.models).toEqual([
    {
      model: 'claude-opus-4-5',
      input: 10,
      output: 15,
      cacheRead: 5,
      cacheCreation: 0,
      total: 30,
    },
  ])
  // Σ(models) + unattributed == tokenCost — the flat total stays authoritative.
  expect(rollup.modelUnattributedTokens).toBe(10)
})
