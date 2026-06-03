/**
 * @jest-environment node
 */
const mockFindMany = jest.fn()
const mockUpdate = jest.fn()

jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    milestone: {
      findMany: (...a: any[]) => mockFindMany(...a),
      update: (...a: any[]) => mockUpdate(...a),
    },
  },
}))

import { milestoneRepository } from '@/lib/repositories/milestone.repository'

beforeEach(() => {
  jest.clearAllMocks()
  mockFindMany.mockResolvedValue([])
  mockUpdate.mockResolvedValue({ id: 'm1' })
})

describe('milestoneRepository.findByProject filter', () => {
  it('defaults to active (archivedAt: null)', async () => {
    await milestoneRepository.findByProject('p1')
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { projectId: 'p1', archivedAt: null } })
    )
  })

  it('filter=archived selects only archived', async () => {
    await milestoneRepository.findByProject('p1', 'archived')
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { projectId: 'p1', archivedAt: { not: null } },
      })
    )
  })

  it('filter=all applies no archivedAt condition', async () => {
    await milestoneRepository.findByProject('p1', 'all')
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { projectId: 'p1' } })
    )
  })
})

describe('milestoneRepository.archive / unarchive', () => {
  it('archive sets archivedAt to the given date', async () => {
    const at = new Date('2026-06-02T00:00:00.000Z')
    await milestoneRepository.archive('m1', at)
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: 'm1' },
      data: { archivedAt: at },
    })
  })

  it('unarchive clears archivedAt', async () => {
    await milestoneRepository.unarchive('m1')
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: 'm1' },
      data: { archivedAt: null },
    })
  })
})
