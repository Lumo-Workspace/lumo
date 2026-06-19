/**
 * @jest-environment node
 *
 * LUM-553 — memoryRepository.foldInto: many→one supersede in one transaction.
 * prisma is mocked; $transaction invokes the callback with a tx stub.
 */
const mockTx = {
  memory: { findMany: jest.fn(), create: jest.fn(), updateMany: jest.fn() },
  memoryProvenance: { createMany: jest.fn() },
}
jest.mock('@/lib/db/prisma', () => ({
  prisma: { $transaction: (cb: (tx: unknown) => unknown) => cb(mockTx) },
}))

import { memoryRepository } from '@/lib/repositories/memory.repository'

beforeEach(() => {
  jest.clearAllMocks()
  mockTx.memory.create.mockResolvedValue({ id: 'coarse-1' })
  mockTx.memory.updateMany.mockResolvedValue({ count: 3 })
  mockTx.memoryProvenance.createMany.mockResolvedValue({ count: 3 })
})

describe('memoryRepository.foldInto', () => {
  it('foldInto supersedes sources into one coarse card with provenance and no physical delete', async () => {
    // Of 4 requested sources, only 3 are still ACTIVE (one already superseded → guard skips it).
    mockTx.memory.findMany.mockResolvedValue([
      { id: 's1' },
      { id: 's2' },
      { id: 's3' },
    ])

    const res = await memoryRepository.foldInto({
      sourceIds: ['s1', 's2', 's3', 's4-already-superseded'],
      coarseContent: { trigger: 't', outcome: 'o' },
      category: 'TRAP',
      projectId: 'proj-1',
      workspaceId: 'ws-1',
      sourceSessionId: null,
    })

    expect(res).toEqual({ coarseId: 'coarse-1' })

    expect(mockTx.memory.create).toHaveBeenCalledWith({
      data: {
        workspaceId: 'ws-1',
        projectId: 'proj-1',
        scope: 'PROJECT',
        category: 'TRAP',
        content: { trigger: 't', outcome: 'o' },
        agent: 'CLAUDE_CODE',
        createdByMemberId: null,
        sourceSessionId: null,
        sourceTaskId: null,
      },
      select: { id: true },
    })

    const upd = mockTx.memory.updateMany.mock.calls[0][0]
    expect(upd.where).toEqual({
      id: { in: ['s1', 's2', 's3'] },
      status: 'ACTIVE',
    })
    expect(upd.data.status).toBe('SUPERSEDED')
    expect(upd.data.supersededById).toBe('coarse-1')
    expect(upd.data.supersededAt).toBeInstanceOf(Date)

    expect(mockTx.memoryProvenance.createMany).toHaveBeenCalledWith({
      data: [
        { parentMemoryId: 's1', childMemoryId: 'coarse-1' },
        { parentMemoryId: 's2', childMemoryId: 'coarse-1' },
        { parentMemoryId: 's3', childMemoryId: 'coarse-1' },
      ],
      skipDuplicates: true,
    })
  })

  it('aborts (throws, creates nothing) when fewer than 2 sources are still ACTIVE', async () => {
    mockTx.memory.findMany.mockResolvedValue([{ id: 's1' }])
    await expect(
      memoryRepository.foldInto({
        sourceIds: ['s1', 's2'],
        coarseContent: { trigger: 't', outcome: 'o' },
        category: 'TRAP',
        projectId: 'proj-1',
        workspaceId: 'ws-1',
      })
    ).rejects.toThrow(/fewer than 2/)
    expect(mockTx.memory.create).not.toHaveBeenCalled()
  })
})
