/**
 * @jest-environment node
 */
const mockListForProject = jest.fn()
const mockJudged = jest.fn()

jest.mock('@/lib/repositories/memory.repository', () => ({
  memoryRepository: {
    listForProject: (...a: unknown[]) => mockListForProject(...a),
  },
}))
jest.mock('@/lib/repositories/lineage-edge.repository', () => ({
  lineageEdgeRepository: {
    judgedUsageByFragments: (...a: unknown[]) => mockJudged(...a),
  },
}))

import { memorySyncService } from '@/lib/services/memory/memory-sync.service'

beforeEach(() => jest.clearAllMocks())

describe('memorySyncService.buildBundle', () => {
  it('returns file-shaped entries for ACTIVE project memories', async () => {
    mockListForProject.mockResolvedValue([
      {
        id: 'm1',
        scope: 'PROJECT',
        category: 'CONVENTION',
        content: { rule: 'r', scope: 's' },
      },
    ])
    mockJudged.mockResolvedValue([
      {
        fragmentType: 'MEMORY',
        fragmentId: 'm1',
        judgedUsedTasks: 4,
        auditedTasks: 5,
        appearanceTasks: 5,
      },
    ])

    const bundle = await memorySyncService.buildBundle('proj_1', {
      syncedAtIso: 'T',
    })

    expect(bundle.projectId).toBe('proj_1')
    expect(bundle.entries).toHaveLength(1)
    expect(bundle.entries[0]!.relPath).toBe('team/m1.md')
    expect(mockJudged).toHaveBeenCalledWith([
      { fragmentType: 'MEMORY', fragmentId: 'm1' },
    ])
  })

  it('returns an empty bundle when the project has no memories', async () => {
    mockListForProject.mockResolvedValue([])
    mockJudged.mockResolvedValue([])
    const bundle = await memorySyncService.buildBundle('proj_empty', {
      syncedAtIso: 'T',
    })
    expect(bundle.entries).toEqual([])
  })
})
