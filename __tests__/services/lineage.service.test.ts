/** @jest-environment node */
jest.mock('@/lib/repositories/lineage-edge.repository', () => ({
  lineageEdgeRepository: { createMany: jest.fn().mockResolvedValue({ count: 0 }) },
}))
jest.mock('@/lib/repositories/memory-provenance.repository', () => ({
  memoryProvenanceRepository: {
    resolveCanonicalFragment: jest.fn(async (_type: string, id: string) => id),
  },
}))

import { lineageService } from '@/lib/services/lineage.service'
import { lineageEdgeRepository } from '@/lib/repositories/lineage-edge.repository'
import { memoryProvenanceRepository } from '@/lib/repositories/memory-provenance.repository'

const mockCreateMany = lineageEdgeRepository.createMany as jest.Mock
const mockResolve = memoryProvenanceRepository.resolveCanonicalFragment as jest.Mock

beforeEach(() => {
  jest.clearAllMocks()
  mockResolve.mockImplementation(async (_type: string, id: string) => id)
})

describe('lineageService.recordSessionStartEdges', () => {
  it('no-ops (no createMany call) for an empty fragment list', async () => {
    await lineageService.recordSessionStartEdges({
      workspaceId: 'ws-1',
      taskId: 't-1',
      sessionId: 's-1',
      fragments: [],
    })
    expect(mockCreateMany).not.toHaveBeenCalled()
  })

  it('stamps workspace/task/session and leaves runId/outcome unset', async () => {
    await lineageService.recordSessionStartEdges({
      workspaceId: 'ws-1',
      taskId: 't-1',
      sessionId: 's-1',
      fragments: [{ fragmentType: 'WEB_LINK', fragmentId: 'web-1' }],
    })
    expect(mockCreateMany).toHaveBeenCalledWith([
      {
        workspaceId: 'ws-1',
        taskId: 't-1',
        fragmentType: 'WEB_LINK',
        fragmentId: 'web-1',
        sessionId: 's-1',
      },
    ])
  })

  it('resolves MEMORY fragments to their canonical id', async () => {
    mockResolve.mockImplementation(async (type: string, id: string) =>
      type === 'MEMORY' && id === 'mem-task' ? 'mem-project' : id
    )
    await lineageService.recordSessionStartEdges({
      workspaceId: 'ws-1',
      taskId: 't-1',
      sessionId: 's-1',
      fragments: [{ fragmentType: 'MEMORY', fragmentId: 'mem-task' }],
    })
    expect(mockResolve).toHaveBeenCalledWith('MEMORY', 'mem-task')
    expect(mockCreateMany).toHaveBeenCalledWith([
      expect.objectContaining({ fragmentType: 'MEMORY', fragmentId: 'mem-project' }),
    ])
  })

  it('de-dupes fragments that collapse to the same type+id after canonicalization', async () => {
    mockResolve.mockImplementation(async (_type: string, id: string) =>
      id === 'mem-task' ? 'mem-project' : id
    )
    await lineageService.recordSessionStartEdges({
      workspaceId: 'ws-1',
      taskId: 't-1',
      sessionId: 's-1',
      fragments: [
        { fragmentType: 'MEMORY', fragmentId: 'mem-task' },
        { fragmentType: 'MEMORY', fragmentId: 'mem-project' },
      ],
    })
    const arg = mockCreateMany.mock.calls[0][0]
    expect(arg).toHaveLength(1)
    expect(arg[0]).toMatchObject({ fragmentType: 'MEMORY', fragmentId: 'mem-project' })
  })

  it('swallows a repository failure (best-effort side effect)', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    mockCreateMany.mockRejectedValueOnce(new Error('db down'))
    await expect(
      lineageService.recordSessionStartEdges({
        workspaceId: 'ws-1',
        taskId: 't-1',
        sessionId: 's-1',
        fragments: [{ fragmentType: 'PR', fragmentId: 'pr-1' }],
      })
    ).resolves.toBeUndefined()
    expect(errorSpy).toHaveBeenCalled()
    errorSpy.mockRestore()
  })
})
