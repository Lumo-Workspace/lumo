/**
 * @jest-environment node
 *
 * LUM-402: session-start injection telemetry. Route-level tests running the
 * REAL taskContextService + budget allocator over mocked repositories, so the
 * stamped metrics reflect the actual allocation math (not a mocked shape).
 */

// task.service transitively imports @octokit/auth-app (ESM) via
// task-pr-sync.service → lib/integrations/github — mock the whole module to
// keep jest in CJS-land.
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
  hookEventRepository: {
    setContextInjectionMetrics: jest.fn().mockResolvedValue(undefined),
  },
}))
jest.mock('@/lib/repositories/session.repository', () => ({
  sessionRepository: { findTaskBinding: jest.fn() },
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
jest.mock('@/lib/runtime/wait-until', () => ({
  waitUntil: (p: Promise<unknown>) => p,
}))

jest.mock('@/lib/repositories/task.repository', () => ({
  taskRepository: {
    findById: jest.fn(async () => ({
      id: 'tsk_1',
      projectId: 'proj_1',
      status: 'IN_PROGRESS',
      number: 1,
      team: { identifier: 'LUM' },
    })),
  },
}))
jest.mock('@/lib/repositories/memory.repository', () => ({
  memoryRepository: {
    findActiveTaskMemories: jest.fn(async () => []),
    findActiveProjectMemories: jest.fn(async () => []),
  },
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
import { RELEVANCE_GATE_TOP_K } from '@/lib/services/memory/relevance-gate.constants'
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
  const call = mockStamp.mock.calls[0] as [
    string,
    string,
    Record<string, unknown>,
  ]
  expect(call[0]).toBe(identity.workspace.id)
  expect(call[1]).toBe('he_1')
  return call[2]
}

describe('POST /api/hooks/session-start — injection metrics (LUM-402)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockVerify.mockResolvedValue(identity)
    mockRecord.mockResolvedValue({ id: 'he_1', sessionId: 's-1', taskId: null })
    jest
      .spyOn(taskContextService, 'buildReviewTodosSectionForTask')
      .mockResolvedValue({
        section: '## PR review todos\n- [ ] fix x',
        fragments: [],
      })
    jest
      .spyOn(taskContextService, 'buildPreviousSessionRecoveryForTask')
      .mockResolvedValue(null)
    jest
      .spyOn(taskContextService, 'buildLayer2ReviewSectionForTask')
      .mockResolvedValue({ section: '', fragments: [], dropped: 0 })
  })

  it('records per-section metrics on the stored SESSION_START payload', async () => {
    bindTask()
    ;(
      memoryRepository.findActiveProjectMemories as jest.Mock
    ).mockResolvedValue([
      { id: 'm1', category: 'TRAP', content: { trigger: 'X', outcome: 'Y' } },
    ])
    ;(pullRequestRepository.listByTask as jest.Mock).mockResolvedValue([
      {
        id: 'pr1',
        number: 7,
        title: 'Add thing',
        state: 'OPEN',
        ciStatus: 'passing',
      },
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
    // One memory (kept as the top-K index) and one PR. LUM-500: the PR is a
    // Tier-2 manifest, so keptCards is 0 (no full card) and the single PR is
    // counted as droppedCards — the manifest's cheap tokens are keptTokens.
    expect(metrics.allocation.memory).toMatchObject({
      keptCards: 1,
      droppedCards: 0,
    })
    expect(metrics.allocation.memory.keptTokens).toBeGreaterThan(0)
    expect(metrics.allocation.pr).toMatchObject({
      keptCards: 0,
      droppedCards: 1,
    })
    expect(metrics.allocation.pr.keptTokens).toBeGreaterThan(0)
    expect(metrics.allocation.layer2Review).toEqual({
      keptCards: 0,
      droppedCards: 0,
    })
    // Section sizes of what actually shipped.
    expect(metrics.sectionTokens.memory).toBeGreaterThan(0)
    expect(metrics.sectionTokens.linkedResources).toBeGreaterThan(0)
    expect(metrics.sectionTokens.reviewTodos).toBeGreaterThan(0)
    expect(metrics.sectionTokens.progress).toBe(0)
    expect(metrics.totalTokens).toBeGreaterThanOrEqual(
      metrics.sectionTokens.memory + metrics.sectionTokens.linkedResources
    )
  })

  it('is observe-only: injected context is unchanged and never carries the metrics key', async () => {
    bindTask()
    ;(
      memoryRepository.findActiveProjectMemories as jest.Mock
    ).mockResolvedValue([
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
    const inserted = mockRecord.mock.calls[0]?.[0] as {
      payload: Record<string, unknown>
    }
    expect(inserted.payload[CONTEXT_METRICS_KEY]).toBeUndefined()
    expect(stampedPayload()[CONTEXT_METRICS_KEY]).toBeDefined()
  })

  it('memory index attribution: keeps top-K as index lines, the rest become droppedCards (LUM-500)', async () => {
    bindTask()
    // 40 memories. Under LUM-500 memory no longer competes for the token
    // budget — it degrades to a Tier-2 one-line index that keeps the top-K
    // (RELEVANCE_GATE_TOP_K = 8) and points to the remainder. So keptCards is
    // capped at the index size, the tail is droppedCards, and the index itself
    // costs nothing against the shared budget (droppedTokens stays 0).
    const fat = Array.from({ length: 40 }, (_, i) => ({
      id: `m${i}`,
      category: 'TRAP',
      content: {
        trigger: `case ${i} ` + 'x'.repeat(500),
        outcome: 'y'.repeat(100),
      },
    }))
    ;(
      memoryRepository.findActiveProjectMemories as jest.Mock
    ).mockResolvedValue(fat)
    ;(pullRequestRepository.listByTask as jest.Mock).mockResolvedValue([
      {
        id: 'pr1',
        number: 7,
        title: 'Add thing',
        state: 'OPEN',
        ciStatus: 'passing',
      },
    ])

    const res = await POST(post({ session_id: 's-1' }))
    expect((await res.json()).ok).toBe(true)

    const metrics = stampedPayload()[
      CONTEXT_METRICS_KEY
    ] as SessionStartContextMetrics
    const { memory, pr } = metrics.allocation
    // The index keeps the top-K and counts the rest as dropped, but never
    // overflows the token budget (it's a manifest, not full cards).
    expect(memory.keptCards).toBe(RELEVANCE_GATE_TOP_K)
    expect(memory.droppedCards).toBe(40 - RELEVANCE_GATE_TOP_K)
    expect('droppedTokens' in memory ? memory.droppedTokens : -1).toBe(0)
    // …and the PR is a Tier-2 manifest (LUM-500): no full card competes for the
    // budget, so keptCards is 0 and the single PR is counted as dropped.
    expect(pr.keptCards).toBe(0)
    expect(pr.droppedCards).toBe(1)
    // Kept tokens across the budgeted sections respect the budget.
    const keptTotal = Object.values(metrics.allocation)
      .map(m => ('keptTokens' in m ? m.keptTokens : 0))
      .reduce((a, b) => a + b, 0)
    expect(keptTotal).toBeLessThanOrEqual(metrics.budgetTokens)
  })
})
