/**
 * @jest-environment node
 *
 * LUM-812 — test case 侧的三步握手。
 *
 * 要证的是**顺序由服务端强制**，不是 CLI 自觉：exit-4 信封协议本身只是个约定，
 * 没有东西拦着一个调用方直接跑 --confirm。回执把这层约定变成算得出来的东西。
 *
 * 握手实现与越界共用 lib/disposition/read-receipt.ts —— 这里不重测签名学，
 * 只测「接到 test case 这条路上之后，顺序仍然成立」，外加一条越界侧没有的：
 * 中途 append 一条新 run 必须让未确认的回执失效。
 */
import { testCaseDefectDispositionService } from '@/lib/services/test-case-defect-disposition.service'
import { testCaseRepository } from '@/lib/repositories/test-case.repository'

jest.mock('@/lib/repositories/test-case.repository', () => ({
  testCaseRepository: {
    findRunForDisposition: jest.fn(),
    createDisposition: jest.fn(),
  },
}))
jest.mock('@/lib/repositories/activity.repository', () => ({
  activityRepository: { create: jest.fn() },
}))

const findRun = testCaseRepository.findRunForDisposition as jest.Mock
const createDisposition = testCaseRepository.createDisposition as jest.Mock

const CALLER = { sessionId: 'sess-1', memberId: 'm-1' }
const OTHER = { sessionId: 'sess-2', memberId: 'm-2' }

const runRow = (over: Record<string, unknown> = {}) => ({
  id: 'run-9',
  taskId: 't-1',
  testCaseId: 'tc-1',
  result: 'FAIL',
  failureAttribution: 'IMPLEMENTATION_DEFECT',
  evidence: [{ type: 'link', url: 'https://example.test/log' }],
  createdAt: new Date('2026-09-22T10:00:00.000Z'),
  disposition: null,
  testCase: { id: 'tc-1', number: 9, title: 'Footer', deletedAt: null },
  isLatestForCase: true,
  ...over,
})

const rule = (receipt: string, caller = CALLER) =>
  testCaseDefectDispositionService.rule({
    taskId: 't-1',
    runId: 'run-9',
    ruling: 'KNOWN_DEFECT',
    caller,
    channel: 'CLI',
    receipt,
  })

beforeEach(() => {
  jest.clearAllMocks()
  process.env.LUMO_RECEIPT_SECRET = 'test-secret'
  findRun.mockResolvedValue(runRow())
  createDisposition.mockImplementation(async (input: unknown) => input)
})

async function stage1() {
  return (
    await testCaseDefectDispositionService.issueReadReceipt(
      't-1',
      'run-9',
      'KNOWN_DEFECT',
      CALLER
    )
  ).receipt
}

describe('LUM-812 — the server enforces the handshake order', () => {
  it('a stage-1 receipt cannot confirm the ruling', async () => {
    const r1 = await stage1()

    // 读过，但没确认读过 —— 直接去写就是 409，且什么都没落库。
    await expect(rule(r1)).rejects.toMatchObject({ status: 409 })
    await expect(rule(r1)).rejects.toThrow(/read not yet acknowledged/)
    expect(createDisposition).not.toHaveBeenCalled()

    // 补上第二步之后，同一条路就通了。
    const r2 = (
      await testCaseDefectDispositionService.acknowledgeReadReceipt(
        't-1',
        'run-9',
        'KNOWN_DEFECT',
        r1,
        CALLER
      )
    ).receipt
    await expect(rule(r2)).resolves.toMatchObject({ channel: 'CLI' })
  })

  it('a receipt issued for one caller is refused for another', async () => {
    const r1 = await stage1()
    await expect(
      testCaseDefectDispositionService.acknowledgeReadReceipt(
        't-1',
        'run-9',
        'KNOWN_DEFECT',
        r1,
        OTHER
      )
    ).rejects.toMatchObject({ status: 409 })
  })

  it('a receipt issued for one ruling cannot be spent on the other', async () => {
    const r1 = await stage1()
    await expect(
      testCaseDefectDispositionService.acknowledgeReadReceipt(
        't-1',
        'run-9',
        'NOT_A_DEFECT',
        r1,
        CALLER
      )
    ).rejects.toMatchObject({ status: 409 })
  })

  /**
   * 下面两条都是 409，但**拦它们的不是同一道闸**，所以各自断言自己的文案——
   * 只断言 status 的话，两条测试都会因为另一道闸而「通过」，看不出回执有没有
   * 在干活。
   */
  it('appending a newer run is refused before the receipt is even examined', async () => {
    const r1 = await stage1()
    const r2 = (
      await testCaseDefectDispositionService.acknowledgeReadReceipt(
        't-1',
        'run-9',
        'KNOWN_DEFECT',
        r1,
        CALLER
      )
    ).receipt

    // run-9 不再是最新的 → loadRuleableRun 先抛，回执这一步根本没走到。
    findRun.mockResolvedValue(runRow({ isLatestForCase: false }))
    await expect(rule(r2)).rejects.toThrow(/no longer the latest/)
    expect(createDisposition).not.toHaveBeenCalled()
  })

  it('a ruling recorded between read and acknowledge voids the receipt', async () => {
    const r1 = await stage1()

    // 有人在 web 面板上先裁了。run 仍是最新、仍是 proven defect，所以
    // loadRuleableRun 放行 —— 这一刻**只有回执**知道状态变了。
    findRun.mockResolvedValue(
      runRow({ disposition: { id: 'd-1', disposition: 'KNOWN_DEFECT' } })
    )
    await expect(
      testCaseDefectDispositionService.acknowledgeReadReceipt(
        't-1',
        'run-9',
        'KNOWN_DEFECT',
        r1,
        CALLER
      )
    ).rejects.toThrow(/does not match this test case run/)
  })

  it('a garbled receipt is refused and writes nothing', async () => {
    await expect(rule('r2.not-a-real-receipt')).rejects.toMatchObject({
      status: 409,
    })
    expect(createDisposition).not.toHaveBeenCalled()
  })
})
