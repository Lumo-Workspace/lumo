/**
 * LUM-801: test case service —— 业务规则都在这里。
 *
 * 三条红线，这组测试就是它们的锁：
 *   1. environment 没有默认值，缺失即 400。
 *   2. 只有 FAIL 携带失败定位；BLOCKED 的语义是「用例根本没跑起来」，
 *      没跑起来就没有「挂在第几步」。
 *   3. 陈旧性 fail-closed：数据缺一半就是 unknown，绝不乐观地报 fresh。
 */
import {
  taskTestCaseService,
  deriveRunFreshness,
  type TaskPullRequestSnapshot,
} from '@/lib/services/task-test-case.service'
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
  setup: 'The user is on the Dashboard.',
  steps: [
    'scroll: to the bottom of the page',
    'assert: text "Northwind Bank is a Member FDIC" is visible in the footer',
  ],
  verification: ['refresh: the page'],
  expected: 'The disclosure is visible.',
  requiredEnvironment: null,
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
  deletedAt: null,
}

const attribution = { actorMemberId: 'm-1', sourceSessionId: 'sess-1' }

beforeEach(() => {
  jest.clearAllMocks()
  repo.listTaskPullRequests.mockResolvedValue([])
  // createRun 的返回就是它收到的 input 加上 id/createdAt —— 测试只关心传进去的
  // 字段，所以这里原样回抛。
  repo.createRun.mockImplementation(async input => ({
    ...input,
    // 写入类型是 InputJsonValue，读出来的行类型是 JsonValue —— 只有这一个字段
    // 需要窄一下，其余原样回抛。
    evidence: input.evidence as Prisma.JsonValue,
    unprovenVerification: input.unprovenVerification as Prisma.JsonValue,
    id: 'run-1',
    createdAt: new Date('2026-02-01'),
  }))
})

describe('recordRun — environment', () => {
  it('rejects a run without environment', async () => {
    await expect(
      taskTestCaseService.recordRun(
        testCase,
        { result: 'PASS' } as never,
        attribution
      )
    ).rejects.toMatchObject({ status: 400 })
    expect(repo.createRun).not.toHaveBeenCalled()
  })

  it('records the environment verbatim — no default is substituted', async () => {
    await taskTestCaseService.recordRun(
      testCase,
      { result: 'PASS', environment: 'PRODUCTION' },
      attribution
    )
    expect(repo.createRun).toHaveBeenCalledWith(
      expect.objectContaining({ environment: 'PRODUCTION' }),
      expect.anything()
    )
  })
})

describe('recordRun — failure locator', () => {
  it('rejects a PASS run that carries a locator', async () => {
    await expect(
      taskTestCaseService.recordRun(
        testCase,
        {
          result: 'PASS',
          environment: 'LOCAL',
          failedPhase: 'STEPS',
          failedIndex: 0,
        },
        attribution
      )
    ).rejects.toMatchObject({ status: 400 })
  })

  it('rejects a BLOCKED run that carries a locator — BLOCKED means it never ran', async () => {
    await expect(
      taskTestCaseService.recordRun(
        testCase,
        {
          result: 'BLOCKED',
          environment: 'LOCAL',
          failedPhase: 'STEPS',
          failedIndex: 0,
        },
        attribution
      )
    ).rejects.toMatchObject({ status: 400 })
  })

  it('rejects a FAIL locator whose index is out of range for that phase', async () => {
    await expect(
      taskTestCaseService.recordRun(
        testCase,
        {
          result: 'FAIL',
          environment: 'LOCAL',
          failedPhase: 'VERIFICATION',
          failedIndex: 1,
        },
        attribution
      )
    ).rejects.toMatchObject({ status: 400 })
  })

  it('rejects a locator with a phase but no index', async () => {
    await expect(
      taskTestCaseService.recordRun(
        testCase,
        { result: 'FAIL', environment: 'LOCAL', failedPhase: 'STEPS' },
        attribution
      )
    ).rejects.toMatchObject({ status: 400 })
  })

  it('accepts a FAIL with no locator at all', async () => {
    const { run } = await taskTestCaseService.recordRun(
      testCase,
      // LUM-808: FAIL 现在必须归因；这条测的是定位，用举证责任最轻的 UNKNOWN。
      { result: 'FAIL', environment: 'LOCAL', failureAttribution: 'UNKNOWN' },
      attribution
    )
    expect(run.failedPhase).toBeNull()
    expect(run.failedStepText).toBeNull()
  })

  it('snapshots the STEPS text at the located index', async () => {
    await taskTestCaseService.recordRun(
      testCase,
      {
        result: 'FAIL',
        environment: 'LOCAL',
        failedPhase: 'STEPS',
        failedIndex: 1,
        failureAttribution: 'UNKNOWN',
      },
      attribution
    )
    expect(repo.createRun).toHaveBeenCalledWith(
      expect.objectContaining({
        failedStepText:
          'assert: text "Northwind Bank is a Member FDIC" is visible in the footer',
      }),
      expect.anything()
    )
  })

  it('snapshots the VERIFICATION text when the phase is VERIFICATION', async () => {
    await taskTestCaseService.recordRun(
      testCase,
      {
        result: 'FAIL',
        environment: 'LOCAL',
        failedPhase: 'VERIFICATION',
        failedIndex: 0,
        failureAttribution: 'UNKNOWN',
      },
      attribution
    )
    expect(repo.createRun).toHaveBeenCalledWith(
      expect.objectContaining({ failedStepText: 'refresh: the page' }),
      expect.anything()
    )
  })
})

describe('recordRun — code coordinates', () => {
  it('rejects a PR number that is not linked to this task', async () => {
    repo.listTaskPullRequests.mockResolvedValue([
      {
        id: 'pr-mine',
        number: 1,
        title: '',
        url: '',
        state: 'open',
        headSha: null,
        mergeCommitSha: null,
      },
    ])
    await expect(
      taskTestCaseService.recordRun(
        testCase,
        { result: 'PASS', environment: 'LOCAL', pullRequestNumber: 999 },
        attribution
      )
    ).rejects.toMatchObject({ status: 400 })
  })

  it('resolves the PR number to its id and stores sha + dirty verbatim', async () => {
    repo.listTaskPullRequests.mockResolvedValue([
      {
        id: 'pr-1',
        number: 7,
        title: '',
        url: '',
        state: 'open',
        headSha: 'a'.repeat(40),
        mergeCommitSha: null,
      },
    ])
    await taskTestCaseService.recordRun(
      testCase,
      {
        result: 'PASS',
        environment: 'PREVIEW',
        pullRequestNumber: 7,
        commitSha: 'a'.repeat(40),
        commitDirty: true,
      },
      attribution
    )
    expect(repo.createRun).toHaveBeenCalledWith(
      expect.objectContaining({
        pullRequestId: 'pr-1',
        commitSha: 'a'.repeat(40),
        commitDirty: true,
      }),
      expect.anything()
    )
  })

  it('leaves the coordinates null when the caller gives none — never defaults dirty to false', async () => {
    await taskTestCaseService.recordRun(
      testCase,
      { result: 'PASS', environment: 'LOCAL' },
      attribution
    )
    expect(repo.createRun).toHaveBeenCalledWith(
      expect.objectContaining({
        pullRequestId: null,
        commitSha: null,
        commitDirty: null,
      }),
      expect.anything()
    )
  })
})

describe('recordRun — provenance', () => {
  it('carries the member and session onto the row', async () => {
    await taskTestCaseService.recordRun(
      testCase,
      { result: 'PASS', environment: 'LOCAL' },
      attribution
    )
    expect(repo.createRun).toHaveBeenCalledWith(
      expect.objectContaining({
        executedByMemberId: 'm-1',
        sourceSessionId: 'sess-1',
      }),
      expect.anything()
    )
  })
})

describe('deriveRunFreshness', () => {
  const pr = (
    headSha: string | null,
    mergeCommitSha: string | null = null,
    state = 'open'
  ): TaskPullRequestSnapshot => ({
    id: 'pr-1',
    number: 7,
    title: '',
    url: '',
    state,
    headSha,
    mergeCommitSha,
  })

  const run = (over: Record<string, unknown>) =>
    ({
      pullRequestId: 'pr-1',
      commitSha: 'abc1234',
      commitDirty: false,
      ...over,
    }) as never

  it('is fresh when the run sha equals the PR head', () => {
    expect(deriveRunFreshness(run({}), pr('abc1234'))).toEqual({
      state: 'fresh',
      currentSha: 'abc1234',
    })
  })

  it('is stale when the PR has moved on', () => {
    expect(deriveRunFreshness(run({}), pr('def5678'))).toEqual({
      state: 'stale',
      currentSha: 'def5678',
    })
  })

  it('is unknown — never fresh — when the PR head is not synced yet', () => {
    expect(deriveRunFreshness(run({}), pr(null)).state).toBe('unknown')
  })

  it('is unknown — never fresh — when the run recorded no sha', () => {
    expect(
      deriveRunFreshness(run({ commitSha: null }), pr('abc1234')).state
    ).toBe('unknown')
  })

  it('is unknown when the run names no PR at all', () => {
    expect(deriveRunFreshness(run({ pullRequestId: null }), null).state).toBe(
      'unknown'
    )
  })

  it('compares against the merge commit once the PR is merged', () => {
    expect(
      deriveRunFreshness(
        run({ commitSha: 'merge999' }),
        pr('abc1234', 'merge999', 'merged')
      ).state
    ).toBe('fresh')
  })

  it('matches an abbreviated run sha against a full current sha', () => {
    // LUM-801 走查时抓到的：schema 允许 7–40 位、CLI 的 --commit 接受缩写、
    // 文档示例就写着 `--commit 80b62a3`，但比较是精确相等 —— 于是同一个
    // commit 的 7 位写法被判 stale、40 位写法判 fresh。
    expect(
      deriveRunFreshness(
        run({ commitSha: '80b62a3' }),
        pr('80b62a32645da6374f33f32d56e07d83613ead88')
      ).state
    ).toBe('fresh')
  })

  it('still reports stale when the abbreviation does not match', () => {
    expect(
      deriveRunFreshness(
        run({ commitSha: '80b62a3' }),
        pr('945ae96348360a8b696160d43d4c04246e8ca663')
      ).state
    ).toBe('stale')
  })

  it('matches regardless of which side is abbreviated', () => {
    expect(
      deriveRunFreshness(
        run({ commitSha: '80b62a32645da6374f33f32d56e07d83613ead88' }),
        pr('80b62a3')
      ).state
    ).toBe('fresh')
  })

  it('compares case-insensitively', () => {
    expect(
      deriveRunFreshness(run({ commitSha: '80B62A3' }), pr('80b62a32645da637'))
        .state
    ).toBe('fresh')
  })

  it('a dirty run is never fresh, even when the sha matches', () => {
    expect(
      deriveRunFreshness(run({ commitDirty: true }), pr('abc1234')).state
    ).toBe('dirty')
  })
})

describe('listForTask', () => {
  it('carries every run for each case, not only the latest', async () => {
    repo.listForTask.mockResolvedValue([testCase])
    repo.runsPerCase.mockResolvedValue(
      new Map([['tc-1', [{ id: 'r2' }, { id: 'r1' }]]]) as never
    )

    const { testCases } = await taskTestCaseService.listForTask('t-1')

    expect(testCases[0]!.runs.map(r => r.id)).toEqual(['r2', 'r1'])
  })

  it('gives a case with no runs an empty array', async () => {
    repo.listForTask.mockResolvedValue([testCase])
    repo.runsPerCase.mockResolvedValue(new Map())

    const { testCases } = await taskTestCaseService.listForTask('t-1')

    expect(testCases[0]!.runs).toEqual([])
  })
})

describe('append-only', () => {
  it('exposes no update or delete path for runs', () => {
    const keys = Object.keys(taskTestCaseService)
    expect(keys).not.toContain('updateRun')
    expect(keys).not.toContain('deleteRun')
    expect(keys).not.toContain('removeRun')
  })
})

describe('remove', () => {
  it('soft-deletes rather than hard-deleting', async () => {
    repo.findById.mockResolvedValue(testCase)
    await taskTestCaseService.remove('tc-1', attribution)
    expect(repo.softDelete).toHaveBeenCalledWith('tc-1', expect.anything())
  })

  it('404s an unknown case', async () => {
    repo.findById.mockResolvedValue(null)
    await expect(
      taskTestCaseService.remove('nope', attribution)
    ).rejects.toMatchObject({ status: 404 })
  })
})
