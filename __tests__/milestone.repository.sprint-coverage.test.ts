jest.mock('@/lib/db/prisma', () => ({
  prisma: { task: { groupBy: jest.fn() }, sprint: { findMany: jest.fn() } },
}))

import { prisma } from '@/lib/db/prisma'
import { milestoneRepository } from '@/lib/repositories/milestone.repository'
import { sprintRepository } from '@/lib/repositories/sprint.repository'

const groupBy = prisma.task.groupBy as jest.Mock
const findMany = prisma.sprint.findMany as jest.Mock

beforeEach(() => {
  groupBy.mockReset()
  findMany.mockReset()
})

describe('milestoneRepository.sprintCoverageCounts', () => {
  it('groups tasks by sprintId+status and flattens _count', async () => {
    groupBy.mockResolvedValue([
      { sprintId: 's3', status: 'DONE', _count: { _all: 4 } },
      { sprintId: null, status: 'TODO', _count: { _all: 2 } },
    ])
    const rows = await milestoneRepository.sprintCoverageCounts('m-1')
    expect(groupBy).toHaveBeenCalledWith({
      by: ['sprintId', 'status'],
      where: { milestoneId: 'm-1' },
      _count: { _all: true },
    })
    expect(rows).toEqual([
      { sprintId: 's3', status: 'DONE', count: 4 },
      { sprintId: null, status: 'TODO', count: 2 },
    ])
  })
})

describe('sprintRepository.findByIds', () => {
  it('returns [] without querying on empty input', async () => {
    const rows = await sprintRepository.findByIds([])
    expect(rows).toEqual([])
    expect(findMany).not.toHaveBeenCalled()
  })

  it('scopes by id list and optional teamId', async () => {
    findMany.mockResolvedValue([
      { id: 's3', number: 3, name: 'Sprint 3', status: 'ACTIVE' },
    ])
    const rows = await sprintRepository.findByIds(['s3'], 'team-1')
    expect(findMany).toHaveBeenCalledWith({
      where: { id: { in: ['s3'] }, teamId: 'team-1' },
      select: { id: true, number: true, name: true, status: true },
    })
    expect(rows).toEqual([
      { id: 's3', number: 3, name: 'Sprint 3', status: 'ACTIVE' },
    ])
  })
})
