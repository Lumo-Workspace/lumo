/**
 * LUM-808 步骤 1: FAIL 的归因。
 *
 * 三条红线，这组测试就是它们的锁：
 *   1. 非 FAIL 不谈「谁的锅」—— PASS / BLOCKED 带归因即 400。
 *   2. FAIL 必须归因 —— 缺失即 400。`UNKNOWN` 是合法答案，不是逃避。
 *   3. **不对称的举证责任**：只有 IMPLEMENTATION_DEFECT 需要额外举证
 *      （至少一条 evidence），另两类是「我没能证明」，白给。
 *
 * 第 3 条同时是任务描述里那个替代方案的落点——想说是实现的锅，
 * 就得先把证据落库，不能凭「我记得当时是这样」。
 */
import { taskTestCaseService } from '@/lib/services/task-test-case.service'
import { testCaseRepository } from '@/lib/repositories/test-case.repository'
import type { Prisma } from '@prisma/client'

jest.mock('@/lib/repositories/test-case.repository', () => ({
  testCaseRepository: {
    createWithNumber: jest.fn(),
    listForTask: jest.fn(),
    findById: jest.fn(),
    update: jest.fn(),
    softDelete: jest.fn(),
    createRun: jest.fn(),
    listRuns: jest.fn(),
    runsPerCase: jest.fn(),
    listTaskPullRequests: jest.fn(),
  },
}))
jest.mock('@/lib/repositories/activity.repository', () => ({
  activityRepository: { create: jest.fn() },
}))
jest.mock('@/lib/repositories/member.repository', () => ({
  memberRepository: {
    findActorByMemberId: jest.fn().mockResolvedValue({ id: 'actor-1' }),
  },
}))
jest.mock('@/lib/db/transaction', () => ({
  runInTransaction: (fn: (tx: unknown) => unknown) => fn({}),
}))

const repo = testCaseRepository as jest.Mocked<typeof testCaseRepository>

const testCase = {
  id: 'tc-1',
  taskId: 't-1',
  number: 3,
  title: 'Dashboard footer FDIC disclosure',
  setup: null,
  steps: ['scroll: to the bottom of the page', 'assert: the footer is visible'],
  verification: ['refresh: the page'],
  expected: 'The disclosure is visible.',
  requiredEnvironment: null,
  // LUM-815: 读模型新增的连线列。null = 没声明覆盖哪条标准（合法常态）。
  criterionId: null,
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
  deletedAt: null,
}

const attribution = { actorMemberId: 'm-1', sourceSessionId: 'sess-1' }

const linkEvidence = [
  { type: 'link' as const, url: 'https://example.test/trace/1' },
]

beforeEach(() => {
  jest.clearAllMocks()
  repo.listTaskPullRequests.mockResolvedValue([])
  repo.createRun.mockImplementation(async input => ({
    ...input,
    evidence: input.evidence as Prisma.JsonValue,
    unprovenVerification: input.unprovenVerification as Prisma.JsonValue,
    stepResults: input.stepResults as Prisma.JsonValue,
    id: 'run-1',
    createdAt: new Date('2026-02-01'),
    // LUM-812: runSelect 带出这条 run 的人类裁定；新记的 run 当然还没人裁。
    disposition: null,
  }))
})

describe('recordRun — FAIL attribution', () => {
  it('rejects a PASS run that carries an attribution', async () => {
    await expect(
      taskTestCaseService.recordRun(
        testCase,
        {
          result: 'PASS',
          environment: 'LOCAL',
          failureAttribution: 'CASE_OUTDATED',
        },
        attribution
      )
    ).rejects.toMatchObject({ status: 400 })
    expect(repo.createRun).not.toHaveBeenCalled()
  })

  it('rejects a BLOCKED run that carries an attribution', async () => {
    await expect(
      taskTestCaseService.recordRun(
        testCase,
        {
          result: 'BLOCKED',
          environment: 'LOCAL',
          failureAttribution: 'EXTERNAL_BLOCK',
        },
        attribution
      )
    ).rejects.toMatchObject({ status: 400 })
    expect(repo.createRun).not.toHaveBeenCalled()
  })

  it('rejects a FAIL run with no attribution at all', async () => {
    await expect(
      taskTestCaseService.recordRun(
        testCase,
        { result: 'FAIL', environment: 'LOCAL' },
        attribution
      )
    ).rejects.toMatchObject({ status: 400 })
    expect(repo.createRun).not.toHaveBeenCalled()
  })

  it('IMPLEMENTATION_DEFECT without evidence is rejected', async () => {
    await expect(
      taskTestCaseService.recordRun(
        testCase,
        {
          result: 'FAIL',
          environment: 'LOCAL',
          failureAttribution: 'IMPLEMENTATION_DEFECT',
          evidence: [],
        },
        attribution
      )
    ).rejects.toMatchObject({ status: 400 })
    expect(repo.createRun).not.toHaveBeenCalled()
  })

  it('IMPLEMENTATION_DEFECT with evidence is recorded', async () => {
    await taskTestCaseService.recordRun(
      testCase,
      {
        result: 'FAIL',
        environment: 'LOCAL',
        failureAttribution: 'IMPLEMENTATION_DEFECT',
        evidence: linkEvidence,
      },
      attribution
    )
    expect(repo.createRun).toHaveBeenCalledWith(
      expect.objectContaining({ failureAttribution: 'IMPLEMENTATION_DEFECT' }),
      expect.anything()
    )
  })

  it.each(['CASE_OUTDATED', 'EXTERNAL_BLOCK', 'UNKNOWN'] as const)(
    'records %s with no evidence — only IMPLEMENTATION_DEFECT carries the burden',
    async cause => {
      await taskTestCaseService.recordRun(
        testCase,
        {
          result: 'FAIL',
          environment: 'LOCAL',
          failureAttribution: cause,
        },
        attribution
      )
      expect(repo.createRun).toHaveBeenCalledWith(
        expect.objectContaining({ failureAttribution: cause }),
        expect.anything()
      )
    }
  )

  it('stores null on a PASS run — the column is FAIL-only', async () => {
    await taskTestCaseService.recordRun(
      testCase,
      { result: 'PASS', environment: 'LOCAL' },
      attribution
    )
    expect(repo.createRun).toHaveBeenCalledWith(
      expect.objectContaining({ failureAttribution: null }),
      expect.anything()
    )
  })
})

describe('recordRun — returns the capped verdict alongside the row', () => {
  it('hands back UNPROVEN for a PASS recorded outside the required environment', async () => {
    const { ceiling } = await taskTestCaseService.recordRun(
      { ...testCase, requiredEnvironment: 'PRODUCTION' },
      { result: 'PASS', environment: 'LOCAL' },
      attribution
    )
    expect(ceiling).toMatchObject({
      effective: 'UNPROVEN',
      reason: 'environment',
    })
  })

  it('snapshots the unobserved verification text it caps on', async () => {
    const { ceiling } = await taskTestCaseService.recordRun(
      testCase,
      {
        result: 'PASS',
        environment: 'LOCAL',
        unprovenVerification: [0],
      },
      attribution
    )
    expect(ceiling).toEqual({
      effective: 'UNPROVEN',
      reason: 'unobserved',
      unobserved: [{ index: 0, text: 'refresh: the page' }],
    })
  })

  it('rejects an unproven index outside the verification range', async () => {
    await expect(
      taskTestCaseService.recordRun(
        testCase,
        { result: 'PASS', environment: 'LOCAL', unprovenVerification: [5] },
        attribution
      )
    ).rejects.toMatchObject({ status: 400 })
  })
})
