/**
 * LUM-801: test case repository —— 哑写层。
 *
 * 这里不测业务规则（那些在 service），只测 Prisma 调用的形状：编号分配的
 * max+1 与 P2002 重试、软删而非硬删、列表过滤墓碑、run 按时间倒序。
 */
import { testCaseRepository } from '@/lib/repositories/test-case.repository'

const mockCreate = jest.fn()
const mockFindMany = jest.fn()
const mockFindFirst = jest.fn()
const mockUpdate = jest.fn()
const mockAggregate = jest.fn()
const mockRunCreate = jest.fn()
const mockRunFindMany = jest.fn()
const mockPrFindMany = jest.fn()
const mockTransaction = jest.fn()

jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    testCase: {
      create: (...a: unknown[]) => mockCreate(...a),
      findMany: (...a: unknown[]) => mockFindMany(...a),
      findFirst: (...a: unknown[]) => mockFindFirst(...a),
      update: (...a: unknown[]) => mockUpdate(...a),
      aggregate: (...a: unknown[]) => mockAggregate(...a),
    },
    testCaseRun: {
      create: (...a: unknown[]) => mockRunCreate(...a),
      findMany: (...a: unknown[]) => mockRunFindMany(...a),
    },
    pullRequest: { findMany: (...a: unknown[]) => mockPrFindMany(...a) },
    $transaction: (fn: (tx: unknown) => unknown) => mockTransaction(fn),
  },
}))

const row = (over: Record<string, unknown> = {}) => ({
  id: 'tc-1',
  taskId: 't-1',
  number: 1,
  title: 'case',
  setup: null,
  steps: ['a'],
  verification: [],
  expected: 'ok',
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
  deletedAt: null,
  ...over,
})

const input = {
  taskId: 't-1',
  title: 'case',
  setup: null,
  steps: ['a'],
  verification: [],
  expected: 'ok',
}

beforeEach(() => {
  jest.clearAllMocks()
  mockPrFindMany.mockResolvedValue([])
})

describe('createWithNumber', () => {
  it('allocates max+1 for the task', async () => {
    mockAggregate.mockResolvedValue({ _max: { number: 4 } })
    mockCreate.mockResolvedValue(row({ number: 5 }))

    await testCaseRepository.createWithNumber(input)

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ taskId: 't-1', number: 5 }),
      })
    )
  })

  it('starts at 1 when the task has no cases yet', async () => {
    mockAggregate.mockResolvedValue({ _max: { number: null } })
    mockCreate.mockResolvedValue(row({ number: 1 }))

    await testCaseRepository.createWithNumber(input)

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ number: 1 }) })
    )
  })

  it('retries on a P2002 unique collision and succeeds', async () => {
    mockAggregate
      .mockResolvedValueOnce({ _max: { number: 4 } })
      .mockResolvedValueOnce({ _max: { number: 5 } })
    const collision = Object.assign(new Error('unique'), { code: 'P2002' })
    mockCreate
      .mockRejectedValueOnce(collision)
      .mockResolvedValueOnce(row({ number: 6 }))

    const created = await testCaseRepository.createWithNumber(input)

    expect(created.number).toBe(6)
    expect(mockCreate).toHaveBeenCalledTimes(2)
  })

  it('gives up after the retry budget and rethrows', async () => {
    mockAggregate.mockResolvedValue({ _max: { number: 1 } })
    const collision = Object.assign(new Error('unique'), { code: 'P2002' })
    mockCreate.mockRejectedValue(collision)

    await expect(
      testCaseRepository.createWithNumber(input)
    ).rejects.toMatchObject({ code: 'P2002' })
  })

  it('rethrows a non-collision error immediately without retrying', async () => {
    mockAggregate.mockResolvedValue({ _max: { number: 1 } })
    mockCreate.mockRejectedValue(
      Object.assign(new Error('boom'), { code: 'P2003' })
    )

    await expect(
      testCaseRepository.createWithNumber(input)
    ).rejects.toMatchObject({ code: 'P2003' })
    expect(mockCreate).toHaveBeenCalledTimes(1)
  })
})

describe('listForTask', () => {
  it('filters soft-deleted rows and orders by number', async () => {
    mockFindMany.mockResolvedValue([row()])
    await testCaseRepository.listForTask('t-1')
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { taskId: 't-1', deletedAt: null },
        orderBy: { number: 'asc' },
      })
    )
  })
})

describe('softDelete', () => {
  it('stamps deletedAt instead of deleting the row', async () => {
    mockUpdate.mockResolvedValue(row({ deletedAt: new Date() }))
    await testCaseRepository.softDelete('tc-1')
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'tc-1' },
        data: expect.objectContaining({ deletedAt: expect.any(Date) }),
      })
    )
  })
})

describe('listRuns', () => {
  it('returns newest first', async () => {
    mockRunFindMany.mockResolvedValue([])
    await testCaseRepository.listRuns('tc-1')
    expect(mockRunFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { testCaseId: 'tc-1' },
        orderBy: { createdAt: 'desc' },
      })
    )
  })
})

describe('runsPerCase', () => {
  // LUM-801 走查时 TC1 就挂在这儿：早先的版本一次取出全部 run，却只留下每组
  // 第一条，于是卡片上标着「Run history」的区域永远只有最近一次。丢弃并不
  // 省查询，所以必须返回全量。
  it('returns every run per case, newest first — not just the latest', async () => {
    mockRunFindMany.mockResolvedValue([
      { id: 'r3', testCaseId: 'tc-1', createdAt: new Date('2026-03-01') },
      { id: 'r2', testCaseId: 'tc-1', createdAt: new Date('2026-02-01') },
      { id: 'r1', testCaseId: 'tc-2', createdAt: new Date('2026-01-01') },
    ])

    const grouped = await testCaseRepository.runsPerCase('t-1')

    expect(grouped.get('tc-1')?.map(r => r.id)).toEqual(['r3', 'r2'])
    expect(grouped.get('tc-2')?.map(r => r.id)).toEqual(['r1'])
  })

  it('returns an empty map entry-free result for a task with no runs', async () => {
    mockRunFindMany.mockResolvedValue([])
    expect((await testCaseRepository.runsPerCase('t-1')).size).toBe(0)
  })
})

describe('listTaskPullRequests', () => {
  it('selects the head and merge shas freshness derivation needs', async () => {
    mockPrFindMany.mockResolvedValue([])
    await testCaseRepository.listTaskPullRequests('t-1')
    const arg = mockPrFindMany.mock.calls[0]![0] as {
      where: unknown
      select: Record<string, boolean>
    }
    expect(arg.where).toEqual({ taskId: 't-1' })
    expect(arg.select.headSha).toBe(true)
    expect(arg.select.mergeCommitSha).toBe(true)
    expect(arg.select.state).toBe(true)
  })
})

describe('createDisposition (LUM-812)', () => {
  const dispositionInput = {
    runId: 'run-9',
    taskId: 't-1',
    disposition: 'KNOWN_DEFECT' as const,
    note: null,
    dispositionedById: 'm-1',
    channel: 'CLI' as const,
  }
  const activity = { actorId: 'actor-1', payload: { runId: 'run-9' } }

  /** 最小的事务替身：回调失败则整体失败，且什么都不「提交」到 committed。 */
  function fakeTransaction(activityCreate: jest.Mock) {
    const committed: string[] = []
    mockTransaction.mockImplementation(async fn => {
      const staged: string[] = []
      const tx = {
        testCaseRunDisposition: {
          create: jest.fn(async ({ data }) => {
            staged.push('disposition')
            return { id: 'd-1', ...data }
          }),
        },
        taskActivity: { create: activityCreate },
      }
      const out = await fn(tx)
      committed.push(...staged)
      return out
    })
    return committed
  }

  it('writes the ruling row and its activity event in one transaction', async () => {
    const activityCreate = jest.fn(async () => ({ id: 'a-1' }))
    const committed = fakeTransaction(activityCreate)

    const row = await testCaseRepository.createDisposition(
      dispositionInput,
      activity
    )

    expect(row).toMatchObject({ id: 'd-1', runId: 'run-9' })
    expect(activityCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        taskId: 't-1',
        actorId: 'actor-1',
        type: 'TEST_CASE_DEFECT_DISPOSITIONED',
      }),
    })
    expect(committed).toEqual(['disposition'])
  })

  it('a failed activity write leaves no ruling behind — the gate stays shut', async () => {
    const fkError = Object.assign(
      new Error('Foreign key constraint violated'),
      {
        code: 'P2003',
      }
    )
    const committed = fakeTransaction(jest.fn().mockRejectedValue(fkError))

    await expect(
      testCaseRepository.createDisposition(dispositionInput, activity)
    ).rejects.toBe(fkError)
    expect(committed).toEqual([])
  })
})

describe('LUM-1135 milestone owner', () => {
  it('allocates numbers within the milestone', async () => {
    mockAggregate.mockResolvedValueOnce({ _max: { number: 2 } })
    mockCreate.mockResolvedValueOnce({ id: 'tc-m', number: 3 })
    await testCaseRepository.createWithNumber({
      milestoneId: 'm-1',
      title: 't',
      setup: null,
      steps: ['s'],
      verification: [],
      expected: 'e',
    })
    expect(mockAggregate).toHaveBeenCalledWith({
      where: { milestoneId: 'm-1' },
      _max: { number: true },
    })
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ milestoneId: 'm-1', number: 3 }),
      })
    )
  })

  it('lists only live milestone cases', async () => {
    mockFindMany.mockResolvedValueOnce([])
    await testCaseRepository.listForMilestone('m-1')
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { milestoneId: 'm-1', deletedAt: null },
        orderBy: { number: 'asc' },
      })
    )
  })

  it('finds a live milestone case by number', async () => {
    mockFindFirst.mockResolvedValueOnce(null)
    await testCaseRepository.findByMilestoneAndNumber('m-1', 2)
    expect(mockFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { milestoneId: 'm-1', number: 2, deletedAt: null },
      })
    )
  })

  it('groups milestone runs by case, newest first', async () => {
    mockRunFindMany.mockResolvedValueOnce([
      { id: 'r2', testCaseId: 'a' },
      { id: 'r1', testCaseId: 'a' },
      { id: 'r3', testCaseId: 'b' },
    ])
    const grouped = await testCaseRepository.runsPerCaseForMilestone('m-1')
    expect(mockRunFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { milestoneId: 'm-1' },
        orderBy: { createdAt: 'desc' },
      })
    )
    expect(grouped.get('a')!.map(r => r.id)).toEqual(['r2', 'r1'])
  })

  it('writes a milestone disposition without a task activity row', async () => {
    const activityCreate = jest.fn()
    const dispositionCreate = jest.fn(async ({ data }) => ({
      id: 'd-m',
      ...data,
    }))
    mockTransaction.mockImplementation(async fn =>
      fn({
        testCaseRunDisposition: { create: dispositionCreate },
        taskActivity: { create: activityCreate },
      })
    )
    await testCaseRepository.createDisposition(
      {
        runId: 'r1',
        taskId: null,
        milestoneId: 'm-1',
        disposition: 'KNOWN_DEFECT',
        note: null,
        dispositionedById: 'mem',
        channel: 'WEB',
      },
      null
    )
    expect(dispositionCreate).toHaveBeenCalledTimes(1)
    expect(activityCreate).not.toHaveBeenCalled()
  })
})
