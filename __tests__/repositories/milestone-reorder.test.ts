/**
 * @jest-environment node
 */
import { milestoneRepository } from '@/lib/repositories/milestone.repository'

jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    milestone: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    $transaction: jest.fn(),
  },
}))

import { prisma } from '@/lib/db/prisma'

const mockFindMany = prisma.milestone.findMany as jest.Mock
const mockFindFirst = prisma.milestone.findFirst as jest.Mock
const mockUpdate = prisma.milestone.update as jest.Mock
const mockTx = prisma.$transaction as jest.Mock

beforeEach(() => {
  mockFindMany.mockReset()
  mockFindFirst.mockReset()
  mockUpdate.mockReset()
  mockTx.mockReset()
})

describe('milestoneRepository.findByProject', () => {
  it('orders by sortOrder asc then createdAt asc', async () => {
    mockFindMany.mockResolvedValue([])
    await milestoneRepository.findByProject('p-1')
    expect(mockFindMany).toHaveBeenCalledWith({
      where: { projectId: 'p-1', archivedAt: null },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    })
  })
})

describe('milestoneRepository.reorder', () => {
  it('rewrites sortOrder to the array index inside a transaction', async () => {
    const txUpdate = jest.fn()
    mockTx.mockImplementation(async (cb: (tx: unknown) => unknown) =>
      cb({ milestone: { update: txUpdate } })
    )
    await milestoneRepository.reorder('p-1', ['b', 'a', 'c'])
    expect(txUpdate).toHaveBeenNthCalledWith(1, {
      where: { id: 'b', projectId: 'p-1' },
      data: { sortOrder: 0 },
    })
    expect(txUpdate).toHaveBeenNthCalledWith(2, {
      where: { id: 'a', projectId: 'p-1' },
      data: { sortOrder: 1 },
    })
    expect(txUpdate).toHaveBeenNthCalledWith(3, {
      where: { id: 'c', projectId: 'p-1' },
      data: { sortOrder: 2 },
    })
  })
})

describe('milestoneRepository.getMaxSortOrder', () => {
  it('returns the top sortOrder when milestones exist', async () => {
    mockFindFirst.mockResolvedValue({ sortOrder: 4 })
    await expect(milestoneRepository.getMaxSortOrder('p-1')).resolves.toBe(4)
    expect(mockFindFirst).toHaveBeenCalledWith({
      where: { projectId: 'p-1' },
      orderBy: { sortOrder: 'desc' },
      select: { sortOrder: true },
    })
  })

  it('returns null when the project has no milestones', async () => {
    mockFindFirst.mockResolvedValue(null)
    await expect(milestoneRepository.getMaxSortOrder('p-1')).resolves.toBeNull()
  })
})
