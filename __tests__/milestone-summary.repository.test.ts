import { milestoneSummaryRepository } from '@/lib/repositories/milestone-summary.repository'

const mockFindUnique = jest.fn()
const mockUpsert = jest.fn()
const mockListByMilestoneForStats = jest.fn()

jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    milestoneSummary: {
      findUnique: (...a: any[]) => mockFindUnique(...a),
      upsert: (...a: any[]) => mockUpsert(...a),
    },
  },
}))

jest.mock('@/lib/repositories/task.repository', () => ({
  taskRepository: {
    listByMilestoneForStats: (...a: any[]) => mockListByMilestoneForStats(...a),
  },
}))

beforeEach(() => jest.clearAllMocks())

describe('milestoneSummaryRepository', () => {
  it('findByMilestoneId queries by milestoneId', async () => {
    mockFindUnique.mockResolvedValueOnce({ id: 'ms1' })
    await milestoneSummaryRepository.findByMilestoneId('m1')
    expect(mockFindUnique).toHaveBeenCalledWith({
      where: { milestoneId: 'm1' },
    })
  })

  it('save upserts by milestoneId', async () => {
    mockUpsert.mockResolvedValueOnce({ id: 'ms1' })
    const stats = {
      totalTasks: 5,
      done: 3,
      inProgress: 1,
      byPriority: { HIGH: 2 },
      byAssignee: { u1: 3 },
    }
    await milestoneSummaryRepository.save('m1', {
      stats,
      tldr: 't',
      report: 'r',
    })
    expect(mockUpsert).toHaveBeenCalledWith({
      where: { milestoneId: 'm1' },
      create: {
        milestoneId: 'm1',
        stats,
        tldr: 't',
        report: 'r',
      },
      update: {
        stats,
        tldr: 't',
        report: 'r',
        generatedAt: expect.any(Date),
      },
    })
  })

  it('computeStatsData aggregates done/inProgress/byPriority/byAssignee', async () => {
    mockListByMilestoneForStats.mockResolvedValueOnce([
      {
        id: 't1',
        status: 'DONE',
        priority: 'HIGH',
        assigneeActorId: 'a1',
        title: 'one',
      },
      {
        id: 't2',
        status: 'IN_PROGRESS',
        priority: 'HIGH',
        assigneeActorId: 'a1',
        title: 'two',
      },
      {
        id: 't3',
        status: 'TODO',
        priority: 'LOW',
        assigneeActorId: null,
        title: 'three',
      },
    ])

    const { stats, tasks } =
      await milestoneSummaryRepository.computeStatsData('m1')

    expect(mockListByMilestoneForStats).toHaveBeenCalledWith('m1')
    expect(tasks).toHaveLength(3)
    expect(stats).toEqual({
      totalTasks: 3,
      done: 1,
      inProgress: 1,
      byPriority: { HIGH: 2, LOW: 1 },
      byAssignee: { a1: 2, unassigned: 1 },
    })
  })
})
