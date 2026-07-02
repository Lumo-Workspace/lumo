import { taskComplexityRepository } from '@/lib/repositories/task-complexity.repository'

const mockUpsert = jest.fn()
const mockFindUnique = jest.fn()
const mockFindMany = jest.fn()

jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    taskComplexity: {
      upsert: (...a: any[]) => mockUpsert(...a),
      findUnique: (...a: any[]) => mockFindUnique(...a),
      findMany: (...a: any[]) => mockFindMany(...a),
    },
  },
}))

beforeEach(() => jest.clearAllMocks())

describe('taskComplexityRepository', () => {
  it('upsert 按 taskId,update 路径刷新 computedAt', async () => {
    mockUpsert.mockResolvedValueOnce({ id: 'c1' })
    await taskComplexityRepository.upsert({
      taskId: 't1',
      teamId: 'team1',
      totalDurationMs: 100,
      changedFileCount: 3,
      agentRunCount: 2,
    })
    expect(mockUpsert).toHaveBeenCalledWith({
      where: { taskId: 't1' },
      create: {
        taskId: 't1',
        teamId: 'team1',
        totalDurationMs: 100,
        changedFileCount: 3,
        agentRunCount: 2,
      },
      update: {
        teamId: 'team1',
        totalDurationMs: 100,
        changedFileCount: 3,
        agentRunCount: 2,
        computedAt: expect.any(Date),
      },
    })
  })

  it('findByTaskId 按 taskId 查唯一行', async () => {
    mockFindUnique.mockResolvedValueOnce(null)
    await taskComplexityRepository.findByTaskId('t1')
    expect(mockFindUnique).toHaveBeenCalledWith({ where: { taskId: 't1' } })
  })

  it('listByTaskIds 批量取改动面投影,空集短路不打库', async () => {
    mockFindMany.mockResolvedValueOnce([{ taskId: 't1', changedFileCount: 5 }])
    const rows = await taskComplexityRepository.listByTaskIds(['t1', 't2'])
    expect(mockFindMany).toHaveBeenCalledWith({
      where: { taskId: { in: ['t1', 't2'] } },
      select: { taskId: true, changedFileCount: true },
    })
    expect(rows).toEqual([{ taskId: 't1', changedFileCount: 5 }])

    mockFindMany.mockClear()
    expect(await taskComplexityRepository.listByTaskIds([])).toEqual([])
    expect(mockFindMany).not.toHaveBeenCalled()
  })

  it('listByTeam 取 cohort 的信号字段', async () => {
    mockFindMany.mockResolvedValueOnce([])
    await taskComplexityRepository.listByTeam('team1')
    expect(mockFindMany).toHaveBeenCalledWith({
      where: { teamId: 'team1' },
      select: { taskId: true, totalDurationMs: true, changedFileCount: true },
    })
  })
})
