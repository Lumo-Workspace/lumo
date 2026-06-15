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

import { lineageService } from '@/lib/services/lineage.service'
import { lineageEdgeRepository } from '@/lib/repositories/lineage-edge.repository'
import { memoryProvenanceRepository } from '@/lib/repositories/memory-provenance.repository'
import { lineageSourceRepository } from '@/lib/repositories/lineage-source.repository'
import { hookEventRepository } from '@/lib/repositories/hook-event.repository'
import { taskService } from '@/lib/services/task.service'
import { taskRepository } from '@/lib/repositories/task.repository'
import { logger } from '@/lib/logger'

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

beforeEach(() => {
  jest.clearAllMocks()
  mockResolve.mockImplementation(async (_type: string, id: string) => id)
  mockGetStatus.mockResolvedValue('TODO')
  mockLabelsByType.mockResolvedValue(new Map())
  mockFindTurnUsageByTask.mockResolvedValue([])
  mockListByTaskWithCost.mockResolvedValue([])
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
})
