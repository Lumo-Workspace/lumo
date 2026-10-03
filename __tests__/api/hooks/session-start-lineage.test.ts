/** @jest-environment node */
jest.mock('@/lib/services/auth.service', () => ({
  authService: { verifyApiKey: jest.fn() },
}))
jest.mock('@/lib/services/hook-event.service', () => ({
  hookEventService: { recordHookEvent: jest.fn() },
}))
jest.mock('@/lib/repositories/session.repository', () => ({
  sessionRepository: { findTaskBinding: jest.fn() },
}))
jest.mock('@/lib/services/task-context.service', () => ({
  taskContextService: {
    buildSessionStartSections: jest.fn(),
    buildReviewTodosSectionForTask: jest.fn(),
    buildPreviousSessionRecoveryForTask: jest.fn(),
    buildProgressSectionForTask: jest.fn().mockResolvedValue(''),
    buildLayer2ReviewSectionForTask: jest.fn(),
  },
}))
jest.mock('@/lib/repositories/hook-event.repository', () => ({
  hookEventRepository: {
    setContextInjectionMetrics: jest.fn().mockResolvedValue(undefined),
  },
}))
jest.mock('@/lib/services/lineage.service', () => ({
  lineageService: {
    recordSessionStartEdges: jest.fn().mockResolvedValue(undefined),
  },
}))
jest.mock('@/lib/services/task-dependency.service', () => ({
  taskDependencyService: {
    buildBlockerWarningSectionForTask: jest.fn().mockResolvedValue(''),
  },
}))
// waitUntil must run its argument synchronously so the test can observe the call.
jest.mock('@vercel/functions', () => ({
  waitUntil: (p: Promise<unknown>) => p,
}))

import { authService } from '@/lib/services/auth.service'
import { hookEventService } from '@/lib/services/hook-event.service'
import { sessionRepository } from '@/lib/repositories/session.repository'
import { taskContextService } from '@/lib/services/task-context.service'
import { lineageService } from '@/lib/services/lineage.service'
import { POST } from '@/app/api/hooks/session-start/route'

// LUM-402: buildSessionStartSections carries per-section budget attribution.
const EMPTY_METRIC = {
  keptCards: 0,
  droppedCards: 0,
  keptTokens: 0,
  droppedTokens: 0,
}
const EMPTY_BUDGET = {
  budgetTokens: 2500,
  sections: {
    criteria: EMPTY_METRIC,
    memory: EMPTY_METRIC,
    pr: EMPTY_METRIC,
    slack: EMPTY_METRIC,
    figma: EMPTY_METRIC,
    web: EMPTY_METRIC,
  },
}

const identity = {
  user: { id: 'clerk_1', email: 'a@b', name: 'A' },
  workspace: { id: 'ws_1', slug: 'ws', name: 'WS' },
  apiKey: { id: 'k_1', name: 'laptop', prefix: 'lum_abc' },
}

function post(body: unknown) {
  return new Request('http://x/api/hooks/session-start', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer lum_ok',
    },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  ;(authService.verifyApiKey as jest.Mock).mockResolvedValue(identity)
  ;(hookEventService.recordHookEvent as jest.Mock).mockResolvedValue({
    id: 'he_1',
    sessionId: 's-1',
    taskId: 'task-1',
  })
})

describe('POST /api/hooks/session-start — lineage edge birth', () => {
  it('aggregates fragments from all builders and records edges for the bound session', async () => {
    ;(sessionRepository.findTaskBinding as jest.Mock).mockResolvedValue({
      bound: true,
      taskId: 'task-1',
    })
    ;(
      taskContextService.buildSessionStartSections as jest.Mock
    ).mockResolvedValue({
      memorySection: 'm',
      linkedResourcesSection: 'l',
      budget: EMPTY_BUDGET,
      fragments: [
        { fragmentType: 'MEMORY', fragmentId: 'mem-1' },
        { fragmentType: 'PR', fragmentId: 'pr-1' },
      ],
    })
    ;(
      taskContextService.buildReviewTodosSectionForTask as jest.Mock
    ).mockResolvedValue({
      section: '',
      fragments: [{ fragmentType: 'PR_REVIEW_TODO', fragmentId: 'todo-1' }],
    })
    ;(
      taskContextService.buildLayer2ReviewSectionForTask as jest.Mock
    ).mockResolvedValue({
      section: '',
      fragments: [{ fragmentType: 'MEMORY', fragmentId: 'mem-proj' }],
      dropped: 0,
    })
    ;(
      taskContextService.buildPreviousSessionRecoveryForTask as jest.Mock
    ).mockResolvedValue({
      sessionId: 'prev-s',
      headline: 'h',
      unresolved: [],
      durationMs: 0,
      lastActivityAt: '2026-06-06T00:00:00.000Z',
    })

    const res = await POST(post({ sessionId: 's-1' }))
    expect((await res.json()).ok).toBe(true)

    expect(lineageService.recordSessionStartEdges).toHaveBeenCalledWith({
      workspaceId: 'ws_1',
      taskId: 'task-1',
      sessionId: 's-1',
      fragments: [
        { fragmentType: 'MEMORY', fragmentId: 'mem-1' },
        { fragmentType: 'PR', fragmentId: 'pr-1' },
        { fragmentType: 'PR_REVIEW_TODO', fragmentId: 'todo-1' },
        { fragmentType: 'MEMORY', fragmentId: 'mem-proj' },
        { fragmentType: 'SESSION', fragmentId: 'prev-s' },
      ],
    })
  })

  it('does not record edges when the session is unbound', async () => {
    ;(sessionRepository.findTaskBinding as jest.Mock).mockResolvedValue({
      bound: false,
    })
    await POST(post({ sessionId: 's-1' }))
    expect(lineageService.recordSessionStartEdges).not.toHaveBeenCalled()
  })

  it('does not record edges when there is no sessionId', async () => {
    ;(hookEventService.recordHookEvent as jest.Mock).mockResolvedValue({
      id: 'he_2',
      sessionId: null,
      taskId: null,
    })
    await POST(post({}))
    expect(lineageService.recordSessionStartEdges).not.toHaveBeenCalled()
  })

  it('does not record edges when bound but all builders return empty fragments', async () => {
    ;(sessionRepository.findTaskBinding as jest.Mock).mockResolvedValue({
      bound: true,
      taskId: 'task-1',
    })
    ;(
      taskContextService.buildSessionStartSections as jest.Mock
    ).mockResolvedValue({
      memorySection: '',
      linkedResourcesSection: '',
      budget: EMPTY_BUDGET,
      fragments: [],
    })
    ;(
      taskContextService.buildReviewTodosSectionForTask as jest.Mock
    ).mockResolvedValue({
      section: '',
      fragments: [],
    })
    ;(
      taskContextService.buildLayer2ReviewSectionForTask as jest.Mock
    ).mockResolvedValue({
      section: '',
      fragments: [],
      dropped: 0,
    })
    ;(
      taskContextService.buildPreviousSessionRecoveryForTask as jest.Mock
    ).mockResolvedValue(null)

    await POST(post({ sessionId: 's-1' }))
    expect(lineageService.recordSessionStartEdges).not.toHaveBeenCalled()
  })
})
