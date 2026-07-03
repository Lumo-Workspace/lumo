/** @jest-environment node */
jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    sprint: { findMany: jest.fn() },
    task: { groupBy: jest.fn() },
  },
}))

import { sprintRepository } from '@/lib/repositories/sprint.repository'
import { prisma } from '@/lib/db/prisma'

const mockPrisma = prisma as unknown as {
  sprint: { findMany: jest.Mock }
  task: { groupBy: jest.Mock }
}

describe('sprintRepository.completedCompletionRates', () => {
  it('returns done/total per closed sprint, skips total=0, excludes self', async () => {
    mockPrisma.sprint.findMany.mockResolvedValue([
      { id: 's1' },
      { id: 's2' },
      { id: 's3' },
    ])
    // s1: 2 done / 4 total = 0.5 ; s2: 3 done / 3 total = 1 ; s3: 0 total → skip
    mockPrisma.task.groupBy.mockResolvedValue([
      { sprintId: 's1', status: 'DONE', _count: { _all: 2 } },
      { sprintId: 's1', status: 'TODO', _count: { _all: 2 } },
      { sprintId: 's2', status: 'DONE', _count: { _all: 3 } },
    ])
    const rates = await sprintRepository.completedCompletionRates(
      'team1',
      'cur'
    )
    expect(rates.sort()).toEqual([0.5, 1])
    // exclude current sprint from the closed-sprint query
    expect(mockPrisma.sprint.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          teamId: 'team1',
          status: 'CLOSED',
          id: { not: 'cur' },
        }),
      })
    )
  })

  it('no closed sprints → empty array', async () => {
    mockPrisma.sprint.findMany.mockResolvedValue([])
    mockPrisma.task.groupBy.mockResolvedValue([])
    const rates = await sprintRepository.completedCompletionRates(
      'team1',
      'cur'
    )
    expect(rates).toEqual([])
  })
})
