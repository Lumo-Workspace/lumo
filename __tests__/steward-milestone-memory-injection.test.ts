/** @jest-environment node */
const mockFindMilestone = jest.fn()
jest.mock('@/lib/repositories/milestone.repository', () => ({
  milestoneRepository: {
    findById: (...a: any[]) => mockFindMilestone(...a),
  },
}))

const mockFindMsMemories = jest.fn()
jest.mock('@/lib/repositories/memory.repository', () => ({
  memoryRepository: {
    findActiveMilestoneScopeMemoriesByProject: (...a: any[]) =>
      mockFindMsMemories(...a),
  },
}))

// ── Harness for the session-start route steward-branch test below. The route's
// else-branch runs the REAL steward-context builder against the mocked repos
// above, so this exercises the actual hook wiring (not a stub). ──────────────
jest.mock('@/lib/services/auth.service', () => ({
  authService: { verifyApiKey: jest.fn() },
}))
jest.mock('@/lib/services/hook-event.service', () => ({
  hookEventService: { recordHookEvent: jest.fn() },
}))
jest.mock('@/lib/repositories/session.repository', () => ({
  sessionRepository: {
    findTaskBinding: jest.fn(),
    findStewardBinding: jest.fn(),
  },
}))
jest.mock('@/lib/services/task-context.service', () => ({
  taskContextService: {
    buildSessionStartSections: jest.fn(),
    buildReviewTodosSectionForTask: jest.fn(),
    buildPreviousSessionRecoveryForTask: jest.fn(),
    buildProgressSectionForTask: jest.fn(),
    buildLayer2ReviewSectionForTask: jest.fn(),
  },
}))
jest.mock('@/lib/services/task-dependency.service', () => ({
  taskDependencyService: { buildBlockerWarningSectionForTask: jest.fn() },
}))
jest.mock('@/lib/services/lineage.service', () => ({
  lineageService: {
    recordSessionStartEdges: jest.fn().mockResolvedValue(undefined),
    recordDroppedFragments: jest.fn().mockResolvedValue(undefined),
  },
}))
jest.mock('@/lib/repositories/hook-event.repository', () => ({
  hookEventRepository: {
    setContextInjectionMetrics: jest.fn().mockResolvedValue(undefined),
  },
}))
jest.mock('@/lib/runtime/wait-until', () => ({
  waitUntil: (p: Promise<unknown>) => p,
}))

import { stewardContextService } from '@/lib/services/steward-context.service'
import { authService } from '@/lib/services/auth.service'
import { hookEventService } from '@/lib/services/hook-event.service'
import { sessionRepository } from '@/lib/repositories/session.repository'
import { POST as sessionStartPOST } from '@/app/api/hooks/session-start/route'

const PRIOR_MEMORY = {
  id: 'mem_prior',
  category: 'DECISION' as const,
  content: {
    what: 'Sequence migration tasks before UI tasks',
    why: 'Migration churn blocked the UI work late in the last milestone',
  },
  createdAt: new Date(),
  createdByMemberId: null,
}

beforeEach(() => {
  jest.clearAllMocks()
  mockFindMilestone.mockResolvedValue({ id: 'ms_current', projectId: 'p1' })
})

describe('steward milestone memory injection (LUM-647)', () => {
  it('injects prior-milestone MILESTONE memories wrapped in the untrusted-team-memory boundary', async () => {
    mockFindMsMemories.mockResolvedValue([PRIOR_MEMORY])
    const { section, count } =
      await stewardContextService.buildMilestoneMemorySection('ms_current')
    expect(count).toBe(1)
    expect(section).toContain('<untrusted-team-memory>')
    expect(section).toContain('</untrusted-team-memory>')
    expect(section).toContain('Sequence migration tasks before UI tasks')
  })

  it('queries the project scope and excludes the current milestone own rows', async () => {
    mockFindMsMemories.mockResolvedValue([PRIOR_MEMORY])
    await stewardContextService.buildMilestoneMemorySection('ms_current')
    expect(mockFindMsMemories).toHaveBeenCalledWith('p1', 'ms_current')
  })

  it('renders the injected memories with a milestone scope tag', async () => {
    mockFindMsMemories.mockResolvedValue([PRIOR_MEMORY])
    const { section } =
      await stewardContextService.buildMilestoneMemorySection('ms_current')
    expect(section).toContain('[milestone')
  })

  it('returns an empty section when the project has no prior-milestone learnings', async () => {
    mockFindMsMemories.mockResolvedValue([])
    const { section, count } =
      await stewardContextService.buildMilestoneMemorySection('ms_current')
    expect(section).toBe('')
    expect(count).toBe(0)
  })

  it('returns an empty section when the milestone does not exist', async () => {
    mockFindMilestone.mockResolvedValue(null)
    const { section } =
      await stewardContextService.buildMilestoneMemorySection('nope')
    expect(section).toBe('')
    expect(mockFindMsMemories).not.toHaveBeenCalled()
  })

  it('session-start hook steward branch injects the prior-milestone section for a resumed steward session', async () => {
    ;(authService.verifyApiKey as jest.Mock).mockResolvedValue({
      user: { id: 'clerk_1', email: 'a@b', name: 'A' },
      workspace: { id: 'ws_1', slug: 'ws', name: 'WS' },
      apiKey: { id: 'k_1', name: 'laptop', prefix: 'lum_abc' },
    })
    ;(hookEventService.recordHookEvent as jest.Mock).mockResolvedValue({
      id: 'he_1',
      sessionId: 's-steward',
      taskId: null,
    })
    // Not task-bound, but bound as STEWARD of ms_current.
    ;(sessionRepository.findTaskBinding as jest.Mock).mockResolvedValue({
      bound: false,
    })
    ;(sessionRepository.findStewardBinding as jest.Mock).mockResolvedValue({
      milestoneId: 'ms_current',
      milestoneName: 'Beta',
    })
    // Real builder runs against the mocked repos: milestone→project, prior rows.
    mockFindMsMemories.mockResolvedValue([PRIOR_MEMORY])

    const req = new Request('http://x/api/hooks/session-start', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer lum_ok',
      },
      body: JSON.stringify({ sessionId: 's-steward' }),
    })
    const res = await sessionStartPOST(req)
    const body = await res.json()

    expect(body.stewardMemorySection).toContain('<untrusted-team-memory>')
    expect(body.stewardMemorySection).toContain(
      'Sequence migration tasks before UI tasks'
    )
    // The steward branch queries this project's prior milestones, excluding own.
    expect(mockFindMsMemories).toHaveBeenCalledWith('p1', 'ms_current')
    // Task-bound injection path never ran.
    expect(body.memorySection).toBe('')
  })
})
