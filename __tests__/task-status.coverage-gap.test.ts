/**
 * LUM-815 · B（覆盖缺口）+ 连线的读出面。
 *
 * 今天每条验收标准旁边都挂着一个绿勾，「有人真验过」与「根本没人碰过」长得
 * 一模一样。这组测试锁的就是把这两者分开之后的两条性质：
 *
 *   1. **缺口只提示，不拦门。** 一条没有用例覆盖的标准不是失败、不是未满足、
 *      更不是 DONE 的阻碍。它只是一个事实。拿它拦门会立刻把这个功能变成新的
 *      摩擦，然后被关掉。
 *   2. **每条标准能看到挂着它的用例和最近一次执行** —— 结果、在哪跑的、跑的
 *      哪版代码。不然连了线也看不见，等于没连。
 */
import { taskVerificationService } from '@/lib/services/task-verification.service'
import { computeDoneVerdict } from '@/lib/acceptance/done-verdict'
import { acceptanceCriterionRepository } from '@/lib/repositories/acceptance-criterion.repository'
import { verificationRunRepository } from '@/lib/repositories/verification-run.repository'
import { activityRepository } from '@/lib/repositories/activity.repository'
import { taskRepository } from '@/lib/repositories/task.repository'
import { testCaseRepository } from '@/lib/repositories/test-case.repository'

jest.mock('@/lib/repositories/acceptance-criterion.repository', () => ({
  acceptanceCriterionRepository: {
    listByTask: jest.fn(),
    listByTaskIncludingDeleted: jest.fn(),
    createMany: jest.fn(),
  },
}))
jest.mock('@/lib/repositories/pull-request.repository', () => ({
  pullRequestRepository: {
    listForLifecycle: jest.fn(() => Promise.resolve([])),
  },
}))
jest.mock('@/lib/repositories/verification-run.repository', () => ({
  ...jest.requireActual('@/lib/repositories/verification-run.repository'),
  verificationRunRepository: {
    listByTask: jest.fn(),
    createMany: jest.fn(),
    maxRoundByTask: jest.fn(),
    latestHumanVerdictAction: jest.fn(() => Promise.resolve(null)),
  },
}))
jest.mock('@/lib/repositories/verification-run-withdrawal.repository', () => ({
  verificationRunWithdrawalRepository: {
    actionIdsByTask: jest.fn(() => Promise.resolve(new Set())),
    latestByTask: jest.fn(() => Promise.resolve(null)),
  },
}))
jest.mock('@/lib/repositories/activity.repository', () => ({
  activityRepository: { create: jest.fn(), listByTaskAndType: jest.fn() },
}))
jest.mock('@/lib/repositories/task.repository', () => ({
  taskRepository: {
    findHeaderById: jest.fn(),
    findStatus: jest.fn(),
    loadClaimSnapshot: jest.fn(() => Promise.resolve(null)),
  },
}))
jest.mock('@/lib/repositories/retrospective.repository', () => ({
  retrospectiveRepository: {
    loadActuals: jest.fn(() => Promise.resolve(null)),
    loadPerSessionCost: jest.fn(() => Promise.resolve([])),
  },
}))
jest.mock('@/lib/repositories/session.repository', () => ({
  sessionRepository: {
    loadLatestRunClaim: jest.fn(() => Promise.resolve(null)),
  },
}))
jest.mock('@/lib/repositories/claim-faithfulness-verdict.repository', () => ({
  claimFaithfulnessVerdictRepository: {
    findByTaskId: jest.fn(() => Promise.resolve(null)),
  },
}))
jest.mock('@/lib/repositories/member.repository', () => ({
  memberRepository: { findActorByMemberId: jest.fn() },
}))
// statusForTask 的模块图经 task.service 拖进 GitHub 集成（ESM-only 依赖，
// jest 里会以 "Cannot use import statement outside a module" 炸掉）——同
// task-status.security-next-actions.test.ts 的做法，在边界处截断。
jest.mock('@/lib/services/task.service', () => ({
  taskService: {
    getTaskDetail: jest.fn(),
    updateTaskWithSideEffects: jest.fn(),
  },
}))
jest.mock('@/lib/notifications/notifyWorkspaceOwners', () => ({
  notifyWorkspaceOwners: jest.fn(),
}))
jest.mock('@/lib/db/prisma', () => ({
  prisma: { $transaction: jest.fn((fn: (tx: unknown) => unknown) => fn({})) },
}))
jest.mock('@/lib/services/pr-security-reminder.service', () => ({
  prSecurityReminderService: {
    loadOpenFindingsForTask: jest.fn(() => Promise.resolve(null)),
  },
}))
// 覆盖读走真实的 service + 纯模块，只把仓库换成假的 —— 要测的正是那段推导。
jest.mock('@/lib/repositories/test-case.repository', () => ({
  testCaseRepository: {
    listForTask: jest.fn(),
    runsPerCase: jest.fn(),
  },
}))

const listCriteria = acceptanceCriterionRepository.listByTask as jest.Mock
const listRuns = verificationRunRepository.listByTask as jest.Mock
const findHeader = taskRepository.findHeaderById as jest.Mock
const listCases = testCaseRepository.listForTask as jest.Mock
const runsPerCase = testCaseRepository.runsPerCase as jest.Mock

const HEADER = {
  id: 't-1',
  number: 815,
  title: 'criterion × test case link',
  status: 'IN_PROGRESS',
  team: { identifier: 'LUM' },
}

function criterion(id: string, statement: string) {
  return {
    id,
    taskId: 't-1',
    statement,
    verifierType: 'MACHINE',
    checkpointer: 'npx jest x.test.ts',
    evidenceRequired: false,
    source: 'AGENT_DRAFT',
    addedAtRound: 0,
    createdAt: new Date('2026-09-22T00:00:00Z'),
    updatedAt: new Date('2026-09-22T00:00:00Z'),
  }
}

function testCase(over: Record<string, unknown>) {
  return {
    id: 'tc-1',
    taskId: 't-1',
    number: 1,
    title: 'case',
    setup: null,
    steps: ['do it'],
    verification: [],
    expected: 'it works',
    requiredEnvironment: null,
    criterionId: null,
    createdAt: new Date('2026-09-22T00:00:00Z'),
    updatedAt: new Date('2026-09-22T00:00:00Z'),
    deletedAt: null,
    ...over,
  }
}

function run(over: Record<string, unknown>) {
  return {
    id: 'r-1',
    testCaseId: 'tc-1',
    taskId: 't-1',
    result: 'PASS',
    environment: 'LOCAL',
    failedPhase: null,
    failedIndex: null,
    failedStepText: null,
    failureAttribution: null,
    unprovenVerification: [],
    evidence: [],
    note: null,
    pullRequestId: null,
    commitSha: null,
    commitDirty: null,
    executedByMemberId: null,
    sourceSessionId: null,
    createdAt: new Date('2026-09-22T01:00:00Z'),
    ...over,
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  findHeader.mockResolvedValue(HEADER)
  listCriteria.mockResolvedValue([])
  listRuns.mockResolvedValue([])
  ;(
    acceptanceCriterionRepository.listByTaskIncludingDeleted as jest.Mock
  ).mockResolvedValue([])
  ;(activityRepository.listByTaskAndType as jest.Mock).mockResolvedValue([])
  listCases.mockResolvedValue([])
  runsPerCase.mockResolvedValue(new Map())
})

describe('statusForTask — 覆盖缺口 (LUM-815)', () => {
  it('coverage gaps are advisory and never block DONE', async () => {
    listCriteria.mockResolvedValue([
      criterion('c-covered', 'this one has a case'),
      criterion('c-bare', 'this one is only words'),
    ])
    listCases.mockResolvedValue([testCase({ criterionId: 'c-covered' })])

    const s = await taskVerificationService.statusForTask('t-1')
    const gaps = s.nextActions.filter(a => a.kind === 'COVERAGE_GAP')

    // 只报**没有**用例的那一条。
    expect(gaps).toHaveLength(1)
    expect(gaps[0]).toMatchObject({
      criterionId: 'c-bare',
      statement: 'this one is only words',
      advisory: true,
    })
    // advisory 的形状红线：连 `blocking` 这个字段都不存在,没有东西可以被
    // 误读成 true。
    expect('blocking' in gaps[0]!).toBe(false)

    // 缺口**不**膨胀未满足的合同项：那只数合同行的裁定,两条标准都还没裁,
    // 所以 CRITERION 行仍然是 2 —— 缺口没有偷偷多算一条。
    expect(s.nextActions.filter(a => a.kind === 'CRITERION')).toHaveLength(2)

    // DONE 闸读的是另外四个 plane，覆盖根本进不去：一个唯一「问题」是某条
    // 标准没有用例的任务，闸门判 CLEAR。
    expect(
      computeDoneVerdict({
        sendBacks: [],
        crossings: { open: [], gateEnabled: true },
        securityFindings: [],
        testCases: [],
      })
    ).toMatchObject({ decision: 'CLEAR', blockers: [] })
  })

  it('reports no gaps at all when the coverage read fails', async () => {
    listCriteria.mockResolvedValue([criterion('c-bare', 'only words')])
    listCases.mockRejectedValue(new Error('db down'))

    const s = await taskVerificationService.statusForTask('t-1')
    // fail-soft **向沉默的方向**：读不出来时兜底成空数组会把每条标准都报成
    // 未覆盖 —— 一屏假警报。宁可一条都不报。
    expect(s.nextActions.filter(a => a.kind === 'COVERAGE_GAP')).toHaveLength(0)
  })

  it('status renders each criterion with its linked cases and their latest run', async () => {
    listCriteria.mockResolvedValue([criterion('c-1', 'covered twice')])
    listCases.mockResolvedValue([
      testCase({
        id: 'tc-2',
        number: 2,
        title: 'never run',
        criterionId: 'c-1',
      }),
      testCase({
        id: 'tc-1',
        number: 1,
        title: 'run twice',
        criterionId: 'c-1',
      }),
    ])
    runsPerCase.mockResolvedValue(
      new Map([
        [
          'tc-1',
          [
            run({
              id: 'r-new',
              result: 'PASS',
              environment: 'PRODUCTION',
              commitSha: 'a3f2c1d',
              commitDirty: false,
              createdAt: new Date('2026-09-22T05:00:00Z'),
            }),
            run({
              id: 'r-old',
              result: 'FAIL',
              createdAt: new Date('2026-09-22T01:00:00Z'),
            }),
          ],
        ],
      ])
    )

    const s = await taskVerificationService.statusForTask('t-1')
    const linked = s.criteria[0]!.linkedCases

    // 按用例序号排，不是按仓库返回顺序。
    expect(linked.map(c => c.number)).toEqual([1, 2])
    // 最近一次执行 = createdAt 最大的那条，不是数组第一条。
    expect(linked[0]).toMatchObject({
      title: 'run twice',
      latestRun: {
        result: 'PASS',
        environment: 'PRODUCTION',
        commitSha: 'a3f2c1d',
        commitDirty: false,
      },
    })
    // 从没跑过 ≠ 失败：latestRun 是 null，由读端自己措辞。
    expect(linked[1]).toMatchObject({ title: 'never run', latestRun: null })

    // 渲染归渲染：跑绿**不**抬升这条标准的裁定。
    expect(s.criteria[0]!.latestVerdict).toBeNull()
  })
})
