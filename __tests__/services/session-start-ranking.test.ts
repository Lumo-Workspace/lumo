/** @jest-environment node */
// LUM-279: session-start sections are reordered by historical merge contribution
// before the token budget is applied, and pre/post-consolidation memory dups
// collapse by canonical id.

jest.mock('@/lib/services/task.service', () => ({
  taskService: { resolveIdentifier: jest.fn() },
}))
jest.mock('@/lib/services/document.service', () => ({
  scheduleDocumentSummary: jest.fn(),
}))
jest.mock('@vercel/functions', () => ({ waitUntil: jest.fn() }))
jest.mock('@/lib/repositories/task.repository', () => ({
  taskRepository: {
    findById: jest.fn(async () => ({ id: 't-1', projectId: 'proj-1' })),
  },
}))
jest.mock('@/lib/repositories/memory.repository', () => ({
  memoryRepository: {
    findActiveTaskMemories: jest.fn().mockResolvedValue([]),
    findActiveProjectMemories: jest.fn().mockResolvedValue([]),
    findProjectMemoriesBySession: jest.fn().mockResolvedValue([]),
  },
}))
jest.mock('@/lib/repositories/task-slack-context.repository', () => ({
  taskSlackContextRepository: { listByTask: jest.fn().mockResolvedValue([]) },
}))
jest.mock('@/lib/repositories/task-web-link.repository', () => ({
  taskWebLinkRepository: { listByTask: jest.fn().mockResolvedValue([]) },
}))
jest.mock('@/lib/services/task-figma-link.service', () => ({
  taskFigmaLinkService: { listForTask: jest.fn().mockResolvedValue([]) },
}))
jest.mock('@/lib/repositories/pull-request.repository', () => ({
  pullRequestRepository: { listByTask: jest.fn().mockResolvedValue([]) },
}))
jest.mock('@/lib/repositories/session.repository', () => ({
  sessionRepository: {
    findPreviousSessionIdForMember: jest.fn().mockResolvedValue(null),
  },
}))
jest.mock('@/lib/repositories/memory-provenance.repository', () => ({
  memoryProvenanceRepository: {
    resolveCanonicalFragment: jest.fn(async (_t: string, id: string) => id),
  },
}))
jest.mock('@/lib/repositories/lineage-edge.repository', () => ({
  lineageEdgeRepository: { mergeRateByFragments: jest.fn(async () => []) },
}))

import { taskContextService } from '@/lib/services/task-context.service'
import { memoryRepository } from '@/lib/repositories/memory.repository'
import { memoryProvenanceRepository } from '@/lib/repositories/memory-provenance.repository'
import { lineageEdgeRepository } from '@/lib/repositories/lineage-edge.repository'

const memRow = (id: string, category = 'TRAP') => ({
  id,
  category,
  content: { trigger: id, mitigation: id },
})

describe('buildSessionStartSections — lineage-aware ranking', () => {
  it('orders a high-merge memory ahead of a cold one in the fragment manifest', async () => {
    ;(
      memoryRepository.findActiveProjectMemories as jest.Mock
    ).mockResolvedValue([memRow('mem-cold'), memRow('mem-hot')])
    ;(memoryRepository.findActiveTaskMemories as jest.Mock).mockResolvedValue(
      []
    )
    ;(
      lineageEdgeRepository.mergeRateByFragments as jest.Mock
    ).mockResolvedValue([
      {
        fragmentType: 'MEMORY',
        fragmentId: 'mem-hot',
        resolvedTasks: 4,
        mergedTasks: 4,
      },
    ])

    const out = await taskContextService.buildSessionStartSections('t-1')
    expect(out.fragments).toEqual([
      { fragmentType: 'MEMORY', fragmentId: 'mem-hot' },
      { fragmentType: 'MEMORY', fragmentId: 'mem-cold' },
    ])
  })

  it('collapses a pre/post-consolidation memory duplicate by canonical id', async () => {
    ;(
      memoryRepository.findActiveProjectMemories as jest.Mock
    ).mockResolvedValue([memRow('mem-p')])
    ;(memoryRepository.findActiveTaskMemories as jest.Mock).mockResolvedValue([
      memRow('mem-t'),
    ])
    ;(
      memoryProvenanceRepository.resolveCanonicalFragment as jest.Mock
    ).mockImplementation(async (_t: string, id: string) =>
      id === 'mem-t' ? 'mem-p' : id
    )
    ;(
      lineageEdgeRepository.mergeRateByFragments as jest.Mock
    ).mockResolvedValue([])

    const out = await taskContextService.buildSessionStartSections('t-1')
    expect(out.fragments).toEqual([
      { fragmentType: 'MEMORY', fragmentId: 'mem-p' },
    ])
  })

  it('falls back to fixed order (project-first) when the merge-rate query throws', async () => {
    ;(
      memoryRepository.findActiveProjectMemories as jest.Mock
    ).mockResolvedValue([memRow('mem-p')])
    ;(memoryRepository.findActiveTaskMemories as jest.Mock).mockResolvedValue([
      memRow('mem-t'),
    ])
    ;(
      memoryProvenanceRepository.resolveCanonicalFragment as jest.Mock
    ).mockImplementation(async (_t: string, id: string) => id)
    ;(
      lineageEdgeRepository.mergeRateByFragments as jest.Mock
    ).mockRejectedValue(new Error('db down'))

    const out = await taskContextService.buildSessionStartSections('t-1')
    expect(out.fragments).toEqual([
      { fragmentType: 'MEMORY', fragmentId: 'mem-p' },
      { fragmentType: 'MEMORY', fragmentId: 'mem-t' },
    ])
  })
})
