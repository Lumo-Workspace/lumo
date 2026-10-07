/** @jest-environment node */
// LUM-276: each session-start builder must return the fragments it actually
// injected (post-budget), so the route can record one lineage edge per fragment.

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
import { taskWebLinkRepository } from '@/lib/repositories/task-web-link.repository'

describe('buildSessionStartSections — fragment manifest', () => {
  it('records every candidate memory + linked resource (overflow degrades to manifest, not dropped)', async () => {
    ;(
      memoryRepository.findActiveProjectMemories as jest.Mock
    ).mockResolvedValue([
      {
        id: 'mem-p',
        category: 'TRAP',
        content: { trigger: 'x', mitigation: 'y' },
      },
    ])
    ;(memoryRepository.findActiveTaskMemories as jest.Mock).mockResolvedValue([
      { id: 'mem-t', category: 'DECISION', content: { what: 'a', why: 'b' } },
    ])
    ;(taskWebLinkRepository.listByTask as jest.Mock).mockResolvedValue([
      { id: 'web-1', url: 'http://x', title: 'X' },
    ])

    const out = await taskContextService.buildSessionStartSections('t-1')
    // LUM-500: every session-start fragment is Tier-2, tagged disclosure INDEX.
    // LUM-522: MEMORY fragments additionally carry indexTokens/fullTokens —
    // use objectContaining so the assertions are additive-change safe.
    expect(out.fragments).toEqual(
      expect.arrayContaining([
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
        { fragmentType: 'WEB_LINK', fragmentId: 'web-1', disclosure: 'INDEX' },
      ])
    )
  })

  it('keeps overflowed memories in the manifest (budget degrades them to a one-line manifest, never drops them)', async () => {
    // Each memory renders to >2500 tokens (~4000 tokens each, based on
    // estimateMemoryItemTokens = ceil((json.length + 20) / 4)) on its own, so
    // the second overflows the shared SESSION_START_BUDGET_TOKENS budget and is
    // degraded to a one-line manifest — but it is still injected, so it must
    // still appear in the fragment manifest (LUM-276 anti-bias guarantee).
    const big = (n: number) => ({
      id: `mem-${n}`,
      category: 'TRAP' as const,
      content: { trigger: 'T'.repeat(8000), outcome: 'O'.repeat(8000) },
    })
    ;(
      memoryRepository.findActiveProjectMemories as jest.Mock
    ).mockResolvedValue([big(1), big(2)])
    ;(memoryRepository.findActiveTaskMemories as jest.Mock).mockResolvedValue(
      []
    )
    ;(taskWebLinkRepository.listByTask as jest.Mock).mockResolvedValue([])

    const out = await taskContextService.buildSessionStartSections('t-1')
    // LUM-522: MEMORY fragments carry additional token-weight fields; use
    // objectContaining so the assertions are additive-change safe.
    expect(out.fragments).toEqual([
      expect.objectContaining({
        fragmentType: 'MEMORY',
        fragmentId: 'mem-1',
        disclosure: 'INDEX',
      }),
      expect.objectContaining({
        fragmentType: 'MEMORY',
        fragmentId: 'mem-2',
        disclosure: 'INDEX',
      }),
    ])
  })

  it('returns an empty manifest when the task has nothing attached', async () => {
    ;(
      memoryRepository.findActiveProjectMemories as jest.Mock
    ).mockResolvedValue([])
    ;(memoryRepository.findActiveTaskMemories as jest.Mock).mockResolvedValue(
      []
    )
    ;(taskWebLinkRepository.listByTask as jest.Mock).mockResolvedValue([])
    const out = await taskContextService.buildSessionStartSections('t-1')
    expect(out.fragments).toEqual([])
  })
})

describe('buildSessionStartSections — token weights and dropped fragments', () => {
  it('session start memory fragments carry token weights and relevance score', async () => {
    // Arrange: one project memory so buildSessionStartSections returns a MEMORY fragment
    ;(
      memoryRepository.findActiveProjectMemories as jest.Mock
    ).mockResolvedValue([
      {
        id: 'mem-w',
        category: 'DECISION',
        content: { what: 'use bigram similarity', why: 'fast and no API call' },
        createdByMemberId: null,
      },
    ])
    ;(memoryRepository.findActiveTaskMemories as jest.Mock).mockResolvedValue(
      []
    )

    const out = await taskContextService.buildSessionStartSections('t-1')
    const mem = out.fragments.find(f => f.fragmentType === 'MEMORY')!
    expect(mem.indexTokens).toBeGreaterThan(0)
    expect(mem.fullTokens).toBeGreaterThanOrEqual(mem.indexTokens!)
    expect(out.droppedFragments).toBeDefined()
  })
})

describe('buildLayer2ReviewSectionForTask — fragment manifest', () => {
  it('records only the budget survivors as MEMORY fragments', async () => {
    ;(
      memoryRepository.findProjectMemoriesBySession as jest.Mock
    ).mockResolvedValue([
      {
        id: 'mem-a',
        category: 'TRAP',
        content: { trigger: 't', mitigation: 'm' },
      },
    ])
    const { sessionRepository } = jest.requireMock(
      '@/lib/repositories/session.repository'
    )
    sessionRepository.findPreviousSessionIdForMember.mockResolvedValue('prev-s')

    const out = await taskContextService.buildLayer2ReviewSectionForTask(
      't-1',
      'cur-s'
    )
    expect(out.fragments).toEqual([
      { fragmentType: 'MEMORY', fragmentId: 'mem-a' },
    ])
  })
})
