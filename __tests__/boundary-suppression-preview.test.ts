/**
 * @jest-environment node
 *
 * LUM-759 — the read-only preview behind the panel's opt-in.
 *
 * Before a human ticks "auto-handle this kind in this repository", they are
 * told how many ALREADY-RECORDED alerts the ruling will dispose along with
 * this one. That number has to come from the same predicate the sweep uses
 * (otherwise the promise and the effect drift apart), it must cost nothing —
 * no rule, no disposition, no activity — and it belongs to the human-only
 * ruling flow, so the agent/CLI path is closed exactly like its siblings.
 *
 * The route runs against the REAL service with repositories mocked.
 * Test names below are literal MACHINE checkpointers — do not rename.
 */
import { GET } from '@/app/api/tasks/[id]/boundary-crossings/[crossingId]/suppression-preview/route'
import { requireIdentity } from '@/lib/auth'
import { resolveTaskParam } from '@/lib/api/resolve-task-param'
import { boundaryCrossingRepository } from '@/lib/repositories/boundary-crossing.repository'
import { crossingSuppressionRuleRepository } from '@/lib/repositories/crossing-suppression-rule.repository'
import { activityRepository } from '@/lib/repositories/activity.repository'
import { taskRepository } from '@/lib/repositories/task.repository'
import { RETROACTIVE_SUPPRESSION_CAP } from '@/lib/boundary-crossing/suppression'

jest.mock('@/lib/auth', () => ({ requireIdentity: jest.fn() }))
jest.mock('@/lib/api/resolve-task-param', () => ({
  resolveTaskParam: jest.fn(),
}))
jest.mock('@/lib/repositories/boundary-crossing.repository', () => ({
  boundaryCrossingRepository: {
    findById: jest.fn(),
    countRetroactiveSuppressionCandidates: jest.fn(),
    disposition: jest.fn(),
    findAllByTask: jest.fn(),
    listExplanationsByCrossingIds: jest.fn(() => []),
    setRemediationTask: jest.fn(),
  },
}))
jest.mock('@/lib/repositories/crossing-suppression-rule.repository', () => ({
  crossingSuppressionRuleRepository: {
    createWithRetroactiveSweep: jest.fn(),
    revokeWithRestore: jest.fn(),
    findById: jest.fn(),
    findActiveForProject: jest.fn(async () => []),
  },
}))
jest.mock('@/lib/repositories/activity.repository', () => ({
  activityRepository: {
    create: jest.fn(),
    listDispositionChangesByTask: jest.fn(),
  },
}))
jest.mock('@/lib/repositories/member.repository', () => ({
  memberRepository: {
    findActorByMemberId: jest.fn(async () => ({ id: 'actor-1' })),
  },
}))
jest.mock('@/lib/repositories/task.repository', () => ({
  taskRepository: { findWithProject: jest.fn(), findHeaderById: jest.fn() },
}))
jest.mock('@/lib/services/task-creation.service', () => ({
  createTask: jest.fn(),
}))
jest.mock('@/lib/services/task-dependency.service', () => ({
  taskDependencyService: { addManual: jest.fn() },
}))
jest.mock('@/lib/repositories/hook-event.repository', () => ({
  hookEventRepository: {
    findManyByIdsForEditChange: jest.fn(),
    findTurnSummariesForSessions: jest.fn(),
    findManyByIdsForAttribution: jest.fn(),
    findTurnUsageForSessions: jest.fn(),
  },
}))
jest.mock('@/lib/repositories/session.repository', () => ({
  sessionRepository: { findManyForAttribution: jest.fn() },
}))

const mockIdentity = requireIdentity as jest.Mock
const mockResolveTask = resolveTaskParam as jest.Mock
const findById = boundaryCrossingRepository.findById as jest.Mock
const countCandidates =
  boundaryCrossingRepository.countRetroactiveSuppressionCandidates as jest.Mock
const findWithProject = taskRepository.findWithProject as jest.Mock

const CLERK = {
  source: 'clerk',
  workspaceId: 'w-1',
  memberId: 'member-1',
  clerkId: 'clerk-1',
}
const BEARER = {
  source: 'bearer',
  workspaceId: 'w-1',
  memberId: 'member-1',
  clerkId: 'clerk-1',
}

const params = (crossingId = 'bc-1') => ({
  params: Promise.resolve({ id: 'LUM-759', crossingId }),
})
const request = () =>
  new Request(
    'http://localhost/api/tasks/LUM-759/boundary-crossings/bc-1/suppression-preview'
  ) as never

beforeEach(() => {
  jest.clearAllMocks()
  mockIdentity.mockResolvedValue(CLERK)
  mockResolveTask.mockResolvedValue({ id: 't-1' })
  findWithProject.mockResolvedValue({ id: 't-1', projectId: 'p-1' })
  findById.mockResolvedValue({
    id: 'bc-1',
    taskId: 't-1',
    category: 'PROJECT_RULE_VIOLATION',
    target: 'actionrule:a8c320ce',
    disposition: null,
  })
  countCandidates.mockResolvedValue(30)
})

const noWrites = () => {
  expect(
    crossingSuppressionRuleRepository.createWithRetroactiveSweep
  ).not.toHaveBeenCalled()
  expect(boundaryCrossingRepository.disposition).not.toHaveBeenCalled()
  expect(activityRepository.create).not.toHaveBeenCalled()
}

describe('LUM-759 — suppression scope preview', () => {
  it('returns how many existing crossings the rule would dispose, and writes nothing', async () => {
    const res = await GET(request(), params())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      suppressible: true,
      count: 30,
      capped: false,
      cap: RETROACTIVE_SUPPRESSION_CAP,
    })
    // Same predicate the sweep runs, and the crossing being ruled on is not
    // part of the "other existing alerts" it promises to handle.
    expect(countCandidates).toHaveBeenCalledWith({
      projectId: 'p-1',
      category: 'PROJECT_RULE_VIOLATION',
      targetPattern: 'actionrule:a8c320ce',
      excludeCrossingId: 'bc-1',
    })
    noWrites()
  })

  it('reports capped when there are more matches than one creation may stamp', async () => {
    countCandidates.mockResolvedValue(RETROACTIVE_SUPPRESSION_CAP + 12)
    const res = await GET(request(), params())
    const body = await res.json()
    expect(body.capped).toBe(true)
    expect(body.count).toBe(RETROACTIVE_SUPPRESSION_CAP)
    noWrites()
  })

  it('a crossing no rule can be built from reports not suppressible with a zero count', async () => {
    findById.mockResolvedValue({
      id: 'bc-1',
      taskId: 't-1',
      category: 'HARDCODED_SECRET',
      target: 'lib/secret.ts',
      disposition: null,
    })
    const high = await GET(request(), params())
    expect(await high.json()).toMatchObject({
      suppressible: false,
      count: 0,
      capped: false,
    })

    findById.mockResolvedValue({
      id: 'bc-1',
      taskId: 't-1',
      category: 'PROJECT_RULE_VIOLATION',
      target: null,
      disposition: null,
    })
    const legacy = await GET(request(), params())
    expect(await legacy.json()).toMatchObject({
      suppressible: false,
      count: 0,
    })
    expect(countCandidates).not.toHaveBeenCalled()
    noWrites()
  })

  it('a bearer (agent/CLI) identity is refused 403 before anything is read', async () => {
    mockIdentity.mockResolvedValue(BEARER)
    const res = await GET(request(), params())
    expect(res.status).toBe(403)
    expect(mockResolveTask).not.toHaveBeenCalled()
    expect(findById).not.toHaveBeenCalled()
    expect(countCandidates).not.toHaveBeenCalled()
    noWrites()
  })

  it('a crossing that is not on this task is 404', async () => {
    findById.mockResolvedValue({
      id: 'bc-9',
      taskId: 't-other',
      category: 'PROJECT_RULE_VIOLATION',
      target: 'actionrule:a8c320ce',
      disposition: null,
    })
    const res = await GET(request(), params('bc-9'))
    expect(res.status).toBe(404)
    expect(countCandidates).not.toHaveBeenCalled()
    noWrites()
  })

  it('an unknown task is 404 and never reaches the crossing lookup', async () => {
    mockResolveTask.mockResolvedValue(null)
    const res = await GET(request(), params())
    expect(res.status).toBe(404)
    expect(findById).not.toHaveBeenCalled()
    noWrites()
  })
})
