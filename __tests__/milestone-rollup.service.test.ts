/**
 * LUM-624: milestone status rollup + staleness hints.
 *
 * Covers the pure derivation rules (lib/summaries/milestone-rollup), the
 * reconcile write path (guarded compare-and-set + retro trigger), and the
 * read-side self-heal dispatch used by the milestone detail route.
 */
jest.mock('@vercel/functions', () => ({ waitUntil: (p: unknown) => p }))
jest.mock('@/lib/repositories/milestone.repository', () => ({
  milestoneRepository: {
    findById: jest.fn(),
    countTasksByStatus: jest.fn(),
    updateStatusIfCurrent: jest.fn(),
  },
}))
jest.mock('@/lib/services/milestone.service', () => ({
  generateMilestoneRetro: jest.fn().mockResolvedValue(undefined),
}))

import { milestoneRollupService } from '@/lib/services/milestone-rollup.service'
import {
  deriveRollupStatus,
  computeMilestoneStaleness,
} from '@/lib/summaries/milestone-rollup'
import { milestoneRepository } from '@/lib/repositories/milestone.repository'
import { generateMilestoneRetro } from '@/lib/services/milestone.service'
import type { TaskStatus } from '@prisma/client'

const mockFindById = milestoneRepository.findById as jest.Mock
const mockCounts = milestoneRepository.countTasksByStatus as jest.Mock
const mockGuardedUpdate = milestoneRepository.updateStatusIfCurrent as jest.Mock
const mockRetro = generateMilestoneRetro as jest.Mock

function counts(
  partial: Partial<Record<TaskStatus, number>>
): Record<TaskStatus, number> {
  return { TODO: 0, IN_PROGRESS: 0, IN_REVIEW: 0, DONE: 0, ...partial }
}

function milestoneRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'm-1',
    status: 'PLANNED',
    archivedAt: null,
    completedAt: null,
    targetDate: null,
    ...overrides,
  }
}

beforeEach(() => {
  mockFindById.mockReset()
  mockCounts.mockReset()
  mockGuardedUpdate.mockReset().mockResolvedValue(true)
  mockRetro.mockClear()
})

describe('milestone status rollup (LUM-624)', () => {
  it('auto-completes milestone when the last open task turns DONE', async () => {
    // The 26/26-DONE shape: every task done, stored status still PLANNED.
    mockFindById.mockResolvedValue(milestoneRow({ status: 'PLANNED' }))
    mockCounts.mockResolvedValue(counts({ DONE: 26 }))

    await milestoneRollupService.reconcileMilestoneStatus('m-1')

    expect(mockGuardedUpdate).toHaveBeenCalledWith('m-1', 'PLANNED', {
      status: 'COMPLETED',
      completedAt: expect.any(Date),
    })
    // Auto-completion mirrors the manual transition: retro fires.
    expect(mockRetro).toHaveBeenCalledWith('m-1')

    // Guarded write lost the race (concurrent manual change) → no retro.
    mockGuardedUpdate.mockResolvedValue(false)
    mockRetro.mockClear()
    await milestoneRollupService.reconcileMilestoneStatus('m-1')
    expect(mockRetro).not.toHaveBeenCalled()

    // CANCELLED and archived milestones are human terminal choices — never touched.
    mockGuardedUpdate.mockClear()
    mockFindById.mockResolvedValue(milestoneRow({ status: 'CANCELLED' }))
    await milestoneRollupService.reconcileMilestoneStatus('m-1')
    mockFindById.mockResolvedValue(
      milestoneRow({ archivedAt: new Date('2026-01-01') })
    )
    await milestoneRollupService.reconcileMilestoneStatus('m-1')
    expect(mockGuardedUpdate).not.toHaveBeenCalled()

    // Zero tasks carry no signal — an empty milestone is never auto-completed.
    expect(
      deriveRollupStatus({
        status: 'PLANNED',
        archived: false,
        taskCounts: counts({}),
      })
    ).toBeNull()
  })

  it('activates planned milestone and reopens completed milestone on task changes', async () => {
    // A task started (left TODO) → PLANNED becomes ACTIVE.
    mockFindById.mockResolvedValue(milestoneRow({ status: 'PLANNED' }))
    mockCounts.mockResolvedValue(counts({ TODO: 3, IN_PROGRESS: 1 }))
    await milestoneRollupService.reconcileMilestoneStatus('m-1')
    expect(mockGuardedUpdate).toHaveBeenCalledWith('m-1', 'PLANNED', {
      status: 'ACTIVE',
      completedAt: null,
    })

    // A non-DONE task (re)appeared under a COMPLETED milestone → back to
    // ACTIVE, completedAt cleared.
    mockGuardedUpdate.mockClear()
    mockFindById.mockResolvedValue(
      milestoneRow({ status: 'COMPLETED', completedAt: new Date('2026-06-01') })
    )
    mockCounts.mockResolvedValue(counts({ TODO: 1, DONE: 26 }))
    await milestoneRollupService.reconcileMilestoneStatus('m-1')
    expect(mockGuardedUpdate).toHaveBeenCalledWith('m-1', 'COMPLETED', {
      status: 'ACTIVE',
      completedAt: null,
    })
    expect(mockRetro).not.toHaveBeenCalled()

    // Untouched tasks (all still TODO) → PLANNED stays put.
    mockGuardedUpdate.mockClear()
    mockFindById.mockResolvedValue(milestoneRow({ status: 'PLANNED' }))
    mockCounts.mockResolvedValue(counts({ TODO: 5 }))
    await milestoneRollupService.reconcileMilestoneStatus('m-1')
    expect(mockGuardedUpdate).not.toHaveBeenCalled()
  })

  it('milestone detail read dispatches reconcile when stored status drifts from task-derived status', () => {
    const reconcileSpy = jest
      .spyOn(milestoneRollupService, 'reconcileMilestoneStatus')
      .mockResolvedValue(undefined)

    // Stored PLANNED vs all-done tasks → drift surfaced + self-heal dispatched.
    const staleness = milestoneRollupService.observeOnRead(
      {
        id: 'm-1',
        status: 'PLANNED',
        archivedAt: null,
        targetDate: null,
      },
      counts({ DONE: 26 })
    )
    expect(staleness.statusDrift).toBe('COMPLETED')
    expect(reconcileSpy).toHaveBeenCalledWith('m-1')

    // Stored status already matches the task-derived one → no dispatch.
    reconcileSpy.mockClear()
    const consistent = milestoneRollupService.observeOnRead(
      {
        id: 'm-1',
        status: 'ACTIVE',
        archivedAt: null,
        targetDate: new Date('2026-08-01'),
      },
      counts({ TODO: 2, IN_PROGRESS: 1 })
    )
    expect(consistent.statusDrift).toBeNull()
    expect(reconcileSpy).not.toHaveBeenCalled()

    reconcileSpy.mockRestore()
  })

  it('flags dates-missing staleness hint for non-terminal milestone without target date', () => {
    // In-flight (ACTIVE), no target date → hint.
    expect(
      computeMilestoneStaleness({
        status: 'ACTIVE',
        archived: false,
        taskCounts: counts({ TODO: 2, DONE: 1 }),
        targetDate: null,
      })
    ).toEqual({ statusDrift: null, datesMissing: true })

    // Target date present → no hint.
    expect(
      computeMilestoneStaleness({
        status: 'ACTIVE',
        archived: false,
        taskCounts: counts({ TODO: 2, DONE: 1 }),
        targetDate: new Date('2026-08-01'),
      }).datesMissing
    ).toBe(false)

    // Effectively terminal (drifting to COMPLETED) → no date nag.
    expect(
      computeMilestoneStaleness({
        status: 'PLANNED',
        archived: false,
        taskCounts: counts({ DONE: 26 }),
        targetDate: null,
      })
    ).toEqual({ statusDrift: 'COMPLETED', datesMissing: false })

    // Terminal by human choice → no hint either.
    expect(
      computeMilestoneStaleness({
        status: 'CANCELLED',
        archived: false,
        taskCounts: counts({ TODO: 3 }),
        targetDate: null,
      }).datesMissing
    ).toBe(false)
  })
})
