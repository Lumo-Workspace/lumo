/** @jest-environment node */
import { lineageService } from '@/lib/services/lineage.service'

jest.mock('@/lib/services/task.service', () => ({
  taskService: {
    resolveIdentifier: jest.fn(),
  },
}))
jest.mock('@/lib/repositories/lineage-edge.repository', () => ({
  lineageEdgeRepository: { listByTaskWithCost: jest.fn() },
}))
jest.mock('@/lib/repositories/memory-provenance.repository', () => ({
  memoryProvenanceRepository: { resolveCanonicalFragment: jest.fn() },
}))
jest.mock('@/lib/repositories/lineage-source.repository', () => ({
  lineageSourceRepository: { labelsByType: jest.fn() },
}))
jest.mock('@/lib/repositories/hook-event.repository', () => ({
  hookEventRepository: { findTurnUsageByTask: jest.fn() },
}))

import { taskService } from '@/lib/services/task.service'
import { lineageEdgeRepository } from '@/lib/repositories/lineage-edge.repository'
import { memoryProvenanceRepository } from '@/lib/repositories/memory-provenance.repository'
import { lineageSourceRepository } from '@/lib/repositories/lineage-source.repository'
import { hookEventRepository } from '@/lib/repositories/hook-event.repository'

const mockResolve = taskService.resolveIdentifier as jest.Mock
const mockEdges = lineageEdgeRepository.listByTaskWithCost as jest.Mock
const mockCanon =
  memoryProvenanceRepository.resolveCanonicalFragment as jest.Mock
const mockLabels = lineageSourceRepository.labelsByType as jest.Mock
const mockTurnUsage = hookEventRepository.findTurnUsageByTask as jest.Mock

const RUN_COST = {
  inputTokens: 1000,
  outputTokens: 500,
  cacheReadTokens: 200,
  cacheCreationTokens: 100,
  loopCount: 4,
}

beforeEach(() => {
  jest.clearAllMocks()
  mockTurnUsage.mockResolvedValue([])
  mockResolve.mockResolvedValue({
    id: 'tsk_1',
    identifier: 'LUM-1',
    title: 'T',
    status: 'DONE',
  })
  mockCanon.mockImplementation(async (_t: string, id: string) =>
    id === 'mem-old' ? 'mem-new' : id
  )
  mockLabels.mockResolvedValue(
    new Map([
      ['MEMORY::mem-new', '[PROJECT] canonical memory'],
      ['PR::pr-1', '#42 Add table'],
    ])
  )
})

it('returns null when the identifier does not resolve', async () => {
  mockResolve.mockResolvedValue(null)
  const dto = await lineageService.getLineageForIdentifier(
    'ws',
    'mem',
    'LUM-404'
  )
  expect(dto).toBeNull()
})

it('counts a run cost ONCE even when the run injected multiple fragments', async () => {
  mockEdges.mockResolvedValue([
    {
      fragmentType: 'MEMORY',
      fragmentId: 'mem-old',
      runId: 'run-1',
      sessionId: 's-1',
      outcome: 'MERGED',
      includedAt: new Date('2026-06-01T00:00:00Z'),
      run: { id: 'run-1', ...RUN_COST },
      session: null,
    },
    {
      fragmentType: 'PR',
      fragmentId: 'pr-1',
      runId: 'run-1',
      sessionId: 's-1',
      outcome: 'MERGED',
      includedAt: new Date('2026-06-01T00:01:00Z'),
      run: { id: 'run-1', ...RUN_COST },
      session: null,
    },
  ])

  const dto = await lineageService.getLineageForIdentifier('ws', 'mem', 'LUM-1')

  expect(dto).not.toBeNull()
  expect(dto!.groups).toHaveLength(1)
  expect(dto!.groups[0]!.kind).toBe('run')
  expect(dto!.groups[0]!.fragments).toHaveLength(2)
  // cost attributed once: 1000+500+200+100 = 1800, not doubled
  expect(dto!.totals.tokens.total).toBe(1800)
  expect(dto!.totals.loopCount).toBe(4)
  expect(dto!.totals.runCount).toBe(1)
  expect(dto!.totals.edgeCount).toBe(2)
})

it('applies canonical fragment resolution and source labels', async () => {
  mockEdges.mockResolvedValue([
    {
      fragmentType: 'MEMORY',
      fragmentId: 'mem-old',
      runId: 'run-1',
      sessionId: null,
      outcome: 'MERGED',
      includedAt: new Date('2026-06-01T00:00:00Z'),
      run: { id: 'run-1', ...RUN_COST },
      session: null,
    },
  ])
  const dto = await lineageService.getLineageForIdentifier('ws', 'mem', 'LUM-1')
  const frag = dto!.groups[0]!.fragments[0]!
  expect(frag.fragmentId).toBe('mem-new') // drift-resolved
  expect(frag.sourceLabel).toBe('[PROJECT] canonical memory')
})

it('uses a fallback label when the source row is gone, and sources session cost from per-turn deltas (LUM-301)', async () => {
  mockLabels.mockResolvedValue(new Map())
  mockEdges.mockResolvedValue([
    // Session column totals are intentionally huge & ignored — cost must come
    // from the summed per-turn deltas below, not these cumulative columns.
    {
      fragmentType: 'WEB_LINK',
      fragmentId: 'web-gone',
      runId: null,
      sessionId: 's-1',
      outcome: 'UNKNOWN',
      includedAt: new Date('2026-06-01T00:00:00Z'),
      run: null,
      session: {
        id: 's-1',
        inputTokens: 9_000_000,
        outputTokens: 9_000_000,
        cacheReadTokens: 9_000_000,
        cacheCreationTokens: 9_000_000,
        loopCount: 99,
      },
    },
  ])
  mockTurnUsage.mockResolvedValue([
    {
      sessionId: 's-1',
      usageByModel: {
        m: { input: 1000, output: 500, cacheRead: 200, cacheCreation: 100 },
      },
    },
  ])
  const dto = await lineageService.getLineageForIdentifier('ws', 'mem', 'LUM-1')
  expect(dto!.groups[0]!.kind).toBe('session')
  expect(dto!.groups[0]!.fragments[0]!.sourceLabel).toBe(
    'WEB_LINK (source removed)'
  )
  expect(dto!.totals.tokens.total).toBe(1800) // summed per-turn deltas, not the 36M cumulative
})

it('returns empty groups for a task with no edges', async () => {
  mockEdges.mockResolvedValue([])
  mockLabels.mockResolvedValue(new Map())
  const dto = await lineageService.getLineageForIdentifier('ws', 'mem', 'LUM-1')
  expect(dto!.groups).toEqual([])
  expect(dto!.totals.edgeCount).toBe(0)
  expect(dto!.totals.runCount).toBe(0)
})

it('puts edges with no run or session in an orphan group with null cost, excluded from runCount', async () => {
  mockLabels.mockResolvedValue(
    new Map([['SLACK_CONTEXT::slack-1', '#general']])
  )
  mockEdges.mockResolvedValue([
    {
      fragmentType: 'SLACK_CONTEXT',
      fragmentId: 'slack-1',
      runId: null,
      sessionId: null,
      outcome: 'UNKNOWN',
      includedAt: new Date('2026-06-01T00:00:00Z'),
      run: null,
      session: null,
    },
  ])
  const dto = await lineageService.getLineageForIdentifier('ws', 'mem', 'LUM-1')
  expect(dto!.groups).toHaveLength(1)
  expect(dto!.groups[0]!.kind).toBe('orphan')
  expect(dto!.groups[0]!.cost).toBeNull()
  expect(dto!.groups[0]!.label).toBe('Unattributed')
  expect(dto!.totals.runCount).toBe(0)
  expect(dto!.totals.tokens.total).toBe(0)
})

it('deduplicates fragmentCount across groups while edgeCount counts every edge', async () => {
  mockLabels.mockResolvedValue(
    new Map([['MEMORY::mem-new', '[PROJECT] canonical memory']])
  )
  mockEdges.mockResolvedValue([
    {
      fragmentType: 'MEMORY',
      fragmentId: 'mem-old',
      runId: 'run-1',
      sessionId: null,
      outcome: 'MERGED',
      includedAt: new Date('2026-06-01T00:00:00Z'),
      run: {
        id: 'run-1',
        inputTokens: 1000,
        outputTokens: 500,
        cacheReadTokens: 200,
        cacheCreationTokens: 100,
        loopCount: 4,
      },
      session: null,
    },
    {
      fragmentType: 'MEMORY',
      fragmentId: 'mem-new',
      runId: 'run-2',
      sessionId: null,
      outcome: 'REWORKED',
      includedAt: new Date('2026-06-02T00:00:00Z'),
      run: {
        id: 'run-2',
        inputTokens: 1000,
        outputTokens: 500,
        cacheReadTokens: 200,
        cacheCreationTokens: 100,
        loopCount: 4,
      },
      session: null,
    },
  ])
  const dto = await lineageService.getLineageForIdentifier('ws', 'mem', 'LUM-1')
  // mem-old canonicalizes to mem-new (see beforeEach), so both edges point at one fragment
  expect(dto!.totals.edgeCount).toBe(2)
  expect(dto!.totals.fragmentCount).toBe(1)
  expect(dto!.totals.runCount).toBe(2)
  expect(dto!.totals.tokens.total).toBe(3600) // two distinct runs, each 1800
  expect(dto!.totals.outcomes.MERGED).toBe(1)
  expect(dto!.totals.outcomes.REWORKED).toBe(1)
})

it('carries the edge used field onto the fragment entry', async () => {
  mockLabels.mockResolvedValue(new Map([['MEMORY::mem-new', 'some memory']]))
  mockEdges.mockResolvedValue([
    {
      fragmentType: 'MEMORY',
      fragmentId: 'mem-new',
      runId: 'run-1',
      sessionId: null,
      outcome: 'MERGED',
      used: true,
      includedAt: new Date('2026-06-01T00:00:00Z'),
      run: { id: 'run-1', ...RUN_COST },
      session: null,
    },
  ])
  const dto = await lineageService.getLineageForIdentifier('ws', 'mem', 'LUM-1')
  expect(dto!.groups[0]!.fragments[0]!.used).toBe(true)
})
