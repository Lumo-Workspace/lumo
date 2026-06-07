/**
 * @jest-environment node
 */

jest.mock('@/lib/repositories/session.repository', () => ({
  sessionRepository: {
    listForTask: jest.fn(),
  },
}))

jest.mock('@/lib/repositories/hook-event.repository', () => ({
  hookEventRepository: {
    findByTaskId: jest.fn(),
  },
}))

jest.mock('@/lib/repositories/memory.repository', () => ({
  memoryRepository: {
    findByTaskIdWithSession: jest.fn(),
  },
}))

import { sessionRepository } from '@/lib/repositories/session.repository'
import { hookEventRepository } from '@/lib/repositories/hook-event.repository'
import { memoryRepository } from '@/lib/repositories/memory.repository'
import { agentRunTimelineService } from '@/lib/services/agent-run-timeline.service'

const mockListSessions = sessionRepository.listForTask as jest.Mock
const mockFindEvents = hookEventRepository.findByTaskId as jest.Mock
const mockFindMemories =
  memoryRepository.findByTaskIdWithSession as jest.Mock

beforeEach(() => jest.clearAllMocks())

describe('agentRunTimelineService.getTimeline — agent identity', () => {
  it('passes the session agent through, and defaults the orphan bucket to CLAUDE_CODE', async () => {
    mockListSessions.mockResolvedValue([
      {
        id: 's1',
        agent: 'CODEX',
        startedAt: new Date('2026-01-01T10:00:00Z'),
        lastActivityAt: new Date('2026-01-01T10:30:00Z'),
        eventCount: 1,
        summary: null,
        summaryType: null,
        summaryGeneratedAt: null,
      },
    ])
    mockFindEvents.mockResolvedValue([
      {
        id: 'e1',
        sessionId: 's1',
        type: 'PRE_TOOL_USE',
        toolName: 'Bash',
        payload: {},
        turnSummary: null,
        createdAt: new Date('2026-01-01T10:05:00Z'),
      },
      {
        id: 'e2',
        sessionId: 'no-such-session',
        type: 'PRE_TOOL_USE',
        toolName: 'Read',
        payload: {},
        turnSummary: null,
        createdAt: new Date('2026-01-01T09:00:00Z'),
      },
    ])
    mockFindMemories.mockResolvedValue([])

    const { runs } = await agentRunTimelineService.getTimeline('task-1')

    const linked = runs.find(r => r.sessionId === 's1')
    expect(linked).toBeDefined()
    expect(linked!.agent).toBe('CODEX')

    const orphan = runs.find(r => r.sessionId === null)
    expect(orphan).toBeDefined()
    expect(orphan!.agent).toBe('CLAUDE_CODE')
    // The orphan run only survives the service's nonEmptyRuns filter because
    // its PRE_TOOL_USE event gives it toolCallCount > 0 — assert that here so
    // the test fails loudly if the filter or event-type mapping ever changes.
    expect(orphan!.toolCallCount).toBeGreaterThan(0)
  })
})
