/**
 * @jest-environment node
 *
 * LUM-812 — 对一条「证明了坏」的 run 下裁定。
 *
 * 两条不变量在这里钉死：
 *   1. 裁定**绑定在那一条 run 上**。之后 append 一条新的 defect run，闸门重新拦。
 *      写成「这个用例被处置过吗」的话，一次裁定就永久放行了。
 *   2. 服务端**按身份谁都不拒**。LUM-750 的 agent 守卫已在 PR 1006 撤回——用户的
 *      实际工作流就是让 agent 代跑握手。保护来自握手顺序 + channel 留痕。
 */
import { testCaseDefectDispositionService } from '@/lib/services/test-case-defect-disposition.service'
import { collectDoneVerdictSnapshot } from '@/lib/services/done-verdict.service'
import { computeDoneVerdict } from '@/lib/acceptance/done-verdict'
import { testCaseRepository } from '@/lib/repositories/test-case.repository'

jest.mock('@/lib/repositories/test-case.repository', () => ({
  testCaseRepository: {
    findRunForDisposition: jest.fn(),
    createDisposition: jest.fn(),
    listForTask: jest.fn(),
    runsPerCase: jest.fn(),
  },
}))
jest.mock('@/lib/repositories/member.repository', () => ({
  memberRepository: {
    findActorByMemberId: jest.fn(async (memberId: string) => ({
      id: `actor-of-${memberId}`,
    })),
  },
}))
jest.mock('@/lib/repositories/boundary-crossing.repository', () => ({
  boundaryCrossingRepository: {
    findUndispositionedByTask: jest.fn(() => Promise.resolve([])),
    isGateEnabledForWorkspace: jest.fn(() => Promise.resolve(true)),
  },
}))
const mockAudit = jest.fn()
jest.mock('@/lib/services/audit.service', () => ({
  recordAuditEvent: (...a: unknown[]) => mockAudit(...a),
}))
jest.mock('@/lib/services/pr-security-scan-gate', () => ({
  listOpenBlockingFindings: jest.fn(() => Promise.resolve([])),
}))

const findRun = testCaseRepository.findRunForDisposition as jest.Mock
const createDisposition = testCaseRepository.createDisposition as jest.Mock
const listForTask = testCaseRepository.listForTask as jest.Mock
const runsPerCase = testCaseRepository.runsPerCase as jest.Mock

const CALLER = { sessionId: 'sess-1', memberId: 'm-1' }

const runRow = (over: Record<string, unknown> = {}) => ({
  id: 'run-9',
  taskId: 't-1',
  testCaseId: 'tc-1',
  result: 'FAIL',
  failureAttribution: 'IMPLEMENTATION_DEFECT',
  evidence: [{ type: 'link', url: 'https://example.test/log' }],
  createdAt: new Date('2026-09-22T10:00:00.000Z'),
  disposition: null,
  testCase: {
    id: 'tc-1',
    number: 9,
    title: 'Footer keeps the nav row',
    deletedAt: null,
  },
  isLatestForCase: true,
  ...over,
})

/** 闸门那一侧的装配：一条用例 + 它的 run 列表（最新在前）。 */
function gateSees(runs: Array<Record<string, unknown>>) {
  listForTask.mockResolvedValue([
    {
      id: 'tc-1',
      number: 9,
      title: 'Footer keeps the nav row',
      requiredEnvironment: null,
    },
  ])
  runsPerCase.mockResolvedValue(new Map([['tc-1', runs]]))
}

const defectRun = (id: string, disposition: unknown = null) => ({
  id,
  result: 'FAIL',
  environment: 'LOCAL',
  failureAttribution: 'IMPLEMENTATION_DEFECT',
  unprovenVerification: [],
  disposition,
})

async function gateDecision() {
  return computeDoneVerdict(await collectDoneVerdictSnapshot('t-1', 'w-1'))
}

beforeEach(() => {
  jest.clearAllMocks()
  process.env.LUMO_RECEIPT_SECRET = 'test-secret'
  createDisposition.mockImplementation(async (input: unknown) => input)
})

describe('LUM-812 — the ruling is scoped to one run', () => {
  it('a defect disposition is scoped to its run so a later defect run blocks again', async () => {
    // 未裁定 → 拦
    gateSees([defectRun('run-9')])
    expect((await gateDecision()).decision).toBe('BLOCKED')

    // 裁定那一条 → 放行
    gateSees([defectRun('run-9', { id: 'd-1', disposition: 'KNOWN_DEFECT' })])
    expect((await gateDecision()).decision).toBe('CLEAR')

    // 之后又记了一条新的 defect run（append-only，最新在前）→ 重新拦。
    // 旧裁定还在库里，但它绑的是 run-9，遮不住 run-10。
    gateSees([
      defectRun('run-10'),
      defectRun('run-9', { id: 'd-1', disposition: 'KNOWN_DEFECT' }),
    ])
    const after = await gateDecision()
    expect(after.decision).toBe('BLOCKED')
    expect(after.blockers).toEqual([
      {
        plane: 'TEST_CASE_DEFECT',
        items: [
          { number: 9, title: 'Footer keeps the nav row', runId: 'run-10' },
        ],
      },
    ])
  })

  it('refuses to rule on a run that is no longer the latest — it would clear nothing', async () => {
    findRun.mockResolvedValue(runRow({ isLatestForCase: false }))
    await expect(
      testCaseDefectDispositionService.rule({
        taskId: 't-1',
        runId: 'run-9',
        ruling: 'KNOWN_DEFECT',
        caller: CALLER,
        channel: 'WEB',
      })
    ).rejects.toMatchObject({ status: 409 })
    expect(createDisposition).not.toHaveBeenCalled()
  })

  it('refuses to rule on anything that was never a proven defect', async () => {
    findRun.mockResolvedValue(runRow({ failureAttribution: 'CASE_OUTDATED' }))
    await expect(
      testCaseDefectDispositionService.rule({
        taskId: 't-1',
        runId: 'run-9',
        ruling: 'NOT_A_DEFECT',
        caller: CALLER,
        channel: 'WEB',
      })
    ).rejects.toMatchObject({ status: 409 })
  })
})

describe('LUM-812 — provenance, not identity', () => {
  it('the ruling records which channel it came through and refuses no caller by identity', async () => {
    findRun.mockResolvedValue(runRow())

    // WEB：面板上是本人在点，没有回执。
    const web = await testCaseDefectDispositionService.rule({
      taskId: 't-1',
      runId: 'run-9',
      ruling: 'KNOWN_DEFECT',
      note: 'shipping with it',
      caller: CALLER,
      channel: 'WEB',
    })
    expect(web).toMatchObject({ channel: 'WEB', disposition: 'KNOWN_DEFECT' })

    // CLI：同一个调用方、同一个 session —— 服务端**不因为它可能是 agent 而拒绝**。
    // 它要的是走完握手的 stage-2 回执，要的是「顺序对不对」，不是「你是谁」。
    // （LUM-750 的身份守卫已于 PR 1006 撤回，别再加回来。）
    findRun.mockResolvedValue(runRow())
    const r1 = await testCaseDefectDispositionService.issueReadReceipt(
      't-1',
      'run-9',
      'KNOWN_DEFECT',
      CALLER
    )
    const r2 = await testCaseDefectDispositionService.acknowledgeReadReceipt(
      't-1',
      'run-9',
      'KNOWN_DEFECT',
      r1.receipt,
      CALLER
    )
    const cli = await testCaseDefectDispositionService.rule({
      taskId: 't-1',
      runId: 'run-9',
      ruling: 'KNOWN_DEFECT',
      caller: CALLER,
      channel: 'CLI',
      receipt: r2.receipt,
    })
    expect(cli).toMatchObject({ channel: 'CLI' })
  })

  it('the activity event is attributed to the caller’s Actor, not their member id', async () => {
    // TaskActivity.actorId → Actor.id。LUM-812/TC1 生产实测：传 memberId 撞
    // task_activities_actorId_fkey，调用方拿 500，时间线缺这次裁定。
    findRun.mockResolvedValue(runRow())
    await testCaseDefectDispositionService.rule({
      taskId: 't-1',
      runId: 'run-9',
      ruling: 'KNOWN_DEFECT',
      note: '  shipping with it  ',
      caller: CALLER,
      channel: 'WEB',
    })
    expect(createDisposition).toHaveBeenCalledTimes(1)
    const [row, activity] = createDisposition.mock.calls[0]
    expect(row).toMatchObject({
      dispositionedById: 'm-1',
      note: 'shipping with it',
    })
    expect(activity.actorId).toBe('actor-of-m-1')
    expect(activity.actorId).not.toBe(CALLER.memberId)
    expect(activity.payload).toMatchObject({
      runId: 'run-9',
      caseNumber: 9,
      disposition: 'KNOWN_DEFECT',
      note: 'shipping with it',
      channel: 'WEB',
    })
  })

  it('a CLI ruling with no receipt at all is refused', async () => {
    findRun.mockResolvedValue(runRow())
    await expect(
      testCaseDefectDispositionService.rule({
        taskId: 't-1',
        runId: 'run-9',
        ruling: 'KNOWN_DEFECT',
        caller: CALLER,
        channel: 'CLI',
      })
    ).rejects.toMatchObject({ status: 400 })
    expect(createDisposition).not.toHaveBeenCalled()
  })
})

describe('LUM-907 test-case defect rulings are audited', () => {
  const audit = {
    workspaceId: 'w-1',
    context: {
      actor: { type: 'MEMBER' as const, memberId: 'm-1' },
      source: 'WEB' as const,
    },
  }

  it('test case defect audit: a web ruling records run, case number and ruling, not the note or title', async () => {
    findRun.mockResolvedValue(runRow())
    await testCaseDefectDispositionService.rule({
      taskId: 't-1',
      runId: 'run-9',
      ruling: 'KNOWN_DEFECT',
      note: 'secret-note',
      caller: CALLER,
      channel: 'WEB',
      audit,
    })
    expect(mockAudit).toHaveBeenCalledWith({
      workspaceId: 'w-1',
      action: 'test_case_defect.dispositioned',
      target: { type: 'test_case_run', id: 'run-9' },
      metadata: {
        taskId: 't-1',
        caseNumber: 9,
        disposition: 'KNOWN_DEFECT',
        channel: 'WEB',
      },
      context: audit.context,
    })
    const recorded = JSON.stringify(mockAudit.mock.calls)
    expect(recorded).not.toContain('secret-note')
    expect(recorded).not.toContain('Footer keeps')
  })

  it('test case defect audit: a refused ruling (already dispositioned) records nothing', async () => {
    findRun.mockResolvedValue(runRow({ disposition: { id: 'd-1' } }))
    await expect(
      testCaseDefectDispositionService.rule({
        taskId: 't-1',
        runId: 'run-9',
        ruling: 'KNOWN_DEFECT',
        caller: CALLER,
        channel: 'WEB',
        audit,
      })
    ).rejects.toMatchObject({ status: 409 })
    expect(mockAudit).not.toHaveBeenCalled()
  })
})
