/**
 * @jest-environment node
 *
 * LUM-751 — repository-level suppression rules ride the HUMAN-ONLY disposition
 * path: a Clerk FALSE_POSITIVE with `suppressSimilarInProject` creates a
 * CrossingSuppressionRule from the crossing; a bearer (agent/CLI) identity is
 * refused 403 BEFORE the body is parsed; the HIGH classes are refused 422 with
 * no rule and no disposition write; revoke is likewise Clerk-only and soft.
 *
 * Routes run against the REAL service with repositories mocked, so the red
 * lines are proven end to end. Test names are literal MACHINE checkpointers.
 */
import { POST } from '@/app/api/tasks/[id]/boundary-crossings/disposition/route'
import { DELETE } from '@/app/api/tasks/[id]/boundary-crossings/suppression-rules/[ruleId]/route'
import { requireIdentity } from '@/lib/auth'
import { resolveTaskParam } from '@/lib/api/resolve-task-param'
import { boundaryCrossingRepository } from '@/lib/repositories/boundary-crossing.repository'
import { crossingSuppressionRuleRepository } from '@/lib/repositories/crossing-suppression-rule.repository'
import { activityRepository } from '@/lib/repositories/activity.repository'
import { taskRepository } from '@/lib/repositories/task.repository'

jest.mock('@/lib/auth', () => ({ requireIdentity: jest.fn() }))
const mockAudit = jest.fn()
jest.mock('@/lib/services/audit.service', () => ({
  ...jest.requireActual('@/lib/services/audit.service'),
  recordAuditEvent: (...a: unknown[]) => mockAudit(...a),
}))
jest.mock('@/lib/api/resolve-task-param', () => ({
  resolveTaskParam: jest.fn(),
}))
jest.mock('@/lib/repositories/boundary-crossing.repository', () => ({
  boundaryCrossingRepository: {
    findById: jest.fn(),
    findAllByTask: jest.fn(),
    listExplanationsByCrossingIds: jest.fn(() => []),
    disposition: jest.fn(),
    setRemediationTask: jest.fn(),
  },
}))
jest.mock('@/lib/repositories/crossing-suppression-rule.repository', () => ({
  crossingSuppressionRuleRepository: {
    // LUM-759: creating/revoking a rule also applies/undoes it on the existing
    // crossings, in one transaction — so these replaced the bare create/revoke.
    createWithRetroactiveSweep: jest.fn(),
    findById: jest.fn(),
    revokeWithRestore: jest.fn(),
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
const disposition = boundaryCrossingRepository.disposition as jest.Mock
const ruleCreate =
  crossingSuppressionRuleRepository.createWithRetroactiveSweep as jest.Mock
const ruleFindById = crossingSuppressionRuleRepository.findById as jest.Mock
const ruleRevoke =
  crossingSuppressionRuleRepository.revokeWithRestore as jest.Mock
const createActivity = activityRepository.create as jest.Mock
const findWithProject = taskRepository.findWithProject as jest.Mock

const CLERK = {
  clerkId: 'clerk-1',
  memberId: 'member-1',
  workspaceId: 'w-1',
  source: 'clerk' as const,
}
const BEARER = { ...CLERK, source: 'bearer' as const }

const crossing = (over: Record<string, unknown> = {}) => ({
  id: 'bc-1',
  taskId: 't-1',
  category: 'PROJECT_RULE_VIOLATION',
  detail: 'gh pr create --base main',
  target: 'actionrule:r1',
  severity: 'MEDIUM',
  disposition: null,
  ...over,
})

function req(body?: unknown) {
  const json = jest.fn(async () => {
    if (body === undefined) throw new Error('no body')
    return body
  })
  return {
    request: { json, headers: { get: () => null } } as never,
    json,
  }
}
const postParams = { params: Promise.resolve({ id: 'LUM-751' }) }
const delParams = (ruleId = 'rule-1') => ({
  params: Promise.resolve({ id: 'LUM-751', ruleId }),
})

beforeEach(() => {
  jest.clearAllMocks()
  mockIdentity.mockResolvedValue(CLERK)
  mockResolveTask.mockResolvedValue({ id: 't-1' })
  findById.mockResolvedValue(crossing())
  findWithProject.mockResolvedValue({ id: 't-1', projectId: 'p-1' })
  ruleCreate.mockResolvedValue({
    id: 'rule-1',
    suppressedCount: 0,
    capped: false,
  })
  ruleRevoke.mockResolvedValue({ reopenedCount: 0 })
  disposition.mockResolvedValue({ count: 1 })
  createActivity.mockResolvedValue({ id: 'act-1' })
})

describe('rule creation rides the human-only disposition route', () => {
  it('bearer identity with a suppress body is refused 403 before parse and creates no rule', async () => {
    mockIdentity.mockResolvedValue(BEARER)
    const { request, json } = req({
      crossingId: 'bc-1',
      disposition: 'FALSE_POSITIVE',
      suppressSimilarInProject: true,
    })
    const res = await POST(request, postParams)
    expect(res.status).toBe(403)
    expect(json).not.toHaveBeenCalled()
    expect(ruleCreate).not.toHaveBeenCalled()
    expect(disposition).not.toHaveBeenCalled()
  })

  it('clerk FALSE_POSITIVE with suppressSimilarInProject creates a rule from the crossing then dispositions', async () => {
    const { request } = req({
      crossingId: 'bc-1',
      disposition: 'FALSE_POSITIVE',
      dispositionNote: 'PR target',
      suppressSimilarInProject: true,
      suppressionReason: 'PR target branch, not a write to main',
    })
    const res = await POST(request, postParams)
    expect(res.status).toBe(200)
    expect(ruleCreate).toHaveBeenCalledWith(
      {
        projectId: 'p-1',
        category: 'PROJECT_RULE_VIOLATION',
        targetPattern: 'actionrule:r1',
        reason: 'PR target branch, not a write to main',
        createdById: 'member-1',
        sourceCrossingId: 'bc-1',
      },
      expect.objectContaining({ limit: expect.any(Number) })
    )
    expect(disposition).toHaveBeenCalledWith(
      'bc-1',
      'FALSE_POSITIVE',
      'PR target',
      'actor-1',
      expect.any(Date)
    )
    const body = await res.json()
    expect(body.suppressionRuleId).toBe('rule-1')
    // the audit row carries the rule ref
    const act = createActivity.mock.calls[0]![0] as {
      payload: Record<string, unknown>
    }
    expect(act.payload.suppressionRuleId).toBe('rule-1')
  })

  it.each([
    'HARDCODED_SECRET',
    'DESTRUCTIVE_DB_COMMAND',
    'EXFILTRATION_PUBLIC',
    'CLOUD_DATA_DELETION',
    'INFRA_TERMINATION',
  ])(
    '%s is refused 422 with no rule and no disposition write',
    async category => {
      findById.mockResolvedValue(crossing({ category, target: 'x' }))
      const { request } = req({
        crossingId: 'bc-1',
        disposition: 'FALSE_POSITIVE',
        suppressSimilarInProject: true,
      })
      const res = await POST(request, postParams)
      expect(res.status).toBe(422)
      expect(ruleCreate).not.toHaveBeenCalled()
      expect(disposition).not.toHaveBeenCalled()
    }
  )

  it('a crossing without a coalescing target cannot seed a rule (422, nothing written)', async () => {
    findById.mockResolvedValue(crossing({ target: null }))
    const { request } = req({
      crossingId: 'bc-1',
      disposition: 'FALSE_POSITIVE',
      suppressSimilarInProject: true,
    })
    const res = await POST(request, postParams)
    expect(res.status).toBe(422)
    expect(ruleCreate).not.toHaveBeenCalled()
    expect(disposition).not.toHaveBeenCalled()
  })

  it('the suppress flag with CONFIRMED is ignored (no rule, normal disposition)', async () => {
    const { request } = req({
      crossingId: 'bc-1',
      disposition: 'CONFIRMED',
      suppressSimilarInProject: true,
    })
    const res = await POST(request, postParams)
    expect(res.status).toBe(200)
    expect(ruleCreate).not.toHaveBeenCalled()
    expect(disposition).toHaveBeenCalled()
  })

  it('a plain disposition body without the flag is unchanged (strict schema still 400s on junk)', async () => {
    const ok = await POST(
      req({ crossingId: 'bc-1', disposition: 'FALSE_POSITIVE' }).request,
      postParams
    )
    expect(ok.status).toBe(200)
    expect(ruleCreate).not.toHaveBeenCalled()
    const bad = await POST(
      req({ crossingId: 'bc-1', disposition: 'FALSE_POSITIVE', smuggled: 1 })
        .request,
      postParams
    )
    expect(bad.status).toBe(400)
  })
})

describe('revoking a rule is human-only and soft', () => {
  it('bearer identity is refused 403 and nothing is revoked', async () => {
    mockIdentity.mockResolvedValue(BEARER)
    const res = await DELETE(req().request, delParams())
    expect(res.status).toBe(403)
    expect(ruleRevoke).not.toHaveBeenCalled()
  })

  it('clerk revoke on a rule of the task project sets revokedAt via a soft revoke, never a delete', async () => {
    ruleFindById.mockResolvedValue({
      id: 'rule-1',
      projectId: 'p-1',
      revokedAt: null,
    })
    const res = await DELETE(req().request, delParams())
    expect(res.status).toBe(200)
    expect(ruleRevoke).toHaveBeenCalledWith(
      'rule-1',
      'member-1',
      'actor-1',
      expect.any(Date)
    )
    expect(crossingSuppressionRuleRepository).not.toHaveProperty('delete')
    const body = await res.json()
    expect(body.ruleId).toBe('rule-1')
    expect(typeof body.revokedAt).toBe('string')
  })

  it('an already-revoked rule is idempotent (200, no second write)', async () => {
    ruleFindById.mockResolvedValue({
      id: 'rule-1',
      projectId: 'p-1',
      revokedAt: new Date('2026-09-01T00:00:00Z'),
    })
    const res = await DELETE(req().request, delParams())
    expect(res.status).toBe(200)
    expect(ruleRevoke).not.toHaveBeenCalled()
  })

  it('a rule belonging to another project is 404', async () => {
    ruleFindById.mockResolvedValue({
      id: 'rule-9',
      projectId: 'p-other',
      revokedAt: null,
    })
    const res = await DELETE(req().request, delParams('rule-9'))
    expect(res.status).toBe(404)
    expect(ruleRevoke).not.toHaveBeenCalled()
  })
})

describe('LUM-907 crossing rulings are audited', () => {
  const ctx = expect.objectContaining({
    actor: { type: 'MEMBER', clerkId: 'clerk-1', memberId: 'member-1' },
    source: 'WEB',
  })

  it('crossing audit: a web ruling with a repository rule records the transition and the rule', async () => {
    findWithProject.mockResolvedValue({ id: 't-1', projectId: 'p-1' })
    ruleCreate.mockResolvedValue({
      id: 'rule-1',
      suppressedCount: 2,
      capped: false,
    })
    const { request } = req({
      crossingId: 'bc-1',
      disposition: 'FALSE_POSITIVE',
      dispositionNote: 'secret-note',
      suppressSimilarInProject: true,
    })
    expect((await POST(request, postParams)).status).toBe(200)
    expect(mockAudit).toHaveBeenCalledTimes(1)
    expect(mockAudit).toHaveBeenCalledWith({
      workspaceId: 'w-1',
      action: 'boundary_crossing.dispositioned',
      target: { type: 'boundary_crossing', id: 'bc-1' },
      metadata: {
        taskId: 't-1',
        category: 'PROJECT_RULE_VIOLATION',
        from: null,
        to: 'FALSE_POSITIVE',
        channel: 'WEB',
        suppressionRuleId: 'rule-1',
        retroactivelySuppressed: 2,
      },
      context: ctx,
    })
    // Neither the note nor the crossing detail goes into the audit log.
    const recorded = JSON.stringify(mockAudit.mock.calls)
    expect(recorded).not.toContain('secret-note')
    expect(recorded).not.toContain('gh pr create')
  })

  it('crossing audit: re-ruling the same value without a rule records nothing', async () => {
    findById.mockResolvedValue(crossing({ disposition: 'CONFIRMED' }))
    const { request } = req({ crossingId: 'bc-1', disposition: 'CONFIRMED' })
    expect((await POST(request, postParams)).status).toBe(200)
    expect(mockAudit).not.toHaveBeenCalled()
  })

  it('crossing audit: revoking a rule records it; an idempotent re-revoke does not', async () => {
    ruleFindById.mockResolvedValue({
      id: 'rule-1',
      projectId: 'p-1',
      revokedAt: null,
    })
    ruleRevoke.mockResolvedValue({ reopenedCount: 3 })
    expect((await DELETE(req().request, delParams())).status).toBe(200)
    expect(mockAudit).toHaveBeenCalledWith({
      workspaceId: 'w-1',
      action: 'boundary_crossing.suppression_rule_revoked',
      target: { type: 'suppression_rule', id: 'rule-1' },
      metadata: { taskId: 't-1', projectId: 'p-1', reopenedCount: 3 },
      context: ctx,
    })
    mockAudit.mockClear()
    ruleFindById.mockResolvedValue({
      id: 'rule-1',
      projectId: 'p-1',
      revokedAt: new Date(),
    })
    expect((await DELETE(req().request, delParams())).status).toBe(200)
    expect(mockAudit).not.toHaveBeenCalled()
  })
})
