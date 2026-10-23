/** @jest-environment node */
jest.mock('@/lib/repositories/lineage-edge.repository', () => ({
  lineageEdgeRepository: {
    createMany: jest.fn().mockResolvedValue({ count: 0 }),
    stampOutcomeByTask: jest.fn().mockResolvedValue({ count: 0 }),
    listByTaskWithCost: jest.fn().mockResolvedValue([]),
  },
}))
jest.mock('@/lib/repositories/memory-provenance.repository', () => ({
  memoryProvenanceRepository: {
    resolveCanonicalFragment: jest.fn(async (_type: string, id: string) => id),
  },
}))
jest.mock('@/lib/repositories/lineage-source.repository', () => ({
  lineageSourceRepository: { labelsByType: jest.fn(async () => new Map()) },
}))
jest.mock('@/lib/repositories/hook-event.repository', () => ({
  hookEventRepository: { findTurnUsageByTask: jest.fn(async () => []) },
}))
jest.mock('@/lib/services/task.service', () => ({
  taskService: { resolveIdentifier: jest.fn() },
}))
jest.mock('@/lib/repositories/task.repository', () => ({
  taskRepository: { getStatus: jest.fn().mockResolvedValue('TODO') },
}))
jest.mock('@/lib/logger', () => ({ logger: { error: jest.fn() } }))
jest.mock('@/lib/repositories/dropped-fragment.repository', () => ({
  droppedFragmentRepository: {
    createMany: jest.fn().mockResolvedValue({ count: 0 }),
  },
}))
// LUM-523: getLineageForIdentifier now dynamically imports operationCostService
// for the Top-5 operations quick view. Mock it so the lineage tests don't pull
// the per-operation attribution graph (hookEventRepository.findToolAttributionEvents
// etc., which these tests don't mock). Default: null → topOperations defaults to [].
jest.mock('@/lib/services/operation-cost.service', () => ({
  operationCostService: { getOperationCost: jest.fn().mockResolvedValue(null) },
}))

import { lineageService, roundedCost } from '@/lib/services/lineage.service'
import { lineageEdgeRepository } from '@/lib/repositories/lineage-edge.repository'
import { memoryProvenanceRepository } from '@/lib/repositories/memory-provenance.repository'
import { lineageSourceRepository } from '@/lib/repositories/lineage-source.repository'
import { hookEventRepository } from '@/lib/repositories/hook-event.repository'
import { taskService } from '@/lib/services/task.service'
import { taskRepository } from '@/lib/repositories/task.repository'
import { logger } from '@/lib/logger'
import { droppedFragmentRepository } from '@/lib/repositories/dropped-fragment.repository'
import { operationCostService } from '@/lib/services/operation-cost.service'
import { formatLineageMarkdown } from '../../cli/src/commands/task-lineage'

const mockCreateMany = lineageEdgeRepository.createMany as jest.Mock
const mockStampOutcomeByTask =
  lineageEdgeRepository.stampOutcomeByTask as jest.Mock
const mockListByTaskWithCost =
  lineageEdgeRepository.listByTaskWithCost as jest.Mock
const mockResolve =
  memoryProvenanceRepository.resolveCanonicalFragment as jest.Mock
const mockLabelsByType = lineageSourceRepository.labelsByType as jest.Mock
const mockFindTurnUsageByTask =
  hookEventRepository.findTurnUsageByTask as jest.Mock
const mockResolveIdentifier = taskService.resolveIdentifier as jest.Mock
const mockGetStatus = taskRepository.getStatus as jest.Mock
const mockGetOperationCost = operationCostService.getOperationCost as jest.Mock

beforeEach(() => {
  jest.clearAllMocks()
  mockResolve.mockImplementation(async (_type: string, id: string) => id)
  mockGetStatus.mockResolvedValue('TODO')
  mockLabelsByType.mockResolvedValue(new Map())
  mockFindTurnUsageByTask.mockResolvedValue([])
  mockListByTaskWithCost.mockResolvedValue([])
  mockGetOperationCost.mockResolvedValue(null)
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

  it('stamps workspace/task/session and leaves outcome unset', async () => {
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

  it('threads the disclosure tag through to createMany (LUM-500)', async () => {
    await lineageService.recordSessionStartEdges({
      workspaceId: 'ws-1',
      taskId: 't-1',
      sessionId: 's-1',
      fragments: [
        { fragmentType: 'MEMORY', fragmentId: 'mem-1', disclosure: 'INDEX' },
        { fragmentType: 'WEB_LINK', fragmentId: 'web-1', disclosure: 'INDEX' },
      ],
    })
    expect(mockCreateMany).toHaveBeenCalledWith([
      expect.objectContaining({ fragmentId: 'mem-1', disclosure: 'INDEX' }),
      expect.objectContaining({ fragmentId: 'web-1', disclosure: 'INDEX' }),
    ])
  })

  it('omits disclosure for an untagged fragment (→ DB default FULL) (LUM-500)', async () => {
    await lineageService.recordSessionStartEdges({
      workspaceId: 'ws-1',
      taskId: 't-1',
      sessionId: 's-1',
      // No disclosure field — e.g. the route's SESSION / review-todo extras.
      fragments: [{ fragmentType: 'SESSION', fragmentId: 'sess-1' }],
    })
    const arg = mockCreateMany.mock.calls[0][0]
    expect(arg).toHaveLength(1)
    expect(arg[0]).not.toHaveProperty('disclosure')
    expect(arg[0]).toMatchObject({
      fragmentType: 'SESSION',
      fragmentId: 'sess-1',
    })
  })

  // CONTRACT-BOUND (LUM-522 C1): proves the write path PERSISTS the token
  // weights + relevance score onto the edge — not merely that
  // buildSessionStartSections constructs fragments carrying them. This is the
  // seam the original test missed: recordSessionStartEdges re-maps fragments,
  // so the fields must be threaded through both the canonicalization map and
  // the createMany map to reach the DB.
  it('persists token weights and relevance score onto edges', async () => {
    await lineageService.recordSessionStartEdges({
      workspaceId: 'ws-1',
      taskId: 't-1',
      sessionId: 's-1',
      fragments: [
        {
          fragmentType: 'MEMORY',
          fragmentId: 'mem-1',
          disclosure: 'INDEX',
          indexTokens: 12,
          fullTokens: 300,
          relevanceScore: 0.81,
        },
        // A resource fragment with no fullTokens (body absent at injection):
        // fullTokens must stay omitted, never fabricated.
        {
          fragmentType: 'WEB_LINK',
          fragmentId: 'web-1',
          disclosure: 'INDEX',
          indexTokens: 7,
        },
      ],
    })
    const arg = mockCreateMany.mock.calls[0][0]
    expect(arg[0]).toMatchObject({
      fragmentId: 'mem-1',
      indexTokens: 12,
      fullTokens: 300,
      relevanceScore: 0.81,
    })
    expect(arg[1]).toMatchObject({ fragmentId: 'web-1', indexTokens: 7 })
    expect(arg[1]).not.toHaveProperty('fullTokens')
    expect(arg[1]).not.toHaveProperty('relevanceScore')
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
      expect.objectContaining({
        fragmentType: 'MEMORY',
        fragmentId: 'mem-project',
      }),
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
    expect(arg[0]).toMatchObject({
      fragmentType: 'MEMORY',
      fragmentId: 'mem-project',
    })
  })

  it('swallows a repository failure (best-effort side effect)', async () => {
    mockCreateMany.mockRejectedValueOnce(new Error('db down'))
    await expect(
      lineageService.recordSessionStartEdges({
        workspaceId: 'ws-1',
        taskId: 't-1',
        sessionId: 's-1',
        fragments: [{ fragmentType: 'PR', fragmentId: 'pr-1' }],
      })
    ).resolves.toBeUndefined()
    expect(logger.error as jest.Mock).toHaveBeenCalled()
  })
})

describe('recordSessionStartEdges — birth-time outcome stamp (LUM-296)', () => {
  const input = {
    workspaceId: 'ws-1',
    taskId: 't-1',
    sessionId: 's-1',
    fragments: [{ fragmentType: 'WEB_LINK' as const, fragmentId: 'web-1' }],
  }

  it('stamps MERGED at birth when the task is already DONE', async () => {
    mockGetStatus.mockResolvedValue('DONE')

    await lineageService.recordSessionStartEdges(input)

    expect(mockCreateMany).toHaveBeenCalledTimes(1)
    expect(mockGetStatus).toHaveBeenCalledWith('t-1')
    expect(mockStampOutcomeByTask).toHaveBeenCalledWith('t-1', 'MERGED')
  })

  it('does NOT stamp when the task is not DONE (edges stay UNKNOWN)', async () => {
    mockGetStatus.mockResolvedValue('IN_PROGRESS')

    await lineageService.recordSessionStartEdges(input)

    expect(mockCreateMany).toHaveBeenCalledTimes(1)
    expect(mockStampOutcomeByTask).not.toHaveBeenCalled()
  })

  it('does NOT stamp for an empty fragment list (returns before any work)', async () => {
    mockGetStatus.mockResolvedValue('DONE')

    await lineageService.recordSessionStartEdges({ ...input, fragments: [] })

    expect(mockCreateMany).not.toHaveBeenCalled()
    expect(mockStampOutcomeByTask).not.toHaveBeenCalled()
  })

  it('swallows a stamp failure (best-effort, never throws)', async () => {
    mockGetStatus.mockResolvedValue('DONE')
    mockStampOutcomeByTask.mockRejectedValueOnce(new Error('db down'))

    await expect(
      lineageService.recordSessionStartEdges(input)
    ).resolves.toBeUndefined()
    expect(logger.error as jest.Mock).toHaveBeenCalled()
  })
})

describe('lineageService.getLineageForIdentifier — session cost (LUM-301)', () => {
  const RESOLVED = {
    id: 't-1',
    identifier: 'LUM-263',
    title: 'Done task',
    status: 'DONE',
  }

  function sessionEdge(over: Record<string, unknown> = {}) {
    return {
      fragmentType: 'MEMORY',
      fragmentId: 'm1',
      includedAt: new Date('2024-01-01T00:00:00Z'),
      outcome: 'MERGED',
      sessionId: 's-1',
      // Cumulative session columns are huge & still growing — the OLD bug source.
      session: {
        id: 's-1',
        inputTokens: 999_999,
        outputTokens: 999_999,
        cacheReadTokens: 999_999,
        cacheCreationTokens: 999_999,
        loopCount: 99,
      },
      ...over,
    }
  }

  beforeEach(() => {
    mockResolveIdentifier.mockResolvedValue(RESOLVED)
    mockLabelsByType.mockResolvedValue(
      new Map([['MEMORY::m1', 'mem headline']])
    )
  })

  it('derives a session group cost from summed per-turn HookEvent deltas, not the cumulative Session total', async () => {
    mockListByTaskWithCost.mockResolvedValue([sessionEdge()])
    // Two STOP turns this session spent ON this task: 10+3 input, 5+1 output, 2 cacheRead, 1 cacheCreation.
    mockFindTurnUsageByTask.mockResolvedValue([
      {
        sessionId: 's-1',
        usageByModel: {
          'claude-x': { input: 10, output: 5, cacheRead: 2, cacheCreation: 1 },
        },
      },
      {
        sessionId: 's-1',
        usageByModel: {
          'claude-x': { input: 3, output: 1, cacheRead: 0, cacheCreation: 0 },
        },
      },
    ])

    const dto = await lineageService.getLineageForIdentifier(
      'ws-1',
      'm-1',
      'LUM-263'
    )

    expect(mockFindTurnUsageByTask).toHaveBeenCalledWith('t-1')
    expect(dto?.totals.tokens).toEqual({
      input: 13,
      output: 6,
      cacheRead: 2,
      cacheCreation: 1,
      total: 22,
    })
    expect(dto?.groups[0]?.cost).toMatchObject({
      input: 13,
      output: 6,
      cacheRead: 2,
      cacheCreation: 1,
      total: 22,
    })
  })

  it('reports the session loop count as the number of per-turn rows for the task, not the cumulative Session.loopCount', async () => {
    mockListByTaskWithCost.mockResolvedValue([sessionEdge()])
    mockFindTurnUsageByTask.mockResolvedValue([
      {
        sessionId: 's-1',
        usageByModel: {
          m: { input: 1, output: 0, cacheRead: 0, cacheCreation: 0 },
        },
      },
      {
        sessionId: 's-1',
        usageByModel: {
          m: { input: 2, output: 0, cacheRead: 0, cacheCreation: 0 },
        },
      },
    ])

    const dto = await lineageService.getLineageForIdentifier(
      'ws-1',
      'm-1',
      'LUM-263'
    )

    // 2 turns this session, NOT the 99 cumulative Session.loopCount.
    expect(dto?.groups[0]?.cost?.loopCount).toBe(2)
    expect(dto?.totals.loopCount).toBe(2)
  })

  it('attributes only the turns belonging to the group session (other sessions excluded)', async () => {
    mockListByTaskWithCost.mockResolvedValue([sessionEdge()])
    mockFindTurnUsageByTask.mockResolvedValue([
      {
        sessionId: 's-1',
        usageByModel: {
          m: { input: 7, output: 0, cacheRead: 0, cacheCreation: 0 },
        },
      },
      // A different session's turn for the same task — must NOT land in s-1's group.
      {
        sessionId: 's-2',
        usageByModel: {
          m: { input: 100, output: 0, cacheRead: 0, cacheCreation: 0 },
        },
      },
    ])

    const dto = await lineageService.getLineageForIdentifier(
      'ws-1',
      'm-1',
      'LUM-263'
    )

    expect(dto?.groups[0]?.cost?.input).toBe(7)
  })

  it('reports zero cost for a session with no captured per-turn deltas (not the cumulative total)', async () => {
    mockListByTaskWithCost.mockResolvedValue([sessionEdge()])
    mockFindTurnUsageByTask.mockResolvedValue([])

    const dto = await lineageService.getLineageForIdentifier(
      'ws-1',
      'm-1',
      'LUM-263'
    )

    // No deltas → cost is null/zero, never the 999_999 cumulative.
    expect(dto?.totals.tokens.total).toBe(0)
  })

  // LUM-559: a session that did work (per-turn cost tagged to this task) but
  // recorded NO lineage edge — it bound after session-start, or its
  // session-start produced no fragments — used to be dropped entirely: its
  // cost lived in costBySession but, keyed only off edges, never surfaced.
  // A DONE task whose only session bound late then read as empty / undercounted.
  it('surfaces a cost-bearing session with no edges in groups and totals', async () => {
    mockListByTaskWithCost.mockResolvedValue([]) // no edges at all
    mockFindTurnUsageByTask.mockResolvedValue([
      {
        sessionId: 's-9',
        createdAt: new Date('2026-06-01T00:00:00Z'),
        usageByModel: {
          'claude-x': { input: 20, output: 4, cacheRead: 1, cacheCreation: 0 },
        },
      },
    ])

    const dto = await lineageService.getLineageForIdentifier(
      'ws-1',
      'm-1',
      'LUM-263'
    )

    // The session surfaces as its own edgeless group …
    expect(dto?.groups).toHaveLength(1)
    expect(dto?.groups[0]).toMatchObject({
      kind: 'session',
      sessionId: 's-9',
      fragments: [],
    })
    expect(dto?.groups[0]?.cost).toMatchObject({
      input: 20,
      output: 4,
      cacheRead: 1,
      cacheCreation: 0,
      total: 25,
      loopCount: 1,
    })
    // … and its tokens are counted in totals (no longer dropped).
    expect(dto?.totals.tokens).toEqual({
      input: 20,
      output: 4,
      cacheRead: 1,
      cacheCreation: 0,
      total: 25,
    })
    expect(dto?.totals.runCount).toBe(1)
    expect(dto?.totals.loopCount).toBe(1)
    expect(dto?.totals.edgeCount).toBe(0)
    expect(dto?.totals.fragmentCount).toBe(0)
  })

  // A session that has BOTH an edge and cost must not be double-counted: it is
  // already grouped off its edge, so the cost-only pass must skip it.
  it('does not double-count a session that has both an edge and cost', async () => {
    mockListByTaskWithCost.mockResolvedValue([sessionEdge()]) // edge for s-1
    mockFindTurnUsageByTask.mockResolvedValue([
      {
        sessionId: 's-1',
        createdAt: new Date('2026-06-01T00:00:00Z'),
        usageByModel: {
          m: { input: 9, output: 0, cacheRead: 0, cacheCreation: 0 },
        },
      },
    ])

    const dto = await lineageService.getLineageForIdentifier(
      'ws-1',
      'm-1',
      'LUM-263'
    )

    expect(dto?.groups).toHaveLength(1)
    expect(dto?.totals.tokens.input).toBe(9)
    expect(dto?.totals.runCount).toBe(1)
  })

  it('maps the top-5 operations from byTool into totals.topOperations (LUM-523)', async () => {
    mockListByTaskWithCost.mockResolvedValue([sessionEdge()])
    mockGetOperationCost.mockResolvedValue({
      byTool: [
        { label: 'Bash', output: 4000, input: 300, cacheCreation: 80, cacheRead: 1000, total: 5380 }, // prettier-ignore
        { label: 'Edit', output: 1000, input: 50, cacheCreation: 20, cacheRead: 200, total: 1270 }, // prettier-ignore
        { label: 'Read', output: 600, input: 30, cacheCreation: 10, cacheRead: 200, total: 840 }, // prettier-ignore
        { label: 'Grep', output: 300, input: 20, cacheCreation: 5, cacheRead: 100, total: 425 }, // prettier-ignore
        { label: 'Write', output: 150, input: 10, cacheCreation: 2, cacheRead: 50, total: 212 }, // prettier-ignore
        { label: 'Glob', output: 40, input: 5, cacheCreation: 1, cacheRead: 10, total: 56 }, // prettier-ignore
      ],
      grandTotal: { input: 415, output: 6090, cacheRead: 1560, cacheCreation: 118, total: 8183 }, // prettier-ignore
      coverage: { toolTurns: 4, perStepTurns: 1, perStepPct: 0.25 },
    })

    const dto = await lineageService.getLineageForIdentifier(
      'ws-1',
      'm-1',
      'LUM-263'
    )

    expect(mockGetOperationCost).toHaveBeenCalledWith('ws-1', {
      kind: 'task',
      identifier: 'LUM-263',
    })
    // Top-5 only, projected to { tool, output, input, cacheCreation, cacheRead, total } (sixth row dropped).
    expect(dto?.totals.topOperations).toEqual([
      { tool: 'Bash', output: 4000, input: 300, cacheCreation: 80, cacheRead: 1000, total: 5380 }, // prettier-ignore
      { tool: 'Edit', output: 1000, input: 50, cacheCreation: 20, cacheRead: 200, total: 1270 }, // prettier-ignore
      { tool: 'Read', output: 600, input: 30, cacheCreation: 10, cacheRead: 200, total: 840 }, // prettier-ignore
      { tool: 'Grep', output: 300, input: 20, cacheCreation: 5, cacheRead: 100, total: 425 }, // prettier-ignore
      { tool: 'Write', output: 150, input: 10, cacheCreation: 2, cacheRead: 50, total: 212 }, // prettier-ignore
    ])
    // LUM-1294: precision of the read-out rides along for the UI note.
    expect(dto?.totals.operationsPrecision).toEqual({
      perStepPct: 0.25,
      cacheReadPct: 1560 / 8183,
      hasToolRows: true,
    })
  })

  it('defaults totals.topOperations to [] when operation cost is null (LUM-523)', async () => {
    mockListByTaskWithCost.mockResolvedValue([sessionEdge()])
    mockGetOperationCost.mockResolvedValue(null)

    const dto = await lineageService.getLineageForIdentifier(
      'ws-1',
      'm-1',
      'LUM-263'
    )

    expect(dto?.totals.topOperations).toEqual([])
    expect(dto?.totals.operationsPrecision).toBeNull()
  })
})

describe('lineageService.recordDroppedFragments', () => {
  it('records gate dropped fragments via the repository', async () => {
    const createMany = jest
      .spyOn(droppedFragmentRepository, 'createMany')
      .mockResolvedValue({ count: 2 })
    await lineageService.recordDroppedFragments({
      workspaceId: 'w',
      taskId: 't',
      sessionId: 's',
      dropped: [
        { fragmentType: 'MEMORY', fragmentId: 'a', relevanceScore: 0.1 },
        { fragmentType: 'MEMORY', fragmentId: 'b', relevanceScore: 0.2 },
      ],
    })
    expect(createMany).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          workspaceId: 'w',
          taskId: 't',
          sessionId: 's',
          fragmentId: 'a',
        }),
      ])
    )
    // best-effort: a repo rejection must not throw
    createMany.mockRejectedValueOnce(new Error('boom'))
    await expect(
      lineageService.recordDroppedFragments({
        workspaceId: 'w',
        taskId: 't',
        sessionId: 's',
        dropped: [
          { fragmentType: 'MEMORY', fragmentId: 'a', relevanceScore: 0.1 },
        ],
      })
    ).resolves.toBeUndefined()
  })
})

describe('getLineageForIdentifier disclosure funnel', () => {
  it('carries per-fragment disclosure/pulled and edge-level totals.funnel', async () => {
    mockResolveIdentifier.mockResolvedValue({
      id: 't-1',
      identifier: 'LUM-1',
      title: 'T',
      status: 'DONE',
    })
    mockListByTaskWithCost.mockResolvedValue([
      {
        fragmentType: 'MEMORY',
        fragmentId: 'm1',
        sessionId: 's1',
        outcome: 'MERGED',
        used: true,
        disclosure: 'INDEX',
        pulledAt: new Date('2026-06-15T00:00:00Z'),
        includedAt: new Date('2026-06-01T00:00:00Z'),
      },
      {
        fragmentType: 'MEMORY',
        fragmentId: 'm2',
        sessionId: 's1',
        outcome: 'MERGED',
        used: null,
        disclosure: 'INDEX',
        pulledAt: null,
        includedAt: new Date('2026-06-01T00:00:00Z'),
      },
      {
        fragmentType: 'PR',
        fragmentId: 'p1',
        sessionId: 's1',
        outcome: 'MERGED',
        used: null,
        disclosure: 'FULL',
        pulledAt: null,
        includedAt: new Date('2026-06-01T00:00:00Z'),
      },
    ])

    const dto = await lineageService.getLineageForIdentifier(
      'ws-1',
      'mem-1',
      'LUM-1'
    )
    expect(dto).not.toBeNull()
    expect(dto!.totals.funnel).toEqual({
      impressions: 3,
      index: 2,
      pulled: 1,
      used: 1,
      voted: 1,
      tokensSaved: null, // no token data in these fixtures → null
    })
    const frags = dto!.groups[0]!.fragments
    const m1 = frags.find(f => f.fragmentId === 'm1')!
    expect(m1.disclosure).toBe('INDEX')
    expect(m1.pulled).toBe(true)
    const m2 = frags.find(f => f.fragmentId === 'm2')!
    expect(m2.disclosure).toBe('INDEX')
    expect(m2.pulled).toBe(false)
    const p1 = frags.find(f => f.fragmentId === 'p1')!
    expect(p1.disclosure).toBe('FULL')
    expect(p1.pulled).toBe(false)
  })
})

describe('getLineageForIdentifier disclosure funnel — tokens saved (LUM-522)', () => {
  const taskStub = {
    id: 't-2',
    identifier: 'LUM-2',
    title: 'Tokens',
    status: 'DONE',
  }

  beforeEach(() => {
    mockResolveIdentifier.mockResolvedValue(taskStub)
  })

  it('funnel summary surfaces tokens saved over unpulled index edges', async () => {
    // Arrange: 3 INDEX edges, pulledAt null, with token data.
    // savings = (300-12) + (250-10) + (200-8) = 288 + 240 + 192 = 720.
    mockListByTaskWithCost.mockResolvedValue([
      {
        fragmentType: 'MEMORY',
        fragmentId: 'ma',
        sessionId: 's2',
        outcome: 'MERGED',
        used: null,
        disclosure: 'INDEX',
        pulledAt: null,
        includedAt: new Date('2026-06-01T00:00:00Z'),
        fullTokens: 300,
        indexTokens: 12,
      },
      {
        fragmentType: 'MEMORY',
        fragmentId: 'mb',
        sessionId: 's2',
        outcome: 'MERGED',
        used: null,
        disclosure: 'INDEX',
        pulledAt: null,
        includedAt: new Date('2026-06-01T00:00:00Z'),
        fullTokens: 250,
        indexTokens: 10,
      },
      {
        fragmentType: 'MEMORY',
        fragmentId: 'mc',
        sessionId: 's2',
        outcome: 'MERGED',
        used: null,
        disclosure: 'INDEX',
        pulledAt: null,
        includedAt: new Date('2026-06-01T00:00:00Z'),
        fullTokens: 200,
        indexTokens: 8,
      },
    ])

    const dto = await lineageService.getLineageForIdentifier(
      'ws-2',
      'mem-2',
      'LUM-2'
    )
    expect(dto).not.toBeNull()
    expect(dto!.totals.funnel.tokensSaved).toBe(720)

    const summaryLine = formatLineageMarkdown(dto!)
    expect(summaryLine).toContain('~720 tokens saved')
  })

  it('omits tokens-saved when no edge carries token data', async () => {
    // Edges with null token columns → tokensSaved must be null and the
    // funnel summary must NOT contain 'tokens saved'.
    mockListByTaskWithCost.mockResolvedValue([
      {
        fragmentType: 'MEMORY',
        fragmentId: 'mx',
        sessionId: 's3',
        outcome: 'MERGED',
        used: null,
        disclosure: 'INDEX',
        pulledAt: null,
        includedAt: new Date('2026-06-01T00:00:00Z'),
        fullTokens: null,
        indexTokens: null,
      },
    ])

    const dto = await lineageService.getLineageForIdentifier(
      'ws-3',
      'mem-3',
      'LUM-2'
    )
    expect(dto).not.toBeNull()
    expect(dto!.totals.funnel.tokensSaved).toBeNull()

    const summaryLine = formatLineageMarkdown(dto!)
    expect(summaryLine).not.toContain('tokens saved')
  })
})

describe('roundedCost', () => {
  it('rounds attributed token figures to whole tokens for display', () => {
    expect(
      roundedCost({
        output: 10.5,
        input: 0.4,
        cacheCreation: 2,
        cacheRead: 16339526.5,
        total: 16339539.4,
      })
    ).toEqual({
      output: 11,
      input: 0,
      cacheCreation: 2,
      cacheRead: 16339527,
      total: 16339539,
    })
  })
})
