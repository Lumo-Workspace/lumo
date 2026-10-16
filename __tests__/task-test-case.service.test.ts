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
import { missingStepRefs } from '@/lib/services/test-case-core'
import { testCaseRepository } from '@/lib/repositories/test-case.repository'
import { memberRepository } from '@/lib/repositories/member.repository'
import type { Prisma } from '@prisma/client'
import { allPass, passUntilFail } from './helpers/step-results'

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
    labelsByIds: jest.fn().mockResolvedValue(new Map()),
  },
}))
// LUM-819 返工：listForTask 把每条 run 的最新抽查复核带上。默认没人抽查过。
jest.mock('@/lib/repositories/test-case-run-review.repository', () => ({
  testCaseRunReviewRepository: { listForTask: jest.fn().mockResolvedValue([]) },
}))
jest.mock('@/lib/db/transaction', () => ({
  runInTransaction: (fn: (tx: unknown) => unknown) => fn({}),
}))

const repo = testCaseRepository as jest.Mocked<typeof testCaseRepository>

const testCase = {
  id: 'tc-1',
  taskId: 't-1',
  milestoneId: null,
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
  // LUM-815: 读模型新增的连线列。null = 没声明覆盖哪条标准（合法常态）。
  criterionId: null,
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
    milestoneId: input.milestoneId ?? null,
    // 写入类型是 InputJsonValue，读出来的行类型是 JsonValue —— 只有这一个字段
    // 需要窄一下，其余原样回抛。
    evidence: input.evidence as Prisma.JsonValue,
    unprovenVerification: input.unprovenVerification as Prisma.JsonValue,
    stepResults: input.stepResults as Prisma.JsonValue,
    id: 'run-1',
    createdAt: new Date('2026-02-01'),
    // LUM-812: runSelect 带出这条 run 的人类裁定；新记的 run 当然还没人裁。
    disposition: null,
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
      {
        result: 'PASS',
        environment: 'PRODUCTION',
        stepResults: allPass(testCase),
      },
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

  it('rejects a FAIL with no locator at all — LUM-1211: a FAIL must name the step it broke at', async () => {
    await expect(
      taskTestCaseService.recordRun(
        testCase,
        // LUM-808: FAIL 现在必须归因；这条测的是定位，用举证责任最轻的 UNKNOWN。
        { result: 'FAIL', environment: 'LOCAL', failureAttribution: 'UNKNOWN' },
        attribution
      )
    ).rejects.toMatchObject({
      status: 400,
      message: expect.stringMatching(/must report the step it broke at/),
    })
    expect(repo.createRun).not.toHaveBeenCalled()
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
        stepResults: passUntilFail(testCase, { phase: 'STEPS', index: 1 }),
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
        stepResults: passUntilFail(testCase, {
          phase: 'VERIFICATION',
          index: 0,
        }),
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
        stepResults: allPass(testCase),
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
      { result: 'PASS', environment: 'LOCAL', stepResults: allPass(testCase) },
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
      { result: 'PASS', environment: 'LOCAL', stepResults: allPass(testCase) },
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
    // nobody spot-checked these runs → an explicit null, never undefined
    expect(testCases[0]!.runs.map(r => r.review)).toEqual([null, null])
  })

  it('gives a case with no runs an empty array', async () => {
    repo.listForTask.mockResolvedValue([testCase])
    repo.runsPerCase.mockResolvedValue(new Map())

    const { testCases } = await taskTestCaseService.listForTask('t-1')

    expect(testCases[0]!.runs).toEqual([])
  })
})

// LUM-1008: 每条 run 带执行人的显示名——一次批量解析，null 成员得 null。
describe('executor', () => {
  const labelsByIds = memberRepository.labelsByIds as jest.Mock
  const knownMembers = new Map([['m-1', 'Ada Lovelace']])
  beforeEach(() => {
    labelsByIds.mockImplementation(
      async (ids: string[]) =>
        new Map(
          ids.flatMap(id =>
            knownMembers.has(id) ? [[id, knownMembers.get(id)!]] : []
          )
        )
    )
  })
  afterEach(() => {
    labelsByIds.mockResolvedValue(new Map())
  })

  it('listForTask resolves every executor in one batch and keeps unrecorded ones null', async () => {
    repo.listForTask.mockResolvedValue([testCase, { ...testCase, id: 'tc-2' }])
    repo.runsPerCase.mockResolvedValue(
      new Map([
        [
          'tc-1',
          [
            { id: 'r2', executedByMemberId: 'm-1', sourceSessionId: 'sess-1' },
            { id: 'r1', executedByMemberId: null, sourceSessionId: null },
          ],
        ],
        [
          'tc-2',
          [{ id: 'r3', executedByMemberId: 'm-1', sourceSessionId: null }],
        ],
      ]) as never
    )

    const { testCases } = await taskTestCaseService.listForTask('t-1')

    // one executor lookup for the whole task (the reviewer lookup is separate)
    const executorCalls = labelsByIds.mock.calls.filter(([ids]) =>
      (ids as string[]).includes('m-1')
    )
    expect(executorCalls).toEqual([[['m-1']]])
    expect(testCases[0]!.runs.map(r => r.executedBy)).toEqual([
      'Ada Lovelace',
      null,
    ])
    expect(testCases[1]!.runs[0]!.executedBy).toBe('Ada Lovelace')
    // the session pointer passes through untouched
    expect(testCases[0]!.runs[0]!.sourceSessionId).toBe('sess-1')
  })

  it('getDetail carries the executor name on each run', async () => {
    repo.findById.mockResolvedValue(testCase)
    repo.listRuns.mockResolvedValue([
      { id: 'r1', executedByMemberId: 'm-1', sourceSessionId: null },
    ] as never)

    const { runs } = await taskTestCaseService.getDetail('tc-1')

    expect(runs[0]!.executedBy).toBe('Ada Lovelace')
  })

  it('falls back to the member id when the member no longer resolves', async () => {
    repo.findById.mockResolvedValue(testCase)
    repo.listRuns.mockResolvedValue([
      { id: 'r1', executedByMemberId: 'm-gone', sourceSessionId: null },
    ] as never)

    const { runs } = await taskTestCaseService.getDetail('tc-1')

    expect(runs[0]!.executedBy).toBe('m-gone')
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

// LUM-1011: 逐步结果与实际观察。testCase 有 2 个步骤 + 1 个复验。
describe('recordRun — step results', () => {
  const fail = (over: Record<string, unknown> = {}) => ({
    result: 'FAIL' as const,
    environment: 'LOCAL' as const,
    failureAttribution: 'UNKNOWN' as const,
    ...over,
  })
  const rec = (body: Record<string, unknown>) =>
    taskTestCaseService.recordRun(testCase, body as never, attribution)

  it('snapshots each reported step and stores actual', async () => {
    await rec(
      fail({
        stepResults: [
          { phase: 'STEPS', index: 0, status: 'PASS', durationMs: 1200 },
          { phase: 'STEPS', index: 1, status: 'FAIL' },
        ],
        actual: 'The footer shows no disclosure',
      })
    )
    expect(repo.createRun).toHaveBeenCalledWith(
      expect.objectContaining({
        stepResults: [
          {
            phase: 'STEPS',
            index: 0,
            text: 'scroll: to the bottom of the page',
            status: 'PASS',
            reason: null,
            durationMs: 1200,
            evidence: [],
          },
          expect.objectContaining({
            index: 1,
            status: 'FAIL',
            durationMs: null,
          }),
        ],
        actual: 'The footer shows no disclosure',
        // The FAIL step fills in the locator when the caller gave none.
        failedPhase: 'STEPS',
        failedIndex: 1,
      }),
      expect.anything()
    )
  })

  it('stores an empty array for a case that has no steps to report', async () => {
    await taskTestCaseService.recordRun(
      { ...testCase, steps: [], verification: [] },
      { result: 'PASS', environment: 'LOCAL' },
      attribution
    )
    expect(repo.createRun).toHaveBeenCalledWith(
      expect.objectContaining({ stepResults: [], actual: null }),
      expect.anything()
    )
  })

  it.each([
    [
      'a BLOCKED run with step results',
      {
        result: 'BLOCKED',
        failureAttribution: null,
        stepResults: [{ phase: 'STEPS', index: 0, status: 'PASS' }],
      },
    ],
    [
      'a PASS run with a failing step',
      {
        result: 'PASS',
        failureAttribution: null,
        stepResults: [{ phase: 'STEPS', index: 0, status: 'FAIL' }],
      },
    ],
    [
      'two failing steps',
      {
        stepResults: [
          { phase: 'STEPS', index: 0, status: 'FAIL' },
          { phase: 'STEPS', index: 1, status: 'FAIL' },
        ],
      },
    ],
    [
      'a step index out of range',
      { stepResults: [{ phase: 'VERIFICATION', index: 1, status: 'PASS' }] },
    ],
    [
      'the same step twice',
      {
        stepResults: [
          { phase: 'STEPS', index: 0, status: 'PASS' },
          { phase: 'STEPS', index: 0, status: 'PASS' },
        ],
      },
    ],
    [
      'a failing step that disagrees with the locator',
      {
        failedPhase: 'STEPS',
        failedIndex: 0,
        stepResults: [{ phase: 'STEPS', index: 1, status: 'FAIL' }],
      },
    ],
    [
      'a PASS step after the run broke',
      {
        failedPhase: 'STEPS',
        failedIndex: 1,
        stepResults: [{ phase: 'VERIFICATION', index: 0, status: 'PASS' }],
      },
    ],
    [
      'step evidence pointing past the evidence array',
      {
        stepResults: [
          { phase: 'STEPS', index: 0, status: 'PASS', evidence: [0] },
        ],
      },
    ],
    [
      'actual on a PASS run',
      { result: 'PASS', failureAttribution: null, actual: 'looked fine' },
    ],
  ])('rejects %s', async (_label, over) => {
    await expect(rec(fail(over))).rejects.toMatchObject({ status: 400 })
    expect(repo.createRun).not.toHaveBeenCalled()
  })

  it('accepts a PASS run that reports every step', async () => {
    await rec({
      result: 'PASS',
      environment: 'LOCAL',
      stepResults: [
        { phase: 'STEPS', index: 0, status: 'PASS' },
        { phase: 'STEPS', index: 1, status: 'PASS' },
        { phase: 'VERIFICATION', index: 0, status: 'PASS' },
      ],
    })
    expect(repo.createRun).toHaveBeenCalledWith(
      expect.objectContaining({ result: 'PASS', failedPhase: null }),
      expect.anything()
    )
  })

  // LUM-1185: 网页记录弹窗的形状——整次文件在前、步骤文件在后，下标指进
  // 合并后的 evidence 数组。与 CLI --step-evidence 同一契约。
  it('stores step evidence the record dialog points at', async () => {
    const file = (name: string) => ({
      type: 'file',
      url: `https://blob.example/${name}`,
      filename: name,
      contentType: 'image/png',
      size: 3,
    })
    await rec({
      result: 'PASS',
      environment: 'LOCAL',
      evidence: [file('whole.png'), file('s2.png')],
      stepResults: [
        { phase: 'STEPS', index: 0, status: 'PASS' },
        { phase: 'STEPS', index: 1, status: 'PASS', evidence: [1] },
        { phase: 'VERIFICATION', index: 0, status: 'PASS' },
      ],
    })
    expect(repo.createRun).toHaveBeenCalledWith(
      expect.objectContaining({
        stepResults: [
          expect.objectContaining({ index: 0, evidence: [] }),
          expect.objectContaining({ index: 1, evidence: [1] }),
          expect.objectContaining({ phase: 'VERIFICATION', evidence: [] }),
        ],
      }),
      expect.anything()
    )
  })
})

describe('LUM-1211 error wording and missingStepRefs', () => {
  const attribution = { memberId: 'm', sourceSessionId: null } as never
  const tc = {
    steps: ['a', 'b'],
    verification: ['x', 'y', 'z'],
  }

  it('names a step reported after the break in 1-based CLI form', async () => {
    await expect(
      taskTestCaseService.recordRun(
        testCase,
        {
          result: 'FAIL',
          environment: 'LOCAL',
          failureAttribution: 'UNKNOWN',
          failedPhase: 'STEPS',
          failedIndex: 1,
          stepResults: [{ phase: 'VERIFICATION', index: 0, status: 'PASS' }],
        } as never,
        attribution
      )
    ).rejects.toThrow(/^v1 is reported PASS after the run broke/)
  })

  it('PASS requires every step and verification', () => {
    expect(missingStepRefs(tc, {}, new Set(), null)).toEqual([
      's1',
      's2',
      'v1',
      'v2',
      'v3',
    ])
  })

  it('counts an unproven verification index as reported', () => {
    expect(
      missingStepRefs(
        tc,
        { unprovenVerification: [1] },
        new Set(['STEPS:0', 'STEPS:1', 'VERIFICATION:0']),
        null
      )
    ).toEqual(['v3'])
  })

  it('FAIL inside verification needs everything before the break only', () => {
    // v2 (position 2 + 1 = 3) is the break; v3 is not required.
    expect(missingStepRefs(tc, {}, new Set(['STEPS:0']), 3)).toEqual([
      's2',
      'v1',
    ])
    expect(
      missingStepRefs(
        tc,
        { unprovenVerification: [0] },
        new Set(['STEPS:0', 'STEPS:1']),
        3
      )
    ).toEqual([])
  })

  it('FAIL at the first step requires nothing before it', () => {
    expect(missingStepRefs(tc, {}, new Set(), 0)).toEqual([])
  })
})

// LUM-1185: 读端随每条 run 回传推导判定（封顶 + 逐步报告），列表再带 Record
// 行同源的汇总；CLI 只渲染，不复刻规则。
describe('read-side verdict (LUM-1185)', () => {
  const storedRun = (over: Record<string, unknown>) => ({
    id: 'r1',
    testCaseId: 'tc-1',
    result: 'PASS',
    environment: 'LOCAL',
    failedPhase: null,
    failedIndex: null,
    failedStepText: null,
    failureAttribution: null,
    unprovenVerification: [],
    evidence: [],
    stepResults: [],
    executedByMemberId: null,
    sourceSessionId: null,
    disposition: null,
    ...over,
  })
  const reviewRepo = jest.requireMock(
    '@/lib/repositories/test-case-run-review.repository'
  ).testCaseRunReviewRepository.listForTask as jest.Mock
  afterEach(() => reviewRepo.mockResolvedValue([]))

  it('listForTask caps a zero-evidence PASS to UNPROVEN and reports N/M passing', async () => {
    const proven = { ...testCase, id: 'tc-2', number: 4 }
    repo.listForTask.mockResolvedValue([testCase, proven])
    repo.runsPerCase.mockResolvedValue(
      new Map([
        ['tc-1', [storedRun({ id: 'r1' })]],
        [
          'tc-2',
          [
            storedRun({
              id: 'r2',
              testCaseId: 'tc-2',
              evidence: [{ kind: 'url', url: 'https://example.com/log' }],
              stepResults: allPass(testCase).map(s => ({
                ...s,
                text: 'x',
                reason: null,
                durationMs: 1200,
                evidence: [],
              })),
            }),
          ],
        ],
      ]) as never
    )

    const res = await taskTestCaseService.listForTask('t-1')

    expect(res.testCases[0]!.runs[0]!.ceiling).toEqual({
      effective: 'UNPROVEN',
      reason: 'no-evidence',
    })
    expect(res.testCases[1]!.runs[0]!.ceiling).toEqual({ effective: 'PASS' })
    expect(res.testCases[1]!.runs[0]!.stepReport).toMatchObject({
      passed: 3,
      total: 3,
      hasStepResults: true,
    })
    expect(res.summary).toMatchObject({
      total: 2,
      passing: 1,
      inconclusive: 1,
      blocking: [],
    })
  })

  it('listForTask counts an unruled defect as blocking DONE', async () => {
    repo.listForTask.mockResolvedValue([testCase])
    repo.runsPerCase.mockResolvedValue(
      new Map([
        [
          'tc-1',
          [
            storedRun({
              result: 'FAIL',
              failureAttribution: 'IMPLEMENTATION_DEFECT',
              failedPhase: 'STEPS',
              failedIndex: 1,
            }),
          ],
        ],
      ]) as never
    )

    const res = await taskTestCaseService.listForTask('t-1')

    expect(res.summary.failing).toBe(1)
    expect(res.summary.blocking).toEqual([
      { caseNumber: 3, title: testCase.title, runId: 'r1' },
    ])
    // the step report knows where it broke and what was never reached
    expect(
      res.testCases[0]!.runs[0]!.stepReport.rows.map(r => r.state)
    ).toEqual(['reached', 'failed', 'notReached'])
  })

  it('getDetail carries the ceiling, step report and spot-check review', async () => {
    repo.findById.mockResolvedValue({
      ...testCase,
      requiredEnvironment: 'PRODUCTION',
    })
    repo.listRuns.mockResolvedValue([
      storedRun({ evidence: [{ kind: 'url', url: 'https://example.com/a' }] }),
    ] as never)
    reviewRepo.mockResolvedValue([
      {
        testCaseRunId: 'r1',
        accepted: false,
        note: 'screenshot is of the wrong page',
        reviewedByMemberId: 'm-9',
        createdAt: new Date('2026-10-07T00:00:00Z'),
      },
    ])

    const { runs } = await taskTestCaseService.getDetail('tc-1')

    expect(runs[0]!.ceiling).toEqual({
      effective: 'UNPROVEN',
      reason: 'environment',
      requiredEnvironment: 'PRODUCTION',
      ranIn: 'LOCAL',
    })
    expect(runs[0]!.stepReport.rows.map(r => r.state)).toEqual([
      'unrecorded',
      'unrecorded',
      'unrecorded',
    ])
    expect(runs[0]!.review).toEqual({
      accepted: false,
      note: 'screenshot is of the wrong page',
      reviewer: 'm-9',
      reviewedAt: '2026-10-07T00:00:00.000Z',
    })
  })
})
