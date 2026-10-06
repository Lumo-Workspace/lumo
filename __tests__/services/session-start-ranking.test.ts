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
jest.mock('@/lib/runtime/wait-until', () => ({ waitUntil: jest.fn() }))
jest.mock('@/lib/repositories/task.repository', () => ({
  taskRepository: {
    findById: jest.fn(async () => ({
      id: 't-1',
      projectId: 'proj-1',
      number: 1,
      team: { identifier: 'LUM' },
    })),
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
import { LINEAGE_MIN_RESOLVED_TASKS } from '@/lib/lineage/ranking'

const memRow = (id: string, category = 'TRAP') => ({
  id,
  category,
  content: { trigger: id, outcome: id },
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
        resolvedTasks: LINEAGE_MIN_RESOLVED_TASKS + 1,
        mergedTasks: LINEAGE_MIN_RESOLVED_TASKS + 1,
      },
    ])

    const out = await taskContextService.buildSessionStartSections('t-1')
    expect(out.fragments).toEqual([
      expect.objectContaining({
        fragmentType: 'MEMORY',
        fragmentId: 'mem-hot',
        disclosure: 'INDEX',
      }),
      expect.objectContaining({
        fragmentType: 'MEMORY',
        fragmentId: 'mem-cold',
        disclosure: 'INDEX',
      }),
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
      expect.objectContaining({
        fragmentType: 'MEMORY',
        fragmentId: 'mem-p',
        disclosure: 'INDEX',
      }),
    ])
    expect(out.memorySection).toContain('mem-p')
    expect(out.memorySection).not.toContain('mem-t')
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
      expect.objectContaining({
        fragmentType: 'MEMORY',
        fragmentId: 'mem-p',
        disclosure: 'INDEX',
      }),
      expect.objectContaining({
        fragmentType: 'MEMORY',
        fragmentId: 'mem-t',
        disclosure: 'INDEX',
      }),
    ])
  })
})
