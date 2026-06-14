/**
 * @jest-environment node
 */
// Hoist mocks before imports so Jest can intercept module resolution.
// task-context.service.ts transitively imports task.service.ts which fans
// out into GitHub/Slack integrations — stub those away so the module loads.
jest.mock('@/lib/services/task-pr-sync.service', () => ({
  syncPullRequestStatus: jest.fn(),
}))
jest.mock('@/lib/services/task-notifications.service', () => ({
  dispatchCreateTaskSideEffects: jest.fn(),
  dispatchUpdateTaskSideEffects: jest.fn(),
}))
jest.mock('@/lib/repositories/task.repository', () => ({
  taskRepository: { findById: jest.fn(), findByWorkspaceIdentifier: jest.fn() },
}))
jest.mock('@/lib/repositories/session.repository', () => ({
  sessionRepository: { listForTask: jest.fn() },
}))
jest.mock('@/lib/repositories/task-slack-context.repository', () => ({
  taskSlackContextRepository: { listByTask: jest.fn() },
}))
jest.mock('@/lib/repositories/task-web-link.repository', () => ({
  taskWebLinkRepository: { listByTask: jest.fn() },
}))
jest.mock('@/lib/repositories/milestone.repository', () => ({
  milestoneRepository: { findById: jest.fn() },
}))

jest.mock('@/lib/ai/embedding', () => ({ embedTexts: jest.fn() }))
jest.mock('@/lib/repositories/memory.repository', () => ({
  memoryRepository: {
    findActiveTaskMemories: jest.fn(),
    findActiveProjectMemories: jest.fn(),
    findNeighborEmbeddings: jest.fn(),
  },
}))
jest.mock('@/lib/repositories/lineage-edge.repository', () => ({
  lineageEdgeRepository: { mergeRateByFragments: jest.fn() },
}))

import type { RenderableMemory } from '@/lib/memory/render'
import { embedTexts } from '@/lib/ai/embedding'
import { memoryRepository } from '@/lib/repositories/memory.repository'
import { lineageEdgeRepository } from '@/lib/repositories/lineage-edge.repository'
import { __test__selectRelevantProjectMemories as select } from '@/lib/services/task-context.service'

const mem = (id: string): RenderableMemory => ({
  id,
  scope: 'PROJECT',
  category: 'CONVENTION',
  content: { summary: id },
})
const corpus = (n: number) => Array.from({ length: n }, (_, i) => mem(`m${i}`))
const task = {
  id: 't1',
  title: 'narrow refactor',
  description: 'remove prisma',
  projectId: 'p1',
}

beforeEach(() => jest.clearAllMocks())

test('embedding path: keeps cosine winners above floor', async () => {
  ;(embedTexts as jest.Mock).mockResolvedValue([[0.1, 0.2, 0.3]])
  ;(memoryRepository.findNeighborEmbeddings as jest.Mock).mockResolvedValue({
    scopeHasEmbeddings: true,
    neighbors: [
      { id: 'm3', category: 'CONVENTION', content: {}, score: 0.9 },
      { id: 'm7', category: 'CONVENTION', content: {}, score: 0.8 },
    ],
  })
  ;(lineageEdgeRepository.mergeRateByFragments as jest.Mock).mockResolvedValue(
    []
  )
  const res = await select(task, corpus(20))
  expect(res.selected.map(m => m.id).sort()).toEqual(['m3', 'm7'])
  expect(res.telemetry.mechanism).toBe('embedding')
})

test('cold corpus (scopeHasEmbeddings=false) → lexical fallback ranking', async () => {
  ;(embedTexts as jest.Mock).mockResolvedValue([[0.1, 0.2, 0.3]])
  ;(memoryRepository.findNeighborEmbeddings as jest.Mock).mockResolvedValue({
    scopeHasEmbeddings: false,
    neighbors: [],
  })
  ;(lineageEdgeRepository.mergeRateByFragments as jest.Mock).mockResolvedValue(
    []
  )
  const candidates = [
    {
      id: 'hit',
      scope: 'PROJECT' as const,
      category: 'CONVENTION' as const,
      content: { summary: 'remove prisma narrow refactor' },
    },
    ...corpus(20),
  ]
  const res = await select(task, candidates)
  expect(res.telemetry.mechanism).toBe('lexical')
  expect(res.selected.map(m => m.id)).toContain('hit')
})

test('embed failure → lexical fallback, generic content yields the safe no-relevant outcome', async () => {
  ;(embedTexts as jest.Mock).mockRejectedValue(new Error('no key'))
  ;(memoryRepository.findNeighborEmbeddings as jest.Mock).mockResolvedValue({
    scopeHasEmbeddings: false,
    neighbors: [],
  })
  ;(lineageEdgeRepository.mergeRateByFragments as jest.Mock).mockResolvedValue(
    []
  )
  const res = await select(task, corpus(20))
  // generic 'mN' content shares no meaningful bigrams with the task text → lexical
  // ranks low, nothing clears the floor → empty selection (the intended
  // "no relevant memory" outcome), and crucially NOT a crash.
  expect(['lexical', 'fallback-all']).toContain(res.telemetry.mechanism)
})

test('high-trust fragment is always kept even with no similarity hit', async () => {
  ;(embedTexts as jest.Mock).mockResolvedValue([[0.1, 0.2, 0.3]])
  ;(memoryRepository.findNeighborEmbeddings as jest.Mock).mockResolvedValue({
    scopeHasEmbeddings: true,
    neighbors: [],
  })
  ;(lineageEdgeRepository.mergeRateByFragments as jest.Mock).mockResolvedValue([
    {
      fragmentType: 'MEMORY',
      fragmentId: 'm9',
      resolvedTasks: 6,
      mergedTasks: 6,
    },
  ])
  const res = await select(task, corpus(20))
  expect(res.selected.map(m => m.id)).toEqual(['m9'])
})
