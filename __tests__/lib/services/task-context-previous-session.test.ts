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
jest.mock('@/lib/repositories/task-slack-context.repository', () => ({
  taskSlackContextRepository: { listByTask: jest.fn() },
}))
jest.mock('@/lib/repositories/task-web-link.repository', () => ({
  taskWebLinkRepository: { listByTask: jest.fn() },
}))
jest.mock('@/lib/repositories/milestone.repository', () => ({
  milestoneRepository: { findById: jest.fn() },
}))
jest.mock('@/lib/repositories/project.repository', () => ({ projectRepository: {} }))
jest.mock('@/lib/repositories/pull-request.repository', () => ({ pullRequestRepository: {} }))
jest.mock('@/lib/repositories/tag.repository', () => ({ tagRepository: {} }))
jest.mock('@/lib/repositories/github.repository', () => ({ githubRepository: {} }))
jest.mock('@/lib/repositories/activity.repository', () => ({ activityRepository: {} }))
jest.mock('@/lib/services/task-pr-sync.service', () => ({ syncPullRequestStatus: jest.fn() }))
jest.mock('@/lib/services/task-notifications.service', () => ({
  dispatchCreateTaskSideEffects: jest.fn(),
  dispatchUpdateTaskSideEffects: jest.fn(),
}))

import { taskContextService } from '@/lib/services/task-context.service'
import { sessionRepository } from '@/lib/repositories/session.repository'

const mockListForTask = sessionRepository.listForTask as jest.Mock

function row(over: Partial<{
  id: string
  startedAt: Date
  lastActivityAt: Date
  summary: unknown
}>) {
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
    const out = await taskContextService.buildPreviousSessionRecoveryForTask('t1', 'cur')
    expect(out).toBeNull()
  })

  it('returns null when no session has a summary', async () => {
    mockListForTask.mockResolvedValue([
      row({ id: 'a', summary: null }),
      row({ id: 'b', summary: {} }),
    ])
    const out = await taskContextService.buildPreviousSessionRecoveryForTask('t1', 'cur')
    expect(out).toBeNull()
  })

  it('excludes the current session and picks the next one with a summary', async () => {
    mockListForTask.mockResolvedValue([
      row({ id: 'cur', summary: { goal: 'should be skipped', unresolved: ['x'] } }),
      row({ id: 'prev', summary: { goal: 'real headline', unresolved: ['finish API'] } }),
    ])
    const out = await taskContextService.buildPreviousSessionRecoveryForTask('t1', 'cur')
    expect(out).toEqual({
      headline: 'real headline',
      unresolved: ['finish API'],
      durationMs: 23 * 60_000,
      lastActivityAt: '2026-06-01T10:23:00.000Z',
    })
  })

  it('walks back past a summary-less recent session to an older one with a summary', async () => {
    mockListForTask.mockResolvedValue([
      row({ id: 'recent', summary: null }),
      row({ id: 'older', summary: { goal: 'older headline', unresolved: [] } }),
    ])
    const out = await taskContextService.buildPreviousSessionRecoveryForTask('t1', 'cur')
    expect(out?.headline).toBe('older headline')
    expect(out?.unresolved).toEqual([])
  })

  it('computes durationMs as lastActivityAt - startedAt (floored at 0)', async () => {
    mockListForTask.mockResolvedValue([
      row({
        id: 'prev',
        startedAt: new Date('2026-06-01T09:00:00Z'),
        lastActivityAt: new Date('2026-06-01T09:05:00Z'),
        summary: { goal: 'g', unresolved: [] },
      }),
    ])
    const out = await taskContextService.buildPreviousSessionRecoveryForTask('t1', 'cur')
    expect(out?.durationMs).toBe(5 * 60_000)
  })
})
