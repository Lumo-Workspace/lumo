/**
 * @jest-environment node
 *
 * LUM-402: session-start injection telemetry. Route-level tests running the
 * REAL taskContextService + budget allocator over mocked repositories, so the
 * stamped metrics reflect the actual allocation math (not a mocked shape).
 */

// task.service transitively imports @octokit/auth-app (ESM) via
// task-pr-sync.service → lib/integrations/github — mock the whole module to
// keep jest in CJS-land. document.service pulls in @clerk/nextjs — same story.
jest.mock('@/lib/services/task.service', () => ({
  taskService: { resolveIdentifier: jest.fn() },
}))
jest.mock('@/lib/services/document.service', () => ({
  scheduleDocumentSummary: jest.fn(),
}))

jest.mock('@/lib/services/auth.service', () => ({
  authService: { verifyApiKey: jest.fn() },
}))
jest.mock('@/lib/services/hook-event.service', () => ({
  hookEventService: { recordHookEvent: jest.fn() },
}))
jest.mock('@/lib/repositories/hook-event.repository', () => ({
  hookEventRepository: { setContextInjectionMetrics: jest.fn().mockResolvedValue(undefined) },
}))
jest.mock('@/lib/repositories/session.repository', () => ({
  sessionRepository: { findTaskBinding: jest.fn() },
}))
jest.mock('@/lib/services/lineage.service', () => ({
  lineageService: { recordSessionStartEdges: jest.fn().mockResolvedValue(undefined) },
}))
jest.mock('@/lib/services/task-dependency.service', () => ({
  taskDependencyService: {
    buildBlockerWarningSectionForTask: jest.fn().mockResolvedValue(''),
  },
}))
jest.mock('@vercel/functions', () => ({ waitUntil: (p: Promise<unknown>) => p }))

jest.mock('@/lib/repositories/task.repository', () => ({
  taskRepository: {
    findById: jest.fn(async () => ({ id: 'tsk_1', projectId: 'proj_1', status: 'IN_PROGRESS' })),
  },
}))
jest.mock('@/lib/repositories/memory.repository', () => ({
  memoryRepository: {
    findActiveTaskMemories: jest.fn(async () => []),
    findActiveProjectMemories: jest.fn(async () => []),
  },
}))
jest.mock('@/lib/repositories/acceptance-criterion.repository', () => ({
  acceptanceCriterionRepository: { listByTask: jest.fn(async () => []) },
}))
jest.mock('@/lib/repositories/task-slack-context.repository', () => ({
  taskSlackContextRepository: { listByTask: jest.fn(async () => []) },
}))
jest.mock('@/lib/repositories/task-web-link.repository', () => ({
  taskWebLinkRepository: { listByTask: jest.fn(async () => []) },
}))
jest.mock('@/lib/services/task-figma-link.service', () => ({
  taskFigmaLinkService: { listForTask: jest.fn(async () => []) },
}))
jest.mock('@/lib/repositories/pull-request.repository', () => ({
  pullRequestRepository: { listByTask: jest.fn(async () => []) },
}))

import { authService } from '@/lib/services/auth.service'
import { hookEventService } from '@/lib/services/hook-event.service'
import { hookEventRepository } from '@/lib/repositories/hook-event.repository'
import { sessionRepository } from '@/lib/repositories/session.repository'
import { memoryRepository } from '@/lib/repositories/memory.repository'
import { pullRequestRepository } from '@/lib/repositories/pull-request.repository'
import { taskContextService } from '@/lib/services/task-context.service'
import {
  CONTEXT_METRICS_KEY,
  type SessionStartContextMetrics,
} from '@/lib/context/injection-metrics'
import { POST } from '@/app/api/hooks/session-start/route'

const mockVerify = authService.verifyApiKey as jest.Mock
const mockRecord = hookEventService.recordHookEvent as jest.Mock
const mockStamp = hookEventRepository.setContextInjectionMetrics as jest.Mock

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

function bindTask() {
  ;(sessionRepository.findTaskBinding as jest.Mock).mockResolvedValue({
    bound: true,
    taskId: 'tsk_1',
    taskIdentifier: 'LUM-42',
    taskTitle: 'Test task',
  })
}

/** Stamped payload of the (single) setContextInjectionMetrics call. */
function stampedPayload(): Record<string, unknown> {
  expect(mockStamp).toHaveBeenCalledTimes(1)
  const call = mockStamp.mock.calls[0] as [string, Record<string, unknown>]
  expect(call[0]).toBe('he_1')
  return call[1]
}

describe('POST /api/hooks/session-start — injection metrics (LUM-402)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockVerify.mockResolvedValue(identity)
    mockRecord.mockResolvedValue({ id: 'he_1', sessionId: 's-1', taskId: null })
    jest
      .spyOn(taskContextService, 'buildReviewTodosSectionForTask')
      .mockResolvedValue({ section: '## PR review todos\n- [ ] fix x', fragments: [] })
    jest
      .spyOn(taskContextService, 'buildPreviousSessionRecoveryForTask')
      .mockResolvedValue(null)
    jest
      .spyOn(taskContextService, 'buildLayer2ReviewSectionForTask')
      .mockResolvedValue({ section: '', fragments: [], dropped: 0 })
  })

  it('records per-section metrics on the stored SESSION_START payload', async () => {
    bindTask()
    ;(memoryRepository.findActiveProjectMemories as jest.Mock).mockResolvedValue([
      { id: 'm1', category: 'TRAP', content: { trigger: 'X', outcome: 'Y' } },
    ])
    ;(pullRequestRepository.listByTask as jest.Mock).mockResolvedValue([
      { id: 'pr1', number: 7, title: 'Add thing', state: 'OPEN', ciStatus: 'passing' },
    ])

    const res = await POST(post({ session_id: 's-1', source: 'startup' }))
    expect((await res.json()).ok).toBe(true)

    const payload = stampedPayload()
    // Original boundary-validated payload fields survive the merge.
    expect(payload.session_id).toBe('s-1')
    expect(payload.source).toBe('startup')

    const metrics = payload[CONTEXT_METRICS_KEY] as SessionStartContextMetrics
    expect(metrics.version).toBe(1)
    expect(metrics.budgetTokens).toBe(2500)
    // One memory and one PR, both well under budget: kept in full, none dropped.
    expect(metrics.allocation.memory).toMatchObject({ keptCards: 1, droppedCards: 0 })
    expect(metrics.allocation.memory.keptTokens).toBeGreaterThan(0)
    expect(metrics.allocation.pr).toMatchObject({ keptCards: 1, droppedCards: 0 })
    expect(metrics.allocation.layer2Review).toEqual({ keptCards: 0, droppedCards: 0 })
    // Section sizes of what actually shipped.
    expect(metrics.sectionTokens.memory).toBeGreaterThan(0)
    expect(metrics.sectionTokens.linkedResources).toBeGreaterThan(0)
    expect(metrics.sectionTokens.reviewTodos).toBeGreaterThan(0)
    expect(metrics.sectionTokens.previousSession).toBe(0)
    expect(metrics.totalTokens).toBeGreaterThanOrEqual(
      metrics.sectionTokens.memory + metrics.sectionTokens.linkedResources
    )
  })

  it('is observe-only: injected context is unchanged and never carries the metrics key', async () => {
    bindTask()
    ;(memoryRepository.findActiveProjectMemories as jest.Mock).mockResolvedValue([
      { id: 'm1', category: 'TRAP', content: { trigger: 'X', outcome: 'Y' } },
    ])

    const res = await POST(post({ session_id: 's-1' }))
    const body = await res.json()

    // The injected sections render exactly as before the telemetry existed.
    expect(body.memorySection).toContain('<untrusted-team-memory>')
    expect(body.memorySection).toContain('## Relevant Memory')
    expect(body.reviewTodosSection).toBe('## PR review todos\n- [ ] fix x')
    // The metrics reserved key appears nowhere in the agent-facing response.
    expect(JSON.stringify(body)).not.toContain(CONTEXT_METRICS_KEY)
    // The initial HookEvent insert is untouched — metrics arrive only via the
    // post-assembly stamp on the same row.
    const inserted = mockRecord.mock.calls[0]?.[0] as { payload: Record<string, unknown> }
    expect(inserted.payload[CONTEXT_METRICS_KEY]).toBeUndefined()
    expect(stampedPayload()[CONTEXT_METRICS_KEY]).toBeDefined()
  })

  it('overflow attribution: budget exhaustion lands as droppedCards>0 on the squeezed section', async () => {
    bindTask()
    // Far more memory than the 2500-token budget: each fat card is ~150+
    // tokens, so 40 cards force overflow inside the memory section, and the
    // PR section (lower priority) is starved entirely.
    const fat = Array.from({ length: 40 }, (_, i) => ({
      id: `m${i}`,
      category: 'TRAP',
      content: { trigger: `case ${i} ` + 'x'.repeat(500), outcome: 'y'.repeat(100) },
    }))
    ;(memoryRepository.findActiveProjectMemories as jest.Mock).mockResolvedValue(fat)
    ;(pullRequestRepository.listByTask as jest.Mock).mockResolvedValue([
      { id: 'pr1', number: 7, title: 'Add thing', state: 'OPEN', ciStatus: 'passing' },
    ])

    const res = await POST(post({ session_id: 's-1' }))
    expect((await res.json()).ok).toBe(true)

    const metrics = stampedPayload()[
      CONTEXT_METRICS_KEY
    ] as SessionStartContextMetrics
    const { memory, pr } = metrics.allocation
    // The memory section absorbed the budget and dropped its tail…
    expect(memory.keptCards).toBeGreaterThan(0)
    expect(memory.droppedCards).toBeGreaterThan(0)
    expect(memory.droppedTokens).toBeGreaterThan(0)
    expect(memory.keptCards + memory.droppedCards).toBe(40)
    // …and the lower-priority PR section was starved entirely.
    expect(pr).toMatchObject({ keptCards: 0, droppedCards: 1, keptTokens: 0 })
    // Kept tokens across all sections respect the budget.
    const keptTotal = Object.values(metrics.allocation)
      .map(m => ('keptTokens' in m ? m.keptTokens : 0))
      .reduce((a, b) => a + b, 0)
    expect(keptTotal).toBeLessThanOrEqual(metrics.budgetTokens)
  })
})
