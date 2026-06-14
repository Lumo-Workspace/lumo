import { getMemoryByIdForWorkspace } from '@/lib/services/memory/memory-read.service'
import { memoryRepository } from '@/lib/repositories/memory.repository'

jest.mock('@/lib/repositories/memory.repository')

/**
 * Shape mirrors memoryRepository.findByIdWithWorkspace — the owning workspace
 * id lives at the top-level `memory.workspaceId` (a Memory row column), not on
 * a nested task/project relation. The service compares against that field.
 */
const makeRow = (workspaceId: string) => ({
  id: 'm1',
  workspaceId,
  projectId: 'p1',
  taskId: 't1',
  scope: 'TASK' as const,
  category: 'TRAP' as const,
  agent: null,
  content: { rule: 'x', scope: 'y' },
  createdByMemberId: 'mem1',
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-02T00:00:00Z'),
})

describe('getMemoryByIdForWorkspace', () => {
  it('throws 404 when the memory is in another workspace', async () => {
    ;(memoryRepository.findByIdWithWorkspace as jest.Mock).mockResolvedValue(
      makeRow('other')
    )
    await expect(getMemoryByIdForWorkspace('m1', 'ws1')).rejects.toMatchObject({
      status: 404,
    })
  })

  it('returns the memory when workspace matches', async () => {
    const row = makeRow('ws1')
    ;(memoryRepository.findByIdWithWorkspace as jest.Mock).mockResolvedValue(
      row
    )
    await expect(getMemoryByIdForWorkspace('m1', 'ws1')).resolves.toBe(row)
  })

  it('throws 404 when the memory does not exist', async () => {
    ;(memoryRepository.findByIdWithWorkspace as jest.Mock).mockResolvedValue(
      null
    )
    await expect(getMemoryByIdForWorkspace('m1', 'ws1')).rejects.toMatchObject({
      status: 404,
    })
  })
})
