/**
 * @jest-environment node
 *
 * Layer 2 consolidation lease primitives on memoryRepository. The lease lives
 * on the Project row (memoryConsolidationLockedUntil) and is claimed with a
 * single guarded updateMany so Postgres row-locking makes the claim atomic
 * across function instances.
 */
jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    project: {
      updateMany: jest.fn(),
    },
  },
}))

import { memoryRepository } from '@/lib/repositories/memory.repository'
import { prisma } from '@/lib/db/prisma'

const prismaMock = prisma as unknown as {
  project: { updateMany: jest.Mock }
}

beforeEach(() => {
  jest.clearAllMocks()
})

describe('memoryRepository.tryClaimLayer2Lease', () => {
  it('claims only when the lease is free or expired, scoped to the project', async () => {
    prismaMock.project.updateMany.mockResolvedValue({ count: 1 })
    const now = new Date('2026-05-30T00:00:00.000Z')
    const until = new Date('2026-05-30T00:01:00.000Z')

    const claimed = await memoryRepository.tryClaimLayer2Lease(
      'proj_1',
      until,
      now
    )

    expect(claimed).toBe(true)
    expect(prismaMock.project.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'proj_1',
        OR: [
          { memoryConsolidationLockedUntil: null },
          { memoryConsolidationLockedUntil: { lt: now } },
        ],
      },
      data: { memoryConsolidationLockedUntil: until },
    })
  })

  it('returns false when another run already holds an unexpired lease', async () => {
    // Guarded updateMany matches zero rows → count 0 → claim lost.
    prismaMock.project.updateMany.mockResolvedValue({ count: 0 })

    const claimed = await memoryRepository.tryClaimLayer2Lease(
      'proj_1',
      new Date('2026-05-30T00:01:00.000Z'),
      new Date('2026-05-30T00:00:00.000Z')
    )

    expect(claimed).toBe(false)
  })
})

describe('memoryRepository.releaseLayer2Lease', () => {
  it('clears the lease for the project', async () => {
    prismaMock.project.updateMany.mockResolvedValue({ count: 1 })

    await memoryRepository.releaseLayer2Lease('proj_1')

    expect(prismaMock.project.updateMany).toHaveBeenCalledWith({
      where: { id: 'proj_1' },
      data: { memoryConsolidationLockedUntil: null },
    })
  })
})
