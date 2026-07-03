/**
 * LUM-643: milestone status→COMPLETED close gate.
 *
 * Covers the manual path (milestoneService.updateMilestone: 409 while any
 * exit criterion is unadjudicated or NOT_MET; explicit human override closes
 * and stamps the completedOverride* trail) and the LUM-624 auto-rollup path
 * (reconcileMilestoneStatus withholds a task-derived COMPLETED while the
 * contract is unresolved — fail-closed, no retro).
 */
const mockProjectGet = jest.fn()
const mockRepoFindById = jest.fn()
const mockRepoUpdate = jest.fn()
const mockRepoCountTasks = jest.fn()
const mockRepoGuardedUpdate = jest.fn()
const mockListUnresolved = jest.fn()
const mockCountUnresolved = jest.fn()

jest.mock('@vercel/functions', () => ({ waitUntil: (p: unknown) => p }))
jest.mock('@/lib/services/project.service', () => ({
  projectService: { getProject: (...a: unknown[]) => mockProjectGet(...a) },
}))
jest.mock('@/lib/repositories/milestone.repository', () => ({
  milestoneRepository: {
    findById: (...a: unknown[]) => mockRepoFindById(...a),
    update: (...a: unknown[]) => mockRepoUpdate(...a),
    countTasksByStatus: (...a: unknown[]) => mockRepoCountTasks(...a),
    updateStatusIfCurrent: (...a: unknown[]) => mockRepoGuardedUpdate(...a),
  },
}))
jest.mock('@/lib/repositories/milestone-exit-criterion.repository', () => ({
  milestoneExitCriterionRepository: {
    listUnresolved: (...a: unknown[]) => mockListUnresolved(...a),
    countUnresolved: (...a: unknown[]) => mockCountUnresolved(...a),
  },
}))

import { milestoneService } from '@/lib/services/milestone.service'
import { milestoneRollupService } from '@/lib/services/milestone-rollup.service'
import type { TaskStatus } from '@prisma/client'

function milestoneRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'm-1',
    projectId: 'p-1',
    name: 'Agent-Native Milestones',
    status: 'ACTIVE',
    archivedAt: null,
    completedAt: null,
    targetDate: null,
    description: null,
    ...overrides,
  }
}

function pendingCriterion(overrides: Record<string, unknown> = {}) {
  return {
    id: 'c-1',
    milestoneId: 'm-1',
    statement: 'All flywheel read models are wired to the new schema',
    referentKind: 'AGENT_CONSTRUCTED_STATE',
    source: 'AGENT_DRAFT',
    verdict: null,
    deletedAt: null,
    ...overrides,
  }
}

function counts(
  partial: Partial<Record<TaskStatus, number>>
): Record<TaskStatus, number> {
  return { TODO: 0, IN_PROGRESS: 0, IN_REVIEW: 0, DONE: 0, ...partial }
}

beforeEach(() => {
  jest.clearAllMocks()
  mockProjectGet.mockResolvedValue({ id: 'p-1', teamId: 't-1' })
  mockRepoFindById.mockResolvedValue(milestoneRow())
  mockRepoUpdate.mockImplementation(async (_id, data) => ({
    ...milestoneRow(),
    ...data,
  }))
  mockRepoGuardedUpdate.mockResolvedValue(true)
})

describe('milestone close gate (LUM-643)', () => {
  it('refuses COMPLETED with 409 while any exit criterion is unadjudicated or NOT_MET', async () => {
    // Unadjudicated criterion → 409, nothing written.
    mockListUnresolved.mockResolvedValue([pendingCriterion()])
    await expect(
      milestoneService.updateMilestone('m-1', 'mem-1', { status: 'COMPLETED' })
    ).rejects.toMatchObject({ status: 409 })
    expect(mockRepoUpdate).not.toHaveBeenCalled()

    // Adjudicated NOT_MET also holds the gate — a failed contract is not a
    // closable contract.
    mockListUnresolved.mockResolvedValue([
      pendingCriterion({ verdict: 'NOT_MET' }),
    ])
    await expect(
      milestoneService.updateMilestone('m-1', 'mem-1', { status: 'COMPLETED' })
    ).rejects.toMatchObject({ status: 409 })
    expect(mockRepoUpdate).not.toHaveBeenCalled()

    // Fully MET contract → the close proceeds, no override trail stamped.
    mockListUnresolved.mockResolvedValue([])
    await milestoneService.updateMilestone('m-1', 'mem-1', {
      status: 'COMPLETED',
    })
    expect(mockRepoUpdate).toHaveBeenCalledWith('m-1', {
      status: 'COMPLETED',
      completedAt: expect.any(Date),
    })
    const written = mockRepoUpdate.mock.calls[0]?.[1] as Record<string, unknown>
    expect(written.completedOverrideAt).toBeUndefined()
    expect(written.completedOverrideByMemberId).toBeUndefined()

    // Non-COMPLETED transitions never consult the gate.
    mockRepoUpdate.mockClear()
    mockListUnresolved.mockClear()
    await milestoneService.updateMilestone('m-1', 'mem-1', {
      status: 'CANCELLED',
    })
    expect(mockListUnresolved).not.toHaveBeenCalled()
    expect(mockRepoUpdate).toHaveBeenCalled()
  })

  it('human override closes despite unresolved exit criteria and stamps the override trail', async () => {
    mockListUnresolved.mockResolvedValue([pendingCriterion()])

    // Without the explicit override option (every agent/Bearer request — the
    // PATCH route only ever sets it on the Clerk path) the gate stands.
    await expect(
      milestoneService.updateMilestone('m-1', 'mem-1', { status: 'COMPLETED' })
    ).rejects.toMatchObject({ status: 409 })

    // The explicit human override closes AND leaves the persistent trail:
    // actor, time, note.
    await milestoneService.updateMilestone(
      'm-1',
      'mem-1',
      { status: 'COMPLETED' },
      { overrideCloseGate: true, overrideNote: 'shipping with known gap' }
    )
    expect(mockRepoUpdate).toHaveBeenCalledWith('m-1', {
      status: 'COMPLETED',
      completedAt: expect.any(Date),
      completedOverrideAt: expect.any(Date),
      completedOverrideByMemberId: 'mem-1',
      completedOverrideNote: 'shipping with known gap',
    })

    // A note-less override still stamps who/when (note recorded as null).
    mockRepoUpdate.mockClear()
    await milestoneService.updateMilestone(
      'm-1',
      'mem-1',
      { status: 'COMPLETED' },
      { overrideCloseGate: true }
    )
    const written = mockRepoUpdate.mock.calls[0]?.[1] as Record<string, unknown>
    expect(written.completedOverrideByMemberId).toBe('mem-1')
    expect(written.completedOverrideNote).toBeNull()

    // An override on a gate that is OPEN stamps nothing — the trail only
    // records real overrides.
    mockRepoUpdate.mockClear()
    mockListUnresolved.mockResolvedValue([])
    await milestoneService.updateMilestone(
      'm-1',
      'mem-1',
      { status: 'COMPLETED' },
      { overrideCloseGate: true, overrideNote: 'noop' }
    )
    const clean = mockRepoUpdate.mock.calls[0]?.[1] as Record<string, unknown>
    expect(clean.completedOverrideAt).toBeUndefined()
    expect(clean.completedOverrideNote).toBeUndefined()
  })

  it('rollup withholds derived COMPLETED while exit criteria are unresolved', async () => {
    // All 26 tasks DONE, but 2 exit criteria unresolved → the LUM-624
    // auto-completion is withheld: no status write, no retro.
    mockRepoFindById.mockResolvedValue(milestoneRow({ status: 'ACTIVE' }))
    mockRepoCountTasks.mockResolvedValue(counts({ DONE: 26 }))
    mockCountUnresolved.mockResolvedValue(2)

    await milestoneRollupService.reconcileMilestoneStatus('m-1')
    expect(mockRepoGuardedUpdate).not.toHaveBeenCalled()

    // Contract resolved (all MET) → the same shape auto-completes again.
    mockCountUnresolved.mockResolvedValue(0)
    await milestoneRollupService.reconcileMilestoneStatus('m-1')
    expect(mockRepoGuardedUpdate).toHaveBeenCalledWith('m-1', 'ACTIVE', {
      status: 'COMPLETED',
      completedAt: expect.any(Date),
    })

    // The gate only holds COMPLETED: reopening (COMPLETED → ACTIVE on a
    // reopened task) is never blocked by an unresolved contract.
    mockRepoGuardedUpdate.mockClear()
    mockCountUnresolved.mockResolvedValue(2)
    mockRepoFindById.mockResolvedValue(
      milestoneRow({ status: 'COMPLETED', completedAt: new Date() })
    )
    mockRepoCountTasks.mockResolvedValue(counts({ TODO: 1, DONE: 26 }))
    await milestoneRollupService.reconcileMilestoneStatus('m-1')
    expect(mockRepoGuardedUpdate).toHaveBeenCalledWith('m-1', 'COMPLETED', {
      status: 'ACTIVE',
      completedAt: null,
    })

    // Fail-closed: a criteria-count read failure aborts the reconcile
    // (swallowed upstream by dispatchRollup) rather than completing past an
    // unread contract.
    mockRepoGuardedUpdate.mockClear()
    mockRepoFindById.mockResolvedValue(milestoneRow({ status: 'ACTIVE' }))
    mockRepoCountTasks.mockResolvedValue(counts({ DONE: 26 }))
    mockCountUnresolved.mockRejectedValue(new Error('db down'))
    await expect(
      milestoneRollupService.reconcileMilestoneStatus('m-1')
    ).rejects.toThrow('db down')
    expect(mockRepoGuardedUpdate).not.toHaveBeenCalled()
  })
})
