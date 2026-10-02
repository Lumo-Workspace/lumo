/**
 * @jest-environment node
 */
jest.mock('@/lib/repositories/task.repository', () => ({
  taskRepository: { findById: jest.fn(), findByWorkspaceIdentifier: jest.fn() },
}))
jest.mock('@/lib/repositories/memory.repository', () => ({
  memoryRepository: {
    findActiveTaskMemories: jest.fn(),
    findActiveProjectMemories: jest.fn(),
  },
}))
jest.mock('@/lib/repositories/session.repository', () => ({
  sessionRepository: { listForTask: jest.fn() },
}))
jest.mock('@/lib/repositories/hook-event.repository', () => ({
  hookEventRepository: {
    findTurnBoundaryEventsForSessions: jest.fn().mockResolvedValue([]),
  },
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
jest.mock('@/lib/repositories/project.repository', () => ({
  projectRepository: {},
}))
jest.mock('@/lib/repositories/pull-request.repository', () => ({
  pullRequestRepository: {},
}))
jest.mock('@/lib/repositories/tag.repository', () => ({ tagRepository: {} }))
jest.mock('@/lib/repositories/github.repository', () => ({
  githubRepository: {},
}))
jest.mock('@/lib/repositories/activity.repository', () => ({
  activityRepository: {},
}))
jest.mock('@/lib/services/task-pr-sync.service', () => ({
  syncPullRequestStatus: jest.fn(),
}))
jest.mock('@/lib/services/task-notifications.service', () => ({
  dispatchCreateTaskSideEffects: jest.fn(),
  dispatchUpdateTaskSideEffects: jest.fn(),
}))

import { taskContextService } from '@/lib/services/task-context.service'
import { sessionRepository } from '@/lib/repositories/session.repository'
import { hookEventRepository } from '@/lib/repositories/hook-event.repository'

const mockListForTask = sessionRepository.listForTask as jest.Mock
const mockTurnEvents =
  hookEventRepository.findTurnBoundaryEventsForSessions as jest.Mock

const turn = (sessionId: string, promptAt: string, stopAt: string) => [
  { sessionId, type: 'USER_PROMPT_SUBMIT', createdAt: new Date(promptAt) },
  { sessionId, type: 'STOP', createdAt: new Date(stopAt) },
]

function row(
  over: Partial<{
    id: string
    startedAt: Date
    lastActivityAt: Date
    summary: unknown
  }>
) {
  return {
    id: over.id ?? 's-x',
    startedAt: over.startedAt ?? new Date('2026-06-01T10:00:00Z'),
    lastActivityAt: over.lastActivityAt ?? new Date('2026-06-01T10:23:00Z'),
    eventCount: 1,
    summary: over.summary ?? null,
    summaryType: 'implementation',
    summaryGeneratedAt: new Date('2026-06-01T10:23:00Z'),
  }
}

describe('buildPreviousSessionRecoveryForTask', () => {
  beforeEach(() => jest.clearAllMocks())

  it('returns null when the task has no sessions', async () => {
    mockListForTask.mockResolvedValue([])
    const out = await taskContextService.buildPreviousSessionRecoveryForTask(
      't1',
      'cur'
    )
    expect(out).toBeNull()
  })

  it('returns null when no session has a summary', async () => {
    mockListForTask.mockResolvedValue([
      row({ id: 'a', summary: null }),
      row({ id: 'b', summary: {} }),
    ])
    const out = await taskContextService.buildPreviousSessionRecoveryForTask(
      't1',
      'cur'
    )
    expect(out).toBeNull()
  })

  it('excludes the current session and picks the next one with a summary', async () => {
    mockListForTask.mockResolvedValue([
      row({
        id: 'cur',
        summary: { goal: 'should be skipped', unresolved: ['x'] },
      }),
      row({
        id: 'prev',
        summary: { goal: 'real headline', unresolved: ['finish API'] },
      }),
    ])
    mockTurnEvents.mockResolvedValue(
      turn('prev', '2026-06-01T10:00:00Z', '2026-06-01T10:00:45Z')
    )
    const out = await taskContextService.buildPreviousSessionRecoveryForTask(
      't1',
      'cur'
    )
    expect(out).toEqual({
      sessionId: 'prev',
      headline: 'real headline',
      unresolved: ['finish API'],
      durationMs: 45_000,
      lastActivityAt: '2026-06-01T10:23:00.000Z',
    })
  })

  it('skips an unattached session inferred onto the task (its summary may cover other tasks)', async () => {
    mockListForTask.mockResolvedValue([
      {
        ...row({
          id: 'multi',
          summary: { goal: 'other tasks', unresolved: [] },
        }),
        inferred: true,
      },
      {
        ...row({
          id: 'own',
          summary: { goal: 'own headline', unresolved: [] },
        }),
        inferred: false,
      },
    ])
    const out = await taskContextService.buildPreviousSessionRecoveryForTask(
      't1',
      'cur'
    )
    expect(out?.sessionId).toBe('own')
    expect(out?.headline).toBe('own headline')
  })

  it('walks back past a summary-less recent session to an older one with a summary', async () => {
    mockListForTask.mockResolvedValue([
      row({ id: 'recent', summary: null }),
      row({ id: 'older', summary: { goal: 'older headline', unresolved: [] } }),
    ])
    const out = await taskContextService.buildPreviousSessionRecoveryForTask(
      't1',
      'cur'
    )
    expect(out?.headline).toBe('older headline')
    expect(out?.unresolved).toEqual([])
  })

  it('computes durationMs as turn-active time, excluding inter-turn idle', async () => {
    mockListForTask.mockResolvedValue([
      row({ id: 'prev', summary: { goal: 'g', unresolved: [] } }),
    ])
    // two turns (30s + 20s) with a ~5h idle gap between them
    mockTurnEvents.mockResolvedValue([
      ...turn('prev', '2026-06-01T09:00:00Z', '2026-06-01T09:00:30Z'),
      ...turn('prev', '2026-06-01T14:00:00Z', '2026-06-01T14:00:20Z'),
    ])
    const out = await taskContextService.buildPreviousSessionRecoveryForTask(
      't1',
      'cur'
    )
    expect(out?.durationMs).toBe(50_000)
  })

  it('is 0 when the chosen session has no completed turns', async () => {
    mockListForTask.mockResolvedValue([
      row({ id: 'prev', summary: { goal: 'g', unresolved: [] } }),
    ])
    mockTurnEvents.mockResolvedValue([]) // no prompt/STOP events
    const out = await taskContextService.buildPreviousSessionRecoveryForTask(
      't1',
      'cur'
    )
    expect(out?.durationMs).toBe(0)
  })
})
