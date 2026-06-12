/**
 * @jest-environment node
 */
jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    memoryProvenance: {
      createMany: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
    },
    memory: {
      findMany: jest.fn(),
    },
  },
}))

import { prisma } from '@/lib/db/prisma'
import { memoryProvenanceRepository } from '@/lib/repositories/memory-provenance.repository'

const mp = prisma.memoryProvenance as unknown as {
  createMany: jest.Mock
  findFirst: jest.Mock
  findMany: jest.Mock
}
const mem = prisma.memory as unknown as {
  findMany: jest.Mock
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

describe('memoryProvenanceRepository.birthTaskIdsByMemory', () => {
  it('returns an empty map for an empty id list (no query)', async () => {
    const out = await memoryProvenanceRepository.birthTaskIdsByMemory([])
    expect(out.size).toBe(0)
    expect(mp.findMany).not.toHaveBeenCalled()
    expect(mem.findMany).not.toHaveBeenCalled()
  })

  it('resolves own birth and backtracks MemoryProvenance ancestors for promoted rows', async () => {
    // m-task: an un-promoted TASK memory → own birth is sourceTaskId.
    // m-proj: a promoted PROJECT memory with null own birth → birth comes
    //         from its two source TASK ancestors via MemoryProvenance.
    //   m-proj ← p1 (birth t1) , m-proj ← p2 ← gp (birth t-gp)
    mp.findMany
      // level 0: direct parents of the requested ids
      .mockResolvedValueOnce([
        { childMemoryId: 'm-proj', parentMemoryId: 'p1' },
        { childMemoryId: 'm-proj', parentMemoryId: 'p2' },
      ])
      // level 1: parents of p1 / p2 (p2 has a grandparent)
      .mockResolvedValueOnce([{ childMemoryId: 'p2', parentMemoryId: 'gp' }])
      // level 2: gp has no parents
      .mockResolvedValueOnce([])
    mem.findMany.mockResolvedValueOnce([
      { id: 'm-task', sourceTaskId: 't-own', taskId: 'scope-x' },
      { id: 'm-proj', sourceTaskId: null, taskId: null },
      { id: 'p1', sourceTaskId: 't1', taskId: null },
      { id: 'p2', sourceTaskId: null, taskId: 't2' }, // legacy proxy via taskId
      { id: 'gp', sourceTaskId: 't-gp', taskId: null },
    ])

    const out = await memoryProvenanceRepository.birthTaskIdsByMemory([
      'm-task',
      'm-proj',
    ])

    expect(out.get('m-task')).toEqual(new Set(['t-own']))
    expect(out.get('m-proj')).toEqual(new Set(['t1', 't2', 't-gp']))
    // birth lookup is scoped to the requested ids plus discovered ancestors
    expect(mem.findMany).toHaveBeenCalledWith({
      where: {
        id: {
          in: expect.arrayContaining(['m-task', 'm-proj', 'p1', 'p2', 'gp']),
        },
      },
      select: { id: true, sourceTaskId: true, taskId: true },
    })
  })

  it('falls back to taskId when sourceTaskId is null and omits ids with no birth', async () => {
    mp.findMany.mockResolvedValue([])
    mem.findMany.mockResolvedValueOnce([
      { id: 'a', sourceTaskId: null, taskId: 't-proxy' },
      { id: 'b', sourceTaskId: null, taskId: null }, // no derivable birth
    ])
    const out = await memoryProvenanceRepository.birthTaskIdsByMemory([
      'a',
      'b',
    ])
    expect(out.get('a')).toEqual(new Set(['t-proxy']))
    expect(out.has('b')).toBe(false)
  })
})
