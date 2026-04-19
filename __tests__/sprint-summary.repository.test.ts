import { sprintSummaryRepository } from '@/lib/repositories/sprint-summary.repository'

const mockFindUnique = jest.fn()
const mockUpsert = jest.fn()

jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    sprintSummary: {
      findUnique: (...a: any[]) => mockFindUnique(...a),
      upsert: (...a: any[]) => mockUpsert(...a),
    },
  },
}))

beforeEach(() => jest.clearAllMocks())

describe('sprintSummaryRepository', () => {
  it('findBySprintId queries by sprintId', async () => {
    mockFindUnique.mockResolvedValueOnce({ id: 'ss1' })
    await sprintSummaryRepository.findBySprintId('s1')
    expect(mockFindUnique).toHaveBeenCalledWith({ where: { sprintId: 's1' } })
  })

  it('save upserts by sprintId', async () => {
    mockUpsert.mockResolvedValueOnce({ id: 'ss1' })
    await sprintSummaryRepository.save('s1', {
      stats: { totalTasks: 5 },
      tldr: 't',
      report: 'r',
    })
    expect(mockUpsert).toHaveBeenCalledWith({
      where: { sprintId: 's1' },
      create: {
        sprintId: 's1',
        stats: { totalTasks: 5 },
        tldr: 't',
        report: 'r',
      },
      update: {
        stats: { totalTasks: 5 },
        tldr: 't',
        report: 'r',
        generatedAt: expect.any(Date),
      },
    })
  })
})
