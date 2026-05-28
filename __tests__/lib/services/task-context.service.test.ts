/**
 * @jest-environment node
 */
jest.mock('@/lib/repositories/task.repository', () => ({
  taskRepository: {
    findByWorkspaceIdentifier: jest.fn(),
    findById: jest.fn(),
  },
}))
jest.mock('@/lib/repositories/session.repository', () => ({
  sessionRepository: {
    listForTask: jest.fn(),
  },
}))
jest.mock('@/lib/repositories/memory.repository', () => ({
  memoryRepository: {
    findActiveTaskMemories: jest.fn().mockResolvedValue([]),
    findActiveProjectMemories: jest.fn().mockResolvedValue([]),
  },
}))
jest.mock('@/lib/repositories/task-slack-context.repository', () => ({
  taskSlackContextRepository: {
    listByTask: jest.fn().mockResolvedValue([]),
  },
}))
jest.mock('@/lib/repositories/task-web-link.repository', () => ({
  taskWebLinkRepository: {
    listByTask: jest.fn().mockResolvedValue([]),
  },
}))
jest.mock('@/lib/services/task-figma-link.service', () => ({
  taskFigmaLinkService: {
    listForTask: jest.fn().mockResolvedValue([]),
    refreshLinksForTask: jest.fn().mockResolvedValue([]),
    refreshLinksForTaskAuto: jest.fn().mockResolvedValue([]),
  },
}))
jest.mock('@vercel/functions', () => ({
  waitUntil: jest.fn(),
}))
jest.mock('@/lib/repositories/milestone.repository', () => ({
  milestoneRepository: {
    findById: jest.fn().mockResolvedValue(null),
  },
}))
// task.service.ts fans out imports; stub the unrelated ones so the module
// loads without side effects.
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

import { taskRepository } from '@/lib/repositories/task.repository'
import { sessionRepository } from '@/lib/repositories/session.repository'
import { memoryRepository } from '@/lib/repositories/memory.repository'
import { taskContextService } from '@/lib/services/task-context.service'

const mockResolve = taskRepository.findByWorkspaceIdentifier as jest.Mock
const mockFindById = taskRepository.findById as jest.Mock
const mockSessions = sessionRepository.listForTask as jest.Mock
const mockTaskMem = memoryRepository.findActiveTaskMemories as jest.Mock
const mockProjMem = memoryRepository.findActiveProjectMemories as jest.Mock

beforeEach(() => {
  jest.clearAllMocks()
  mockTaskMem.mockResolvedValue([])
  mockProjMem.mockResolvedValue([])
})

const task = {
  id: 'task_cmoc',
  number: 30,
  title: 'T',
  status: 'IN_PROGRESS',
  description: 'desc',
  projectId: 'proj_1',
  team: { identifier: 'LUM' },
}

describe('taskContextService.getContextForIdentifier', () => {
  it('returns null when the identifier does not resolve', async () => {
    mockResolve.mockResolvedValueOnce(null)
    expect(
      await taskContextService.getContextForIdentifier(
        'ws_1',
        'member_1',
        'LUM-99'
      )
    ).toBeNull()
    expect(mockSessions).not.toHaveBeenCalled()
  })

  it('returns a context with empty sessions when the task has no prior runs', async () => {
    mockResolve.mockResolvedValueOnce(task)
    mockFindById.mockResolvedValueOnce(task)
    mockSessions.mockResolvedValueOnce([])
    const out = await taskContextService.getContextForIdentifier(
      'ws_1',
      'member_1',
      'LUM-30'
    )
    expect(out).not.toBeNull()
    expect(out?.task.identifier).toBe('LUM-30')
    expect(out?.sessions).toEqual([])
  })

  it('extracts headline from summary.goal and unresolved array', async () => {
    mockResolve.mockResolvedValueOnce(task)
    mockFindById.mockResolvedValueOnce(task)
    mockSessions.mockResolvedValueOnce([
      {
        id: 'sess_1',
        startedAt: new Date('2026-04-24T10:00:00Z'),
        lastActivityAt: new Date('2026-04-24T11:30:00Z'),
        eventCount: 42,
        summary: {
          goal: 'Wire the thing',
          unresolved: ['Schema not finalized', 'Migration conflict'],
        },
        summaryType: 'implementation',
        summaryGeneratedAt: new Date('2026-04-24T11:30:00Z'),
      },
    ])
    const out = await taskContextService.getContextForIdentifier(
      'ws_1',
      'member_1',
      'LUM-30'
    )
    expect(out?.sessions).toEqual([
      {
        id: 'sess_1',
        startedAt: '2026-04-24T10:00:00.000Z',
        lastActivityAt: '2026-04-24T11:30:00.000Z',
        durationMs: 90 * 60 * 1000,
        eventCount: 42,
        summaryType: 'implementation',
        headline: 'Wire the thing',
        unresolved: ['Schema not finalized', 'Migration conflict'],
      },
    ])
  })

  it('falls back to overview/problem/refactorGoal/reviewScope when goal is absent', async () => {
    mockResolve.mockResolvedValueOnce(task)
    mockFindById.mockResolvedValueOnce(task)
    mockSessions.mockResolvedValueOnce([
      {
        id: 's1',
        startedAt: new Date('2026-04-24T10:00:00Z'),
        lastActivityAt: new Date('2026-04-24T10:05:00Z'),
        eventCount: 5,
        summary: { overview: 'Big picture' },
        summaryType: 'mixed',
        summaryGeneratedAt: null,
      },
      {
        id: 's2',
        startedAt: new Date('2026-04-24T10:00:00Z'),
        lastActivityAt: new Date('2026-04-24T10:05:00Z'),
        eventCount: 5,
        summary: { problem: 'Bug X' },
        summaryType: 'debug',
        summaryGeneratedAt: null,
      },
    ])
    const out = await taskContextService.getContextForIdentifier(
      'ws_1',
      'member_1',
      'LUM-30'
    )
    expect(out?.sessions.map(s => s.headline)).toEqual(['Big picture', 'Bug X'])
  })

  it('returns "(no summary)" when the summary is null or unshaped', async () => {
    mockResolve.mockResolvedValueOnce(task)
    mockFindById.mockResolvedValueOnce(task)
    mockSessions.mockResolvedValueOnce([
      {
        id: 's1',
        startedAt: new Date('2026-04-24T10:00:00Z'),
        lastActivityAt: new Date('2026-04-24T10:05:00Z'),
        eventCount: 5,
        summary: null,
        summaryType: null,
        summaryGeneratedAt: null,
      },
    ])
    const out = await taskContextService.getContextForIdentifier(
      'ws_1',
      'member_1',
      'LUM-30'
    )
    expect(out?.sessions[0]?.headline).toBe('(no summary)')
    expect(out?.sessions[0]?.unresolved).toEqual([])
  })

  it('returns empty memorySection when the task has no memories', async () => {
    mockResolve.mockResolvedValueOnce(task)
    mockFindById.mockResolvedValueOnce(task)
    mockSessions.mockResolvedValueOnce([])
    const out = await taskContextService.getContextForIdentifier(
      'ws_1',
      'member_1',
      'LUM-30'
    )
    expect(out?.memorySection).toBe('')
  })

  it('includes both project-scope and task-scope memories in memorySection', async () => {
    mockResolve.mockResolvedValueOnce(task)
    // findById is called twice: once in getContextForIdentifier to get the
    // full task row, and again inside buildMemorySectionForTask.
    mockFindById.mockResolvedValueOnce(task).mockResolvedValueOnce(task)
    mockSessions.mockResolvedValueOnce([])
    mockProjMem.mockResolvedValueOnce([
      {
        id: 'mp1',
        category: 'CONVENTION',
        content: { rule: 'Use named exports', scope: 'lumo' },
        createdAt: new Date(),
      },
    ])
    mockTaskMem.mockResolvedValueOnce([
      {
        id: 'mt1',
        category: 'TRAP',
        content: { trigger: 'rm -rf node_modules', outcome: 'breaks pnpm' },
        createdAt: new Date(),
      },
    ])
    const out = await taskContextService.getContextForIdentifier(
      'ws_1',
      'member_1',
      'LUM-30'
    )
    expect(out?.memorySection).toContain('## Relevant Memory')
    expect(out?.memorySection).toContain('### Traps')
    expect(out?.memorySection).toContain('### Conventions')
    // TRAP comes before CONVENTION in the rendered output
    const trapIdx = out!.memorySection.indexOf('### Traps')
    const convIdx = out!.memorySection.indexOf('### Conventions')
    expect(trapIdx).toBeLessThan(convIdx)
  })

  it('drops non-string entries from summary.unresolved', async () => {
    mockResolve.mockResolvedValueOnce(task)
    mockFindById.mockResolvedValueOnce(task)
    mockSessions.mockResolvedValueOnce([
      {
        id: 's1',
        startedAt: new Date('2026-04-24T10:00:00Z'),
        lastActivityAt: new Date('2026-04-24T10:05:00Z'),
        eventCount: 5,
        summary: { goal: 'g', unresolved: ['ok', 42, null, '', 'also ok'] },
        summaryType: 'implementation',
        summaryGeneratedAt: null,
      },
    ])
    const out = await taskContextService.getContextForIdentifier(
      'ws_1',
      'member_1',
      'LUM-30'
    )
    expect(out?.sessions[0]?.unresolved).toEqual(['ok', 'also ok'])
  })
})
