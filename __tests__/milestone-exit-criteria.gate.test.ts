/**
 * LUM-643 milestone close gate, re-anchored on derived completion (LUM-714).
 *
 * Completion is no longer a status a caller can set, so the gate now guards
 * two paths:
 *  - the LUM-624 auto-rollup (`reconcileMilestoneCompletion` withholds a
 *    task-derived completion while the contract is unresolved — fail-closed,
 *    no stamp, no retro);
 *  - the explicit human override (`overrideMilestoneClose` stamps completedAt
 *    past the gate and records the completedOverride* trail).
 */
const mockProjectGet = jest.fn()
const mockRepoFindById = jest.fn()
const mockRepoUpdate = jest.fn()
const mockRepoCountTasks = jest.fn()
const mockRepoGuardedUpdate = jest.fn()
const mockCountHeld = jest.fn().mockResolvedValue(0)

jest.mock('@/lib/runtime/wait-until', () => ({ waitUntil: (p: unknown) => p }))
jest.mock('@/lib/services/project.service', () => ({
  projectService: { getProject: (...a: unknown[]) => mockProjectGet(...a) },
}))
jest.mock('@/lib/repositories/milestone.repository', () => ({
  milestoneRepository: {
    findById: (...a: unknown[]) => mockRepoFindById(...a),
    update: (...a: unknown[]) => mockRepoUpdate(...a),
    countTasksByStatus: (...a: unknown[]) => mockRepoCountTasks(...a),
    updateCompletionIfCurrent: (...a: unknown[]) => mockRepoGuardedUpdate(...a),
  },
}))
jest.mock('@/lib/services/milestone-close-gate.service', () => ({
  milestoneCloseGateService: {
    countHeld: (...a: unknown[]) => mockCountHeld(...a),
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
    archivedAt: null,
    completedAt: null,
    targetDate: null,
    description: null,
    ...overrides,
  }
}

function counts(
  partial: Partial<Record<TaskStatus, number>>
): Record<TaskStatus, number> {
  return {
    BACKLOG: 0,
    TODO: 0,
    IN_PROGRESS: 0,
    IN_REVIEW: 0,
    DONE: 0,
    ...partial,
  }
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

describe('milestone close gate (LUM-643/LUM-714)', () => {
  it('rollup withholds derived completion while exit criteria are unresolved', async () => {
    // All 26 tasks DONE, but 2 exit criteria unresolved → the LUM-624
    // auto-completion is withheld: no stamp written, no retro.
    mockRepoCountTasks.mockResolvedValue(counts({ DONE: 26 }))
    mockCountHeld.mockResolvedValue(2)

    await milestoneRollupService.reconcileMilestoneCompletion('m-1')
    expect(mockRepoGuardedUpdate).not.toHaveBeenCalled()

    // Contract resolved (all MET) → the same shape auto-completes.
    mockCountHeld.mockResolvedValue(0)
    await milestoneRollupService.reconcileMilestoneCompletion('m-1')
    expect(mockRepoGuardedUpdate).toHaveBeenCalledWith(
      'm-1',
      null,
      expect.any(Date)
    )

    // The gate only holds completion shut: reopening (a task moved back off
    // DONE) is never blocked by an unresolved contract — otherwise a milestone
    // would stay stamped complete while work is demonstrably open.
    mockRepoGuardedUpdate.mockClear()
    mockCountHeld.mockResolvedValue(2)
    const stampedAt = new Date('2026-06-01')
    mockRepoFindById.mockResolvedValue(milestoneRow({ completedAt: stampedAt }))
    mockRepoCountTasks.mockResolvedValue(counts({ TODO: 1, DONE: 26 }))
    await milestoneRollupService.reconcileMilestoneCompletion('m-1')
    expect(mockRepoGuardedUpdate).toHaveBeenCalledWith('m-1', stampedAt, null)

    // Fail-closed: a criteria-count read failure aborts the reconcile
    // (swallowed upstream by dispatchRollup) rather than completing past an
    // unread contract.
    mockRepoGuardedUpdate.mockClear()
    mockRepoFindById.mockResolvedValue(milestoneRow())
    mockRepoCountTasks.mockResolvedValue(counts({ DONE: 26 }))
    mockCountHeld.mockRejectedValue(new Error('db down'))
    await expect(
      milestoneRollupService.reconcileMilestoneCompletion('m-1')
    ).rejects.toThrow('db down')
    expect(mockRepoGuardedUpdate).not.toHaveBeenCalled()
  })

  it('human override stamps completion past the gate and records the trail', async () => {
    // With unresolved criteria the override closes AND leaves the persistent
    // trail: actor, time, note.
    mockCountHeld.mockResolvedValue(1)
    await milestoneService.overrideMilestoneClose(
      'm-1',
      'mem-1',
      'shipping with known gap'
    )
    expect(mockRepoUpdate).toHaveBeenCalledWith('m-1', {
      completedAt: expect.any(Date),
      completedOverrideAt: expect.any(Date),
      completedOverrideByMemberId: 'mem-1',
      completedOverrideNote: 'shipping with known gap',
    })

    // An adjudicated NOT_MET criterion holds the gate the same way a pending
    // one does — a failed contract is still an overridable one.
    mockRepoUpdate.mockClear()
    mockCountHeld.mockResolvedValue(1)
    await milestoneService.overrideMilestoneClose('m-1', 'mem-1', null)
    const written = mockRepoUpdate.mock.calls[0]?.[1] as Record<string, unknown>
    expect(written.completedOverrideByMemberId).toBe('mem-1')
    expect(written.completedOverrideNote).toBeNull()

    // Nothing to override (gate already open) → 409, nothing written. The
    // trail only ever records real overrides, and completion otherwise stays
    // the rollup's job.
    mockRepoUpdate.mockClear()
    mockCountHeld.mockResolvedValue(0)
    await expect(
      milestoneService.overrideMilestoneClose('m-1', 'mem-1', 'noop')
    ).rejects.toMatchObject({ status: 409 })
    expect(mockRepoUpdate).not.toHaveBeenCalled()
  })

  it('an ordinary milestone update never consults the close gate', async () => {
    // There is no status field to patch any more, so a metadata edit must not
    // touch the exit-criteria contract at all.
    mockCountHeld.mockResolvedValue(1)
    await milestoneService.updateMilestone('m-1', 'mem-1', { name: 'Renamed' })
    expect(mockCountHeld).not.toHaveBeenCalled()
    expect(mockRepoUpdate).toHaveBeenCalledWith('m-1', { name: 'Renamed' })
  })

  it('override succeeds when only test cases hold', async () => {
    mockRepoFindById.mockResolvedValue({
      id: 'm-1',
      projectId: 'p-1',
      completedAt: null,
      archivedAt: null,
    })
    mockProjectGet.mockResolvedValue({ id: 'p-1' })
    mockCountHeld.mockResolvedValue(1)
    mockRepoUpdate.mockResolvedValue({ id: 'm-1' })
    await expect(
      milestoneService.overrideMilestoneClose('m-1', 'mem-1', 'ship it')
    ).resolves.toBeTruthy()
    expect(mockRepoUpdate).toHaveBeenCalledWith(
      'm-1',
      expect.objectContaining({ completedOverrideNote: 'ship it' })
    )
  })

  it('override still refuses when nothing holds', async () => {
    mockRepoFindById.mockResolvedValue({
      id: 'm-1',
      projectId: 'p-1',
      completedAt: null,
      archivedAt: null,
    })
    mockProjectGet.mockResolvedValue({ id: 'p-1' })
    mockCountHeld.mockResolvedValue(0)
    await expect(
      milestoneService.overrideMilestoneClose('m-1', 'mem-1', null)
    ).rejects.toMatchObject({ status: 409 })
  })
})
