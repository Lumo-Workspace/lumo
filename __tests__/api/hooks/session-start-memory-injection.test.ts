/**
 * @jest-environment node
 */
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
    buildReviewTodosSectionForTask: jest
      .fn()
      .mockResolvedValue({ section: '', fragments: [] }),
    buildPreviousSessionRecoveryForTask: jest.fn().mockResolvedValue(null),
    buildProgressSectionForTask: jest.fn().mockResolvedValue(''),
    buildLayer2ReviewSectionForTask: jest
      .fn()
      .mockResolvedValue({ section: '', fragments: [], dropped: 0 }),
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
    recordDroppedFragments: jest.fn().mockResolvedValue(undefined),
  },
}))
jest.mock('@/lib/services/task-dependency.service', () => ({
  taskDependencyService: {
    buildBlockerWarningSectionForTask: jest.fn().mockResolvedValue(''),
  },
}))
jest.mock('@/lib/runtime/wait-until', () => ({
  waitUntil: (p: Promise<unknown>) => p,
}))

import { authService } from '@/lib/services/auth.service'
import { hookEventService } from '@/lib/services/hook-event.service'
import { hookEventRepository } from '@/lib/repositories/hook-event.repository'
import { sessionRepository } from '@/lib/repositories/session.repository'
import { taskContextService } from '@/lib/services/task-context.service'
import { taskDependencyService } from '@/lib/services/task-dependency.service'
import { POST } from '@/app/api/hooks/session-start/route'
import {
  CURRENT_CLI_COMMANDS,
  LEGACY_CLI_COMMANDS,
  READ_ENTRY_MIN_CLI_VERSION,
} from '@/lib/cli/command-names'

const mockVerify = authService.verifyApiKey as jest.Mock
const mockRecord = hookEventService.recordHookEvent as jest.Mock

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

function post(body: unknown, extraHeaders: Record<string, string> = {}) {
  return new Request('http://x/api/hooks/session-start', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer lum_ok',
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  })
}

describe('POST /api/hooks/session-start — memory injection', () => {
  beforeEach(() => {
    jest.resetAllMocks()
    mockVerify.mockResolvedValue(identity)
    mockRecord.mockResolvedValue({ id: 'he_1', sessionId: 's-1', taskId: null })
    // Restore default resolutions reset by resetAllMocks().
    ;(
      hookEventRepository.setContextInjectionMetrics as jest.Mock
    ).mockResolvedValue(undefined)
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
    ;(
      taskContextService.buildProgressSectionForTask as jest.Mock
    ).mockResolvedValue('')
    ;(
      taskContextService.buildSessionStartSections as jest.Mock
    ).mockResolvedValue({
      memorySection: '',
      linkedResourcesSection: '',
      budget: EMPTY_BUDGET,
      fragments: [],
      droppedFragments: [],
    })
    ;(
      taskDependencyService.buildBlockerWarningSectionForTask as jest.Mock
    ).mockResolvedValue('')
  })

  it('returns memorySection when session has a bound task', async () => {
    ;(sessionRepository.findTaskBinding as jest.Mock).mockResolvedValue({
      bound: true,
      taskId: 'task-1',
      taskIdentifier: 'LUM-42',
      taskTitle: 'Test task',
    })
    ;(
      taskContextService.buildSessionStartSections as jest.Mock
    ).mockResolvedValue({
      memorySection: '## Relevant Memory\n\n### Traps\n- [task] **X** → Y\n',
      linkedResourcesSection: '',
      budget: EMPTY_BUDGET,
      fragments: [],
      droppedFragments: [],
    })

    const req = post({ sessionId: 's-1' })
    const res = await POST(req)
    const body = await res.json()

    expect(body.ok).toBe(true)
    expect(body.memorySection).toBe(
      '## Relevant Memory\n\n### Traps\n- [task] **X** → Y\n'
    )
    expect(taskContextService.buildSessionStartSections).toHaveBeenCalledWith(
      'task-1',
      LEGACY_CLI_COMMANDS
    )
  })

  it('returns linkedResourcesSection from buildSessionStartSections (LUM-147)', async () => {
    mockRecord.mockResolvedValue({ id: 'he_4', sessionId: 's-4', taskId: null })
    ;(sessionRepository.findTaskBinding as jest.Mock).mockResolvedValue({
      bound: true,
      taskId: 'task-1',
      taskIdentifier: 'LUM-42',
      taskTitle: 'Test task',
    })
    ;(
      taskContextService.buildSessionStartSections as jest.Mock
    ).mockResolvedValue({
      memorySection: 'MEM',
      linkedResourcesSection:
        '<untrusted-linked-context>\n## Pull Requests\n- #7 x\n</untrusted-linked-context>',
      budget: EMPTY_BUDGET,
      fragments: [],
      droppedFragments: [],
    })
    ;(
      taskContextService.buildReviewTodosSectionForTask as jest.Mock
    ).mockResolvedValue({ section: 'TODOS', fragments: [] })

    const req = post({ sessionId: 's-4' })
    const res = await POST(req)
    const body = await res.json()

    expect(body.memorySection).toBe('MEM')
    expect(body.linkedResourcesSection).toContain('## Pull Requests')
    expect(body.reviewTodosSection).toBe('TODOS')
  })

  it('returns memorySection="" when session is unbound', async () => {
    mockRecord.mockResolvedValue({ id: 'he_2', sessionId: 's-2', taskId: null })
    ;(sessionRepository.findTaskBinding as jest.Mock).mockResolvedValue({
      bound: false,
    })

    const req = post({ sessionId: 's-2' })
    const res = await POST(req)
    const body = await res.json()

    expect(body.ok).toBe(true)
    expect(body.memorySection).toBe('')
    expect(taskContextService.buildSessionStartSections).not.toHaveBeenCalled()
  })

  it('returns memorySection="" when bound task has no memory', async () => {
    mockRecord.mockResolvedValue({ id: 'he_3', sessionId: 's-3', taskId: null })
    ;(sessionRepository.findTaskBinding as jest.Mock).mockResolvedValue({
      bound: true,
      taskId: 'task-1',
      taskIdentifier: 'LUM-42',
      taskTitle: 'Test task',
    })
    ;(
      taskContextService.buildSessionStartSections as jest.Mock
    ).mockResolvedValue({
      memorySection: '',
      linkedResourcesSection: '',
      budget: EMPTY_BUDGET,
      fragments: [],
      droppedFragments: [],
    })

    const req = post({ sessionId: 's-3' })
    const res = await POST(req)
    const body = await res.json()

    expect(body.memorySection).toBe('')
    expect(taskContextService.buildSessionStartSections).toHaveBeenCalledWith(
      'task-1',
      LEGACY_CLI_COMMANDS
    )
  })

  it('returns blockerWarningSection in response when buildBlockerWarningSectionForTask resolves a non-empty string', async () => {
    const warningText = '## ⚠ Dependency alerts…'
    mockRecord.mockResolvedValue({
      id: 'he_5',
      sessionId: 's-5',
      taskId: 'task-1',
    })
    ;(sessionRepository.findTaskBinding as jest.Mock).mockResolvedValue({
      bound: true,
      taskId: 'task-1',
      taskIdentifier: 'LUM-42',
      taskTitle: 'Test task',
    })
    ;(
      taskDependencyService.buildBlockerWarningSectionForTask as jest.Mock
    ).mockResolvedValue(warningText)

    const req = post({ sessionId: 's-5' })
    const res = await POST(req)
    const body = await res.json()

    expect(body.ok).toBe(true)
    expect(body.blockerWarningSection).toBe(warningText)
  })

  // LUM-1233: the injected progress / dependency notes name only commands the
  // caller's CLI has — `task context` for an older CLI, `task show` for a new one.
  it.each([
    ['an older CLI', { 'X-Lumo-Cli-Version': '1.125.4' }, LEGACY_CLI_COMMANDS],
    ['no version header', {}, LEGACY_CLI_COMMANDS],
    [
      'a current CLI',
      { 'X-Lumo-Cli-Version': READ_ENTRY_MIN_CLI_VERSION },
      CURRENT_CLI_COMMANDS,
    ],
  ])('passes the command names for %s', async (_label, headers, expected) => {
    ;(sessionRepository.findTaskBinding as jest.Mock).mockResolvedValue({
      bound: true,
      taskId: 'task-1',
      taskIdentifier: 'LUM-42',
      taskTitle: 'Test task',
    })
    await POST(post({ sessionId: 's-1' }, headers))
    expect(
      (taskContextService.buildProgressSectionForTask as jest.Mock).mock
        .calls[0]![2]
    ).toBe(expected)
    expect(
      (taskDependencyService.buildBlockerWarningSectionForTask as jest.Mock)
        .mock.calls[0]![2]
    ).toBe(expected)
    // LUM-1233 3b: the memory index and the Layer-2 review section too.
    expect(
      (taskContextService.buildSessionStartSections as jest.Mock).mock
        .calls[0]![1]
    ).toBe(expected)
    expect(
      (taskContextService.buildLayer2ReviewSectionForTask as jest.Mock).mock
        .calls[0]![2]
    ).toBe(expected)
  })
})
