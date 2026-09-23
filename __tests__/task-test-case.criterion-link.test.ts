/**
 * LUM-815 · A（连线）: 用例声明它覆盖哪条验收标准。
 *
 * 两条红线，这组测试是它们的锁：
 *   1. **连线不牵连生命周期** —— 标准没了，用例不能跟着消失。硬删由 DB 的
 *      `onDelete: SetNull` 兜住（这条行为只住在 schema 里，所以断言读的是
 *      schema 原文）；软删的标准本来就留着行，引用自然活着。
 *   2. **连线只让证据可见，绝不代人裁定** —— 用例跑出 PASS 不写任何
 *      VerificationRun、不碰它覆盖的那条标准。这是整个方案的核心红线：
 *      标准的裁定必须能回答「谁说它过了」，一旦改成推导出来的，这个问题
 *      就永远没有答案。
 */
import { readFileSync } from 'fs'
import { join } from 'path'
import { taskTestCaseService } from '@/lib/services/task-test-case.service'
import { testCaseRepository } from '@/lib/repositories/test-case.repository'
import { acceptanceCriterionRepository } from '@/lib/repositories/acceptance-criterion.repository'
import { verificationRunRepository } from '@/lib/repositories/verification-run.repository'
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
jest.mock('@/lib/repositories/acceptance-criterion.repository', () => ({
  acceptanceCriterionRepository: {
    listByTask: jest.fn(),
    listByTaskIncludingDeleted: jest.fn(),
    update: jest.fn(),
    softDelete: jest.fn(),
    delete: jest.fn(),
  },
}))
jest.mock('@/lib/repositories/verification-run.repository', () => ({
  verificationRunRepository: {
    createMany: jest.fn(),
    create: jest.fn(),
    latestRunsByCriterion: jest.fn(),
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
const criteriaRepo = acceptanceCriterionRepository as jest.Mocked<
  typeof acceptanceCriterionRepository
>
const runRepo = verificationRunRepository as jest.Mocked<
  typeof verificationRunRepository
>

const CRITERION_ID = 'cri-covered-1'

const testCase = {
  id: 'tc-1',
  taskId: 't-1',
  number: 3,
  title: 'Dashboard footer FDIC disclosure',
  setup: null,
  steps: ['scroll: to the bottom of the page'],
  verification: [],
  expected: 'The disclosure is visible.',
  requiredEnvironment: null,
  criterionId: CRITERION_ID,
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
  deletedAt: null,
}

const attribution = { actorMemberId: 'm-1', sourceSessionId: 'sess-1' }

beforeEach(() => {
  jest.clearAllMocks()
  repo.listTaskPullRequests.mockResolvedValue([])
  repo.findById.mockResolvedValue(testCase)
  repo.update.mockImplementation(async (_id, patch) => ({
    ...testCase,
    ...patch,
  }))
  repo.createWithNumber.mockImplementation(async input => ({
    ...testCase,
    ...input,
    id: 'tc-new',
    number: 4,
  }))
  repo.createRun.mockImplementation(async input => ({
    ...input,
    id: 'run-1',
    evidence: input.evidence as Prisma.JsonValue,
    unprovenVerification: input.unprovenVerification as Prisma.JsonValue,
    disposition: null,
    createdAt: new Date('2026-01-02'),
  }))
  criteriaRepo.listByTask.mockResolvedValue([
    { id: CRITERION_ID, statement: 'covered', taskId: 't-1' },
  ] as never)
})

describe('LUM-815 · 连线不牵连用例的生命周期', () => {
  it('a test case survives its criterion being soft-deleted or hard-deleted', async () => {
    // ── 硬删：这条行为只住在 DB 约束里，所以断言读 schema 原文。
    // 一个 run-free 的 criterion 是**硬删**的（acceptance-criterion 的既有
    // 语义），如果这条关系写成 Cascade，硬删一条标准就会连带删掉别人写了
    // 半天的用例 —— 连同它 append-only 的执行记录。
    const schema = readFileSync(
      join(process.cwd(), 'prisma/schema.prisma'),
      'utf8'
    )
    const relation = schema
      .split('\n')
      .find(l => l.includes('criterion') && l.includes('AcceptanceCriterion?'))
    expect(relation).toBeDefined()
    expect(relation).toContain('onDelete: SetNull')
    expect(relation).not.toContain('Cascade')
    // 引用本身必须可空，否则 SetNull 无处可落。
    expect(schema).toMatch(/criterionId\s+String\?/)

    // ── 软删：有 run 的 criterion 留着墓碑行，引用天然活着。这里锁住的是
    // 另一半 —— 解绑走的是「把引用置空」，不是把用例删掉。
    await taskTestCaseService.update('tc-1', { criterionId: null }, attribution)
    expect(repo.update).toHaveBeenCalledWith(
      'tc-1',
      expect.objectContaining({ criterionId: null }),
      expect.anything()
    )
    expect(repo.softDelete).not.toHaveBeenCalled()

    // ── LUM-815 follow-up：软删那一半的后半句 ——「**读得出**该标准已变更」。
    // 这条断言原本不在这里，于是这条 criterion 顶着一个 machine-verified 的
    // 绿勾，而它句子里的这个子句从未实现、也从未被检查。补上之后，读出面必须
    // 说出「它已经不在合同里了」，否则读的人只会拿到一个在 `criteria list` 里
    // 查无此条的裸 id。
    repo.listRuns.mockResolvedValue([])
    criteriaRepo.listByTaskIncludingDeleted.mockResolvedValue([
      {
        id: CRITERION_ID,
        taskId: 't-1',
        statement: 'covered',
        deletedAt: new Date('2026-09-23'),
      },
    ] as never)
    const tombstoned = await taskTestCaseService.getDetail('tc-1')
    expect(tombstoned.criterion).toEqual({
      id: CRITERION_ID,
      statement: 'covered',
      removed: true,
    })

    // 还在合同里的标准不该被标成已变更。
    criteriaRepo.listByTaskIncludingDeleted.mockResolvedValue([
      {
        id: CRITERION_ID,
        taskId: 't-1',
        statement: 'covered',
        deletedAt: null,
      },
    ] as never)
    expect((await taskTestCaseService.getDetail('tc-1')).criterion).toEqual({
      id: CRITERION_ID,
      statement: 'covered',
      removed: false,
    })

    // 没声明覆盖时不查合同，也不编一个空壳对象出来。
    repo.findById.mockResolvedValue({ ...testCase, criterionId: null })
    expect((await taskTestCaseService.getDetail('tc-1')).criterion).toBeNull()
  })

  it('leaves the link unset when nobody declared one, and refuses a criterion from another task', async () => {
    // 未声明是合法常态：不该为了「完整」去查一次合同。
    await taskTestCaseService.create(
      't-1',
      {
        title: 'exploratory',
        steps: ['poke at it'],
        verification: [],
        expected: 'nothing explodes',
      } as never,
      attribution
    )
    expect(repo.createWithNumber).toHaveBeenCalledWith(
      expect.objectContaining({ criterionId: null }),
      expect.anything()
    )
    expect(criteriaRepo.listByTask).not.toHaveBeenCalled()

    // 跨任务引用会把覆盖缺口算到别的任务头上 —— 拒绝。
    await expect(
      taskTestCaseService.create(
        't-1',
        {
          title: 'mislinked',
          steps: ['step'],
          verification: [],
          expected: 'ok',
          criterionId: 'cri-from-another-task',
        } as never,
        attribution
      )
    ).rejects.toMatchObject({ status: 422 })
  })
})

describe('LUM-815 · 连线不参与裁定', () => {
  it('a passing test case run never writes a verdict for the criterion it covers', async () => {
    await taskTestCaseService.recordRun(
      testCase,
      {
        result: 'PASS',
        environment: 'PRODUCTION',
        evidence: [{ type: 'link', url: 'https://example.test/trace/1' }],
      } as never,
      attribution
    )

    // run 本身照常落库……
    expect(repo.createRun).toHaveBeenCalledTimes(1)
    // ……但没有任何一条 VerificationRun，也没有碰过那条标准。
    expect(runRepo.create).not.toHaveBeenCalled()
    expect(runRepo.createMany).not.toHaveBeenCalled()
    expect(criteriaRepo.update).not.toHaveBeenCalled()
  })
})
