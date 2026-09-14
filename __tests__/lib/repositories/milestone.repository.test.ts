jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    milestone: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    task: {
      groupBy: jest.fn(),
    },
  },
}))

import { prisma } from '@/lib/db/prisma'
import { milestoneRepository } from '@/lib/repositories/milestone.repository'

const mockFindUnique = prisma.milestone.findUnique as jest.Mock
const mockFindMany = prisma.milestone.findMany as jest.Mock
const mockCreate = prisma.milestone.create as jest.Mock
const mockUpdate = prisma.milestone.update as jest.Mock
const mockDelete = prisma.milestone.delete as jest.Mock
const mockTaskGroupBy = prisma.task.groupBy as jest.Mock

beforeEach(() => jest.clearAllMocks())

describe('milestoneRepository.findById', () => {
  it('returns the milestone when found', async () => {
    const row = { id: 'm1', projectId: 'p1', name: 'v1.0', status: 'PLANNED' }
    mockFindUnique.mockResolvedValue(row)
    const result = await milestoneRepository.findById('m1')
    expect(result).toEqual(row)
    expect(mockFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'm1' } })
    )
  })

  it('returns null when not found', async () => {
    mockFindUnique.mockResolvedValue(null)
    const result = await milestoneRepository.findById('missing')
    expect(result).toBeNull()
  })
})

describe('milestoneRepository.findByProject', () => {
  it('orders by sortOrder asc, then createdAt asc', async () => {
    mockFindMany.mockResolvedValue([])
    await milestoneRepository.findByProject('p1')
    expect(mockFindMany).toHaveBeenCalledWith({
      where: { projectId: 'p1', archivedAt: null },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    })
  })

  it('adds a case-insensitive name/description OR filter when search is given', async () => {
    mockFindMany.mockResolvedValue([])
    await milestoneRepository.findByProject('p1', 'active', 'launch')
    expect(mockFindMany).toHaveBeenCalledWith({
      where: {
        projectId: 'p1',
        archivedAt: null,
        OR: [
          { name: { contains: 'launch', mode: 'insensitive' } },
          { description: { contains: 'launch', mode: 'insensitive' } },
        ],
      },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    })
  })

  it('trims the search term before matching', async () => {
    mockFindMany.mockResolvedValue([])
    await milestoneRepository.findByProject('p1', 'all', '  Q3  ')
    expect(mockFindMany).toHaveBeenCalledWith({
      where: {
        projectId: 'p1',
        OR: [
          { name: { contains: 'Q3', mode: 'insensitive' } },
          { description: { contains: 'Q3', mode: 'insensitive' } },
        ],
      },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    })
  })

  it('ignores a blank/whitespace-only search term (no OR clause)', async () => {
    mockFindMany.mockResolvedValue([])
    await milestoneRepository.findByProject('p1', 'all', '   ')
    expect(mockFindMany).toHaveBeenCalledWith({
      where: { projectId: 'p1' },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    })
  })
})

describe('milestoneRepository.create', () => {
  it('inserts with PLANNED default and returns the row', async () => {
    const created = {
      id: 'm1',
      projectId: 'p1',
      name: 'v1.0',
      status: 'PLANNED',
    }
    mockCreate.mockResolvedValue(created)
    const result = await milestoneRepository.create({
      projectId: 'p1',
      name: 'v1.0',
      slug: 'v1-0',
    })
    expect(result).toEqual(created)
    expect(mockCreate).toHaveBeenCalledWith({
      data: {
        projectId: 'p1',
        name: 'v1.0',
        slug: 'v1-0',
        description: null,
        startDate: null,
        targetDate: null,
      },
    })
  })
})

describe('milestoneRepository.update', () => {
  it('passes through fields including completedAt', async () => {
    const updated = {
      id: 'm1',
      name: 'Renamed',
      completedAt: new Date('2026-06-01'),
    }
    mockUpdate.mockResolvedValue(updated)
    const result = await milestoneRepository.update('m1', {
      name: 'Renamed',
      completedAt: new Date('2026-06-01'),
    })
    expect(result).toEqual(updated)
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: 'm1' },
      data: { name: 'Renamed', completedAt: new Date('2026-06-01') },
    })
  })
})

describe('milestoneRepository.delete', () => {
  it('deletes by id', async () => {
    mockDelete.mockResolvedValue({ id: 'm1' })
    await milestoneRepository.delete('m1')
    expect(mockDelete).toHaveBeenCalledWith({ where: { id: 'm1' } })
  })
})

describe('milestoneRepository.countTasksByStatus', () => {
  it('returns a map keyed by status', async () => {
    mockTaskGroupBy.mockResolvedValue([
      { status: 'TODO', _count: { _all: 3 } },
      { status: 'DONE', _count: { _all: 2 } },
    ])
    const result = await milestoneRepository.countTasksByStatus('m1')
    expect(result).toEqual({ TODO: 3, IN_PROGRESS: 0, IN_REVIEW: 0, DONE: 2 })
    expect(mockTaskGroupBy).toHaveBeenCalledWith({
      by: ['status'],
      where: { milestoneId: 'm1' },
      _count: { _all: true },
    })
  })
})
