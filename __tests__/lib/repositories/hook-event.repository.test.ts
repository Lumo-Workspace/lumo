/**
 * @jest-environment node
 */
jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    hookEvent: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      groupBy: jest.fn(),
    },
  },
}))

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db/prisma'
import { hookEventRepository } from '@/lib/repositories/hook-event.repository'

const mockCreate = prisma.hookEvent.create as jest.Mock
const mockFindMany = prisma.hookEvent.findMany as jest.Mock
const mockGroupBy = prisma.hookEvent.groupBy as jest.Mock

beforeEach(() => {
  jest.clearAllMocks()
})

describe('hookEventRepository.createHookEvent', () => {
  it('inserts a hook event with all fields and returns id', async () => {
    mockCreate.mockResolvedValue({ id: 'he_1' })

    const result = await hookEventRepository.createHookEvent({
      workspaceId: 'ws_1',
      workspaceMemberId: 'wm_1',
      sessionId: 'sess_abc',
      type: 'PRE_TOOL_USE',
      toolName: 'Read',
      filePath: '/tmp/x',
      payload: { tool_name: 'Read', tool_input: { file_path: '/tmp/x' } },
    })

    expect(result).toEqual({ id: 'he_1' })
    expect(mockCreate).toHaveBeenCalledWith({
      data: {
        workspaceId: 'ws_1',
        workspaceMemberId: 'wm_1',
        sessionId: 'sess_abc',
        taskId: null,
        type: 'PRE_TOOL_USE',
        toolName: 'Read',
        toolDetail: null,
        toolVerb: null,
        filePath: '/tmp/x',
        toolUseId: null,
        promptTaskNotification: false,
        payload: { tool_name: 'Read', tool_input: { file_path: '/tmp/x' } },
        usageByModel: Prisma.DbNull,
        attributionSignals: Prisma.DbNull,
      },
      select: { id: true },
    })
  })

  it('writes an empty signals array as JSON, not SQL NULL', async () => {
    mockCreate.mockResolvedValue({ id: 'he_4' })
    await hookEventRepository.createHookEvent({
      workspaceId: 'ws_1',
      workspaceMemberId: 'wm_1',
      type: 'STOP',
      toolName: null,
      payload: {},
      attributionSignals: [],
    })
    expect(mockCreate.mock.calls[0]![0].data.attributionSignals).toEqual([])
  })

  it('defaults filePath to null when omitted', async () => {
    mockCreate.mockResolvedValue({ id: 'he_3' })

    await hookEventRepository.createHookEvent({
      workspaceId: 'ws_1',
      workspaceMemberId: 'wm_1',
      type: 'STOP',
      toolName: null,
      payload: { reason: 'user' },
    })

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ filePath: null }),
      })
    )
  })

  it('allows null toolName for Stop events', async () => {
    mockCreate.mockResolvedValue({ id: 'he_2' })

    await hookEventRepository.createHookEvent({
      workspaceId: 'ws_1',
      workspaceMemberId: 'wm_1',
      type: 'STOP',
      toolName: null,
      payload: { reason: 'user-ctrl-c' },
    })

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ toolName: null }),
      })
    )
  })
})

describe('hookEventRepository.findRecentOtherSessionWritesToFile', () => {
  const since = new Date('2026-06-01T11:30:00Z')

  it('queries by workspace + file + window, excluding the current session, filtered to write tools', async () => {
    mockFindMany.mockResolvedValue([])

    await hookEventRepository.findRecentOtherSessionWritesToFile({
      workspaceId: 'ws_1',
      filePath: '/repo/app/a.ts',
      excludeSessionFamilyRoot: 'sess_self',
      since,
      toolNames: ['Edit', 'Write', 'MultiEdit', 'NotebookEdit'],
    })

    expect(mockFindMany).toHaveBeenCalledWith({
      where: {
        workspaceId: 'ws_1',
        filePath: '/repo/app/a.ts',
        sessionId: { not: null },
        NOT: [
          { sessionId: 'sess_self' },
          { sessionId: { startsWith: 'sess_self:' } },
        ],
        createdAt: { gte: since },
        toolName: { in: ['Edit', 'Write', 'MultiEdit', 'NotebookEdit'] },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        sessionId: true,
        toolName: true,
        createdAt: true,
        session: {
          select: { agent: true, worktree: { select: { branch: true } } },
        },
      },
    })
  })

  it('returns the matching rows verbatim', async () => {
    const rows = [
      {
        sessionId: 'sess_other',
        toolName: 'Edit',
        createdAt: new Date('2026-06-01T11:55:00Z'),
        session: { agent: 'CODEX', worktree: { branch: 'lumo/LUM-9-x' } },
      },
    ]
    mockFindMany.mockResolvedValue(rows)

    const result = await hookEventRepository.findRecentOtherSessionWritesToFile(
      {
        workspaceId: 'ws_1',
        filePath: '/repo/app/a.ts',
        excludeSessionFamilyRoot: 'sess_self',
        since,
        toolNames: ['Edit'],
      }
    )

    expect(result).toEqual(rows)
  })
})

describe('hookEventRepository.findTurnUsageByTask', () => {
  it('queries STOP/STOP_FAILURE turns for the task (own-taskId precedence) and selects only sessionId + usageByModel + createdAt', async () => {
    mockFindMany.mockResolvedValue([])

    await hookEventRepository.findTurnUsageByTask('tsk_1')

    expect(mockFindMany).toHaveBeenCalledWith({
      where: {
        type: { in: ['STOP', 'STOP_FAILURE'] },
        OR: [
          { taskId: 'tsk_1' },
          { taskId: null, session: { taskId: 'tsk_1' } },
        ],
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { sessionId: true, usageByModel: true, createdAt: true },
    })
  })

  it('returns the per-turn delta rows verbatim', async () => {
    const rows = [
      {
        sessionId: 'sess_1',
        usageByModel: {
          'claude-x': { input: 10, output: 5, cacheRead: 2, cacheCreation: 1 },
        },
      },
    ]
    mockFindMany.mockResolvedValue(rows)

    const result = await hookEventRepository.findTurnUsageByTask('tsk_1')

    expect(result).toEqual(rows)
  })
})

// ── groupTaskFilesTouched ─────────────────────────────────────────────────────

describe('hookEventRepository.groupTaskFilesTouched', () => {
  it('groups by workspaceId/taskId/filePath with correct where filters', async () => {
    const since = new Date('2026-06-01T00:00:00Z')
    mockGroupBy.mockResolvedValueOnce([])

    await hookEventRepository.groupTaskFilesTouched({
      since,
      toolNames: ['Edit', 'Write'],
    })

    expect(mockGroupBy).toHaveBeenCalledWith({
      by: ['workspaceId', 'taskId', 'filePath'],
      where: {
        createdAt: { gte: since },
        taskId: { not: null },
        filePath: { not: null },
        toolName: { in: ['Edit', 'Write'] },
      },
    })
  })
})

describe('hookEventRepository.findTurnBoundaryEventsForSessions', () => {
  it('returns [] without querying when no session ids', async () => {
    const out = await hookEventRepository.findTurnBoundaryEventsForSessions([])
    expect(out).toEqual([])
    expect(mockFindMany).not.toHaveBeenCalled()
  })

  it('queries turn-boundary and in-turn activity types for the given sessions, oldest-first', async () => {
    mockFindMany.mockResolvedValue([])
    await hookEventRepository.findTurnBoundaryEventsForSessions(['s1', 's2'])
    expect(mockFindMany).toHaveBeenCalledWith({
      where: {
        sessionId: { in: ['s1', 's2'] },
        type: {
          in: [
            'USER_PROMPT_SUBMIT',
            'STOP',
            'STOP_FAILURE',
            'PRE_TOOL_USE',
            'POST_TOOL_USE',
            'POST_TOOL_USE_FAILURE',
            'POST_TOOL_BATCH',
            'SUBAGENT_START',
            'SUBAGENT_STOP',
            'PERMISSION_REQUEST',
            'PERMISSION_DENIED',
            'NOTIFICATION',
            'ELICITATION',
            'ELICITATION_RESULT',
          ],
        },
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { sessionId: true, type: true, createdAt: true, taskId: true },
    })
  })
})

describe('findToolAttributionEvents', () => {
  it('scopes by task with the findByTaskId precedence and the attribution event types', async () => {
    mockFindMany.mockResolvedValue([])
    await hookEventRepository.findToolAttributionEvents({ taskId: 't1' })
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          type: {
            in: [
              'POST_TOOL_USE',
              'POST_TOOL_USE_FAILURE',
              'POST_TOOL_BATCH',
              'STOP',
              'STOP_FAILURE',
              // LUM-932: a child session's settled usage lives on its
              // SUBAGENT_STOP row; child events carry the task id, so the
              // task scope folds subagent cost in.
              'SUBAGENT_STOP',
            ],
          },
          OR: [{ taskId: 't1' }, { taskId: null, session: { taskId: 't1' } }],
        }),
      })
    )
  })

  it('scopes by a single session and is workspace-scoped to block cross-workspace reads', async () => {
    mockFindMany.mockResolvedValue([])
    await hookEventRepository.findToolAttributionEvents({
      sessionId: 's9',
      workspaceId: 'w1',
    })
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ sessionId: 's9', workspaceId: 'w1' }),
      })
    )
  })

  it('scopes by a workspace window', async () => {
    mockFindMany.mockResolvedValue([])
    const since = new Date('2026-06-01T00:00:00Z')
    await hookEventRepository.findToolAttributionEvents({
      workspaceId: 'w1',
      since,
    })
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          workspaceId: 'w1',
          createdAt: { gte: since },
        }),
      })
    )
  })

  it('orders per session by time and selects the attribution projection', async () => {
    mockFindMany.mockResolvedValue([])
    await hookEventRepository.findToolAttributionEvents({
      sessionId: 's9',
      workspaceId: 'w1',
    })
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ sessionId: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
        select: {
          sessionId: true,
          workspaceMemberId: true,
          taskId: true,
          type: true,
          toolName: true,
          toolDetail: true,
          toolVerb: true,
          usageByModel: true,
          createdAt: true,
        },
      })
    )
  })
})

describe('hookEventRepository.findCommandsByIds LUM-873', () => {
  it('omits a command stored as a used-up summary', async () => {
    mockFindMany.mockResolvedValue([
      { id: 'he_full', payload: { tool_input: { command: 'git push' } } },
      {
        id: 'he_summary',
        payload: {
          tool_input: { command: "cat > a.ts <<'EOF'\n…\nEOF" },
          _lumo_redacted: {
            'tool_input.command': { bytes: 40, lines: 4, sha256: 'x' },
          },
        },
      },
    ])
    const out = await hookEventRepository.findCommandsByIds([
      'he_full',
      'he_summary',
    ])
    expect([...out.entries()]).toEqual([['he_full', 'git push']])
  })
})
