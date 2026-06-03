import { taskComplexityRepository } from '@/lib/repositories/task-complexity.repository'

const mockAgentRunFindMany = jest.fn()
const mockUpsert = jest.fn()
const mockFindUnique = jest.fn()
const mockFindMany = jest.fn()

jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    agentRun: {
      findMany: (...a: any[]) => mockAgentRunFindMany(...a),
    },
    taskComplexity: {
      upsert: (...a: any[]) => mockUpsert(...a),
      findUnique: (...a: any[]) => mockFindUnique(...a),
      findMany: (...a: any[]) => mockFindMany(...a),
    },
  },
}))

beforeEach(() => jest.clearAllMocks())

describe('taskComplexityRepository', () => {
  it('listRunSignalsForTask 只取已完成 run 的信号字段', async () => {
    mockAgentRunFindMany.mockResolvedValueOnce([])
    await taskComplexityRepository.listRunSignalsForTask('t1')
    expect(mockAgentRunFindMany).toHaveBeenCalledWith({
      where: { taskId: 't1', finishedAt: { not: null } },
      select: { durationMs: true, changedFiles: true },
    })
  })

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

  it('listByTeam 取 cohort 的信号字段', async () => {
    mockFindMany.mockResolvedValueOnce([])
    await taskComplexityRepository.listByTeam('team1')
    expect(mockFindMany).toHaveBeenCalledWith({
      where: { teamId: 'team1' },
      select: { taskId: true, totalDurationMs: true, changedFileCount: true },
    })
  })
})
