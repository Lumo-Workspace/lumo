import { sessionListService } from '@/lib/services/session-list.service'
import { sessionRepository } from '@/lib/repositories/session.repository'

jest.mock('@/lib/repositories/session.repository', () => ({
  sessionRepository: {
    listForClerkUser: jest.fn(),
    summarizeFamilies: jest.fn(),
    listFamilyAttribution: jest.fn(),
    listChildSessions: jest.fn(),
  },
}))

const repo = sessionRepository as unknown as {
  listForClerkUser: jest.Mock
  summarizeFamilies: jest.Mock
  listFamilyAttribution: jest.Mock
  listChildSessions: jest.Mock
}

const seg = (over: Record<string, unknown>) => ({
  sessionId: 'R',
  parentSessionId: null,
  agentType: null,
  taskIdentifier: 'LUM-1',
  source: 'SESSION_ATTACH',
  confidence: 'EXPLICIT',
  fromTurn: 0,
  toTurn: 1,
  evidence: [],
  ...over,
})

describe('sessionListService', () => {
  beforeEach(() => jest.resetAllMocks())

  it('listForUser maps family counts onto rows', async () => {
    repo.listForClerkUser.mockResolvedValue([
      {
        id: 'R',
        cwd: '/x',
        startedAt: new Date(0),
        lastActivityAt: new Date('2026-10-02T00:00:00Z'),
        eventCount: 4,
        taskId: null,
      },
      {
        id: 'S',
        cwd: null,
        startedAt: new Date(0),
        lastActivityAt: new Date('2026-10-01T00:00:00Z'),
        eventCount: 1,
        taskId: null,
      },
    ])
    repo.summarizeFamilies.mockResolvedValue(
      new Map([['R', { subagentCount: 2, taskIds: ['a', 'b'] }]])
    )
    expect(await sessionListService.listForUser('c1')).toEqual([
      {
        id: 'R',
        cwd: '/x',
        lastActivityAt: '2026-10-02T00:00:00.000Z',
        eventCount: 4,
        subagentCount: 2,
        taskCount: 2,
      },
      {
        id: 'S',
        cwd: null,
        lastActivityAt: '2026-10-01T00:00:00.000Z',
        eventCount: 1,
        subagentCount: 0,
        taskCount: 0,
      },
    ])
  })

  it('getAttribution flags unattributed when the root has no segment', async () => {
    repo.listFamilyAttribution.mockResolvedValue([])
    repo.listChildSessions.mockResolvedValue([{ id: 'R:a1', agentType: 'X' }])
    const v = await sessionListService.getAttribution('R')
    expect(v.unattributed).toBe(true)
    expect(v.approximate).toBe(false)
    expect(v.subagents).toEqual([
      { sessionId: 'R:a1', agentType: 'X', tasks: [] },
    ])
  })

  it('getAttribution is approximate when any segment is INFERRED', async () => {
    repo.listChildSessions.mockResolvedValue([{ id: 'R:a1', agentType: 'X' }])
    repo.listFamilyAttribution.mockResolvedValue([
      seg({ fromTurn: 5, toTurn: 6, taskIdentifier: 'LUM-2' }),
      seg({
        source: 'INFERRED',
        confidence: 'MEDIUM',
        evidence: [{ kind: 'BRANCH', identifier: 'LUM-1', at: 'z' }],
      }),
      seg({
        sessionId: 'R:a1',
        parentSessionId: 'R',
        agentType: 'X',
        taskIdentifier: 'LUM-3',
        source: 'SUBAGENT_ATTACH',
      }),
    ])
    const v = await sessionListService.getAttribution('R')
    expect(v.approximate).toBe(true)
    expect(v.unattributed).toBe(false)
    expect(v.segments.map(s => s.taskIdentifier)).toEqual(['LUM-1', 'LUM-2'])
    expect(v.segments[0]!.evidence).toEqual([
      { kind: 'BRANCH', identifier: 'LUM-1', at: 'z' },
    ])
    expect(v.subagents[0]!.tasks).toEqual([
      {
        taskIdentifier: 'LUM-3',
        source: 'SUBAGENT_ATTACH',
        confidence: 'EXPLICIT',
      },
    ])
  })

  it('getAttribution is exact when every segment is explicit', async () => {
    repo.listChildSessions.mockResolvedValue([])
    repo.listFamilyAttribution.mockResolvedValue([seg({})])
    expect((await sessionListService.getAttribution('R')).approximate).toBe(
      false
    )
  })
})
