/** @jest-environment node */
// LUM-486: buildSessionStartSections must gate project memories through the
// relevance gate BEFORE they enter both the rendered section and the `fragments`
// manifest. Task-scoped memories are never gated.

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
      title: 'narrow refactor',
      description: 'remove prisma direct calls',
      projectId: 'proj-1',
      status: 'TODO',
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
    findNeighborEmbeddings: jest.fn(),
  },
}))
jest.mock('@/lib/repositories/task-slack-context.repository', () => ({
  taskSlackContextRepository: { listByTask: jest.fn().mockResolvedValue([]) },
}))
jest.mock('@/lib/repositories/task-decision.repository', () => ({
  taskDecisionRepository: { listByTask: jest.fn().mockResolvedValue([]) },
}))
jest.mock('@/lib/repositories/task-web-link.repository', () => ({
  taskWebLinkRepository: { listByTask: jest.fn().mockResolvedValue([]) },
}))
jest.mock('@/lib/services/task-figma-link.service', () => ({
  taskFigmaLinkService: { listForTask: jest.fn().mockResolvedValue([]) },
}))
jest.mock('@/lib/repositories/pull-request.repository', () => ({
  pullRequestRepository: {
    listByTask: jest.fn().mockResolvedValue([]),
    listIdAndNumberByTask: jest.fn().mockResolvedValue([]),
  },
}))
jest.mock('@/lib/repositories/session.repository', () => ({
  sessionRepository: {
    findPreviousSessionIdForMember: jest.fn().mockResolvedValue(null),
    listForTask: jest.fn().mockResolvedValue([]),
  },
}))
jest.mock('@/lib/repositories/hook-event.repository', () => ({
  hookEventRepository: {
    findTurnBoundaryEventsForSessions: jest.fn().mockResolvedValue([]),
  },
}))
jest.mock('@/lib/repositories/task-artifact.repository', () => ({
  taskArtifactRepository: { listByTask: jest.fn().mockResolvedValue([]) },
}))
jest.mock('@/lib/repositories/milestone.repository', () => ({
  milestoneRepository: { findById: jest.fn().mockResolvedValue(null) },
}))
jest.mock('@/lib/repositories/misc.repository', () => ({
  miscRepository: {
    findDocumentsForContext: jest.fn().mockResolvedValue([]),
  },
}))
jest.mock('@/lib/repositories/comment.repository', () => ({
  commentRepository: { listAllForTask: jest.fn().mockResolvedValue([]) },
}))
jest.mock('@/lib/repositories/pr-comment-mirror.repository', () => ({
  prCommentMirrorRepository: {
    listReviewTodosForPrs: jest.fn().mockResolvedValue([]),
  },
}))
jest.mock('@/lib/repositories/actor.repository', () => ({
  actorRepository: {
    findGithubIdentitiesByIds: jest.fn().mockResolvedValue([]),
  },
}))
jest.mock('@/lib/repositories/workspace.repository', () => ({
  workspaceRepository: {
    findAcceptanceModeByTask: jest.fn().mockResolvedValue(false),
  },
}))
jest.mock('@/lib/repositories/memory-provenance.repository', () => ({
  memoryProvenanceRepository: {
    resolveCanonicalFragment: jest.fn(async (_t: string, id: string) => id),
  },
}))
jest.mock('@/lib/repositories/lineage-edge.repository', () => ({
  lineageEdgeRepository: {
    mergeRateByFragments: jest.fn().mockResolvedValue([]),
    usageMergeRateByFragments: jest.fn().mockResolvedValue([]),
    countResolvedTasks: jest.fn().mockResolvedValue(0),
  },
}))
jest.mock('@/lib/ai/embedding', () => ({ embedTexts: jest.fn() }))

import { taskContextService } from '@/lib/services/task-context.service'
import { memoryRepository } from '@/lib/repositories/memory.repository'
import { embedTexts } from '@/lib/ai/embedding'
import { lineageEdgeRepository } from '@/lib/repositories/lineage-edge.repository'
import { taskService } from '@/lib/services/task.service'

const findProjectMemories =
  memoryRepository.findActiveProjectMemories as jest.Mock
const findTaskMemories = memoryRepository.findActiveTaskMemories as jest.Mock
const findNeighborEmbeddings =
  memoryRepository.findNeighborEmbeddings as jest.Mock
const mockEmbedTexts = embedTexts as jest.Mock
const mockMergeRate = lineageEdgeRepository.mergeRateByFragments as jest.Mock

/** Build a raw project-memory row fixture (as returned by the repository). */
const makeProjectMem = (id: string) => ({
  id,
  category: 'CONVENTION' as const,
  content: { summary: `content for ${id}` },
  createdByMemberId: null,
})

/** Build 30 project memory rows with ids m0..m29. */
const corpus30 = () =>
  Array.from({ length: 30 }, (_, i) => makeProjectMem(`m${i}`))

beforeEach(() => {
  jest.clearAllMocks()
  // Reset to safe defaults.
  findProjectMemories.mockResolvedValue([])
  findTaskMemories.mockResolvedValue([])
  mockMergeRate.mockResolvedValue([])
})

describe('buildSessionStartSections — relevance gate on project memories', () => {
  it('gated fragments: only the embedding-selected ids appear in the MEMORY fragment manifest', async () => {
    findProjectMemories.mockResolvedValue(corpus30())
    findTaskMemories.mockResolvedValue([])
    mockEmbedTexts.mockResolvedValue([[0.1, 0.2, 0.3]])
    findNeighborEmbeddings.mockResolvedValue({
      scopeHasEmbeddings: true,
      neighbors: [
        { id: 'm3', category: 'CONVENTION', content: {}, score: 0.9 },
        { id: 'm7', category: 'CONVENTION', content: {}, score: 0.8 },
      ],
    })

    const out = await taskContextService.buildSessionStartSections('t-1')
    const memFragmentIds = out.fragments
      .filter(f => f.fragmentType === 'MEMORY')
      .map(f => f.fragmentId)
      .sort()

    // Only the two gated survivors should be in the manifest — not all 30.
    expect(memFragmentIds).toEqual(['m3', 'm7'])
  })

  it('task memories never gated: task mems survive even when gate yields empty from project side', async () => {
    findProjectMemories.mockResolvedValue(corpus30())
    findTaskMemories.mockResolvedValue([
      makeProjectMem('task-mem-1'),
      makeProjectMem('task-mem-2'),
    ])
    mockEmbedTexts.mockResolvedValue([[0.1, 0.2, 0.3]])
    // Embedding path returns scopeHasEmbeddings:true but zero neighbors above
    // the floor → project memories are gated to 0.
    findNeighborEmbeddings.mockResolvedValue({
      scopeHasEmbeddings: true,
      neighbors: [],
    })

    const out = await taskContextService.buildSessionStartSections('t-1')
    const memFragmentIds = out.fragments
      .filter(f => f.fragmentType === 'MEMORY')
      .map(f => f.fragmentId)

    // Task memories must survive regardless of the project gate outcome.
    expect(memFragmentIds).toContain('task-mem-1')
    expect(memFragmentIds).toContain('task-mem-2')
    // No project memories survived the gate (0 neighbors above floor).
    expect(memFragmentIds).not.toContain('m0')
  })

  it('embedding outage falls back to the full project corpus (no memory dropped)', async () => {
    findProjectMemories.mockResolvedValue(corpus30())
    findTaskMemories.mockResolvedValue([])
    mockMergeRate.mockResolvedValue([])
    // Hard embedding failure — gate must degrade to the full corpus.
    mockEmbedTexts.mockRejectedValue(new Error('no embedding key'))

    const out = await taskContextService.buildSessionStartSections('t-1')
    // Embedding outage → fallback-all → the full project corpus is injected
    // (no worse than the pre-gate behavior; memory is never dropped on an error).
    const memFragmentIds = out.fragments
      .filter(f => f.fragmentType === 'MEMORY')
      .map(f => f.fragmentId)
    expect(memFragmentIds).toHaveLength(30)
  })
})

describe('getContextForIdentifier — relevance gate on project memories (LUM-486 display path)', () => {
  const mockResolveIdentifier = taskService.resolveIdentifier as jest.Mock

  beforeEach(() => {
    // Wire up resolveIdentifier so getContextForIdentifier proceeds past the
    // null guard. taskRepository.findById is already set to return the same
    // task shape at module-mock level.
    mockResolveIdentifier.mockResolvedValue({ id: 't-1', identifier: 'LUM-1' })
  })

  it('gated: only embedding-selected ids appear in the MEMORY fragment manifest', async () => {
    findProjectMemories.mockResolvedValue(corpus30())
    findTaskMemories.mockResolvedValue([])
    mockEmbedTexts.mockResolvedValue([[0.1, 0.2, 0.3]])
    findNeighborEmbeddings.mockResolvedValue({
      scopeHasEmbeddings: true,
      neighbors: [
        { id: 'm3', category: 'CONVENTION', content: {}, score: 0.9 },
        { id: 'm7', category: 'CONVENTION', content: {}, score: 0.8 },
      ],
    })

    const ctx = await taskContextService.getContextForIdentifier(
      'ws-1',
      'member-1',
      'LUM-1'
    )
    // getContextForIdentifier uses { type, id } fragments (not fragmentType/fragmentId)
    const memFragmentIds = (ctx?.fragments ?? [])
      .filter(f => f.type === 'MEMORY')
      .map(f => f.id)
      .sort()

    // Only the two gate-selected ids should appear — not all 30.
    expect(memFragmentIds).toEqual(['m3', 'm7'])
  })

  it('display path: embedding outage falls back to the full project corpus', async () => {
    findProjectMemories.mockResolvedValue(corpus30())
    findTaskMemories.mockResolvedValue([])
    mockMergeRate.mockResolvedValue([])
    // Hard embedding failure — gate must degrade gracefully to the full corpus.
    mockEmbedTexts.mockRejectedValue(new Error('gateway down'))

    const ctx = await taskContextService.getContextForIdentifier(
      'ws-1',
      'member-1',
      'LUM-1'
    )
    // Embedding outage → fallback-all → all 30 project memories survive in the
    // display fragments (no memory dropped on the display path either).
    const memFragmentIds = (ctx?.fragments ?? [])
      .filter(f => f.type === 'MEMORY')
      .map(f => f.id)
    expect(memFragmentIds).toHaveLength(30)
  })
})
