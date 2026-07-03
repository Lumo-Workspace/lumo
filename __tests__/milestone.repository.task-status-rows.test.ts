/** @jest-environment node */
// LUM-650 — taskStatusRows feeds the complexity-weighted progress fold: it
// returns only {id, status} per member task (the join key + the DONE bucket).
jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    task: { findMany: jest.fn() },
  },
}))

import { prisma } from '@/lib/db/prisma'
import { milestoneRepository } from '@/lib/repositories/milestone.repository'

const taskFindMany = prisma.task.findMany as jest.Mock

beforeEach(() => taskFindMany.mockReset())

describe('milestoneRepository.taskStatusRows', () => {
  it('returns per-task {id, status} for the milestone — the weighted-progress join basis', async () => {
    taskFindMany.mockResolvedValue([
      { id: 't1', status: 'DONE' },
      { id: 't2', status: 'IN_PROGRESS' },
    ])
    const rows = await milestoneRepository.taskStatusRows('m-1')
    expect(taskFindMany).toHaveBeenCalledWith({
      where: { milestoneId: 'm-1' },
      select: { id: true, status: true },
    })
    expect(rows).toEqual([
      { id: 't1', status: 'DONE' },
      { id: 't2', status: 'IN_PROGRESS' },
    ])
  })
})
