/**
 * @jest-environment node
 */
jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    memoryProvenance: {
      createMany: jest.fn(),
      findFirst: jest.fn(),
    },
  },
}))

import { prisma } from '@/lib/db/prisma'
import { memoryProvenanceRepository } from '@/lib/repositories/memory-provenance.repository'

const mp = prisma.memoryProvenance as unknown as {
  createMany: jest.Mock
  findFirst: jest.Mock
}

beforeEach(() => {
  jest.clearAllMocks()
})

describe('memoryProvenanceRepository.createMany', () => {
  it('no-ops on empty parent list (no DB write)', async () => {
    await memoryProvenanceRepository.createMany('child', [])
    expect(mp.createMany).not.toHaveBeenCalled()
  })

  it('writes one row per parent with skipDuplicates', async () => {
    await memoryProvenanceRepository.createMany('child', ['p1', 'p2'])
    expect(mp.createMany).toHaveBeenCalledWith({
      data: [
        { childMemoryId: 'child', parentMemoryId: 'p1' },
        { childMemoryId: 'child', parentMemoryId: 'p2' },
      ],
      skipDuplicates: true,
    })
  })
})

describe('memoryProvenanceRepository.resolveCanonicalFragment', () => {
  it('returns the id unchanged for non-MEMORY fragment types (no query)', async () => {
    const out = await memoryProvenanceRepository.resolveCanonicalFragment(
      'SLACK_CONTEXT',
      'slack_1'
    )
    expect(out).toBe('slack_1')
    expect(mp.findFirst).not.toHaveBeenCalled()
  })

  it('returns the id unchanged when the memory has no child (orphan-free identity)', async () => {
    mp.findFirst.mockResolvedValueOnce(null)
    const out = await memoryProvenanceRepository.resolveCanonicalFragment(
      'MEMORY',
      'c2'
    )
    expect(out).toBe('c2')
  })

  it('walks a single hop c1 -> c2', async () => {
    mp.findFirst
      .mockResolvedValueOnce({ childMemoryId: 'c2' })
      .mockResolvedValueOnce(null)
    const out = await memoryProvenanceRepository.resolveCanonicalFragment(
      'MEMORY',
      'c1'
    )
    expect(out).toBe('c2')
  })

  it('walks a multi-hop chain c1 -> c2 -> c3', async () => {
    mp.findFirst
      .mockResolvedValueOnce({ childMemoryId: 'c2' })
      .mockResolvedValueOnce({ childMemoryId: 'c3' })
      .mockResolvedValueOnce(null)
    const out = await memoryProvenanceRepository.resolveCanonicalFragment(
      'MEMORY',
      'c1'
    )
    expect(out).toBe('c3')
  })

  it('breaks a cycle instead of looping forever', async () => {
    // c1 -> c2 -> c1 (corrupt data): must terminate.
    mp.findFirst
      .mockResolvedValueOnce({ childMemoryId: 'c2' })
      .mockResolvedValueOnce({ childMemoryId: 'c1' })
    const out = await memoryProvenanceRepository.resolveCanonicalFragment(
      'MEMORY',
      'c1'
    )
    expect(['c1', 'c2']).toContain(out)
    expect(mp.findFirst.mock.calls.length).toBeLessThanOrEqual(3)
  })
})
