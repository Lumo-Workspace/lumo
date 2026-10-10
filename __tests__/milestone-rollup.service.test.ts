/**
 * LUM-624 rollup + staleness hints, reshaped by LUM-714.
 *
 * Covers the pure derivation rules (lib/summaries/milestone-rollup), the
 * reconcile write path (guarded compare-and-set + retro trigger), and the
 * read-side self-heal dispatch used by the milestone detail route.
 *
 * The LUM-714 invariant these tests are really guarding: the rollup writes a
 * `completedAt` timestamp and NOTHING else — there is no status field left to
 * write, so a regression that reintroduces one shows up as an unexpected
 * argument shape here.
 */
jest.mock('@/lib/runtime/wait-until', () => ({ waitUntil: (p: unknown) => p }))
jest.mock('@/lib/repositories/milestone.repository', () => ({
  milestoneRepository: {
    findById: jest.fn(),
    countTasksByStatus: jest.fn(),
    updateCompletionIfCurrent: jest.fn(),
  },
}))
jest.mock('@/lib/services/milestone.service', () => ({
  generateMilestoneRetro: jest.fn().mockResolvedValue(undefined),
}))
// LUM-643: the rollup consults the exit-criteria close gate — default to an
// empty contract (gate open) so pre-existing rollup behavior is unchanged.
jest.mock('@/lib/repositories/milestone-exit-criterion.repository', () => ({
  milestoneExitCriterionRepository: {
    countUnresolved: jest.fn().mockResolvedValue(0),
  },
}))

import { milestoneRollupService } from '@/lib/services/milestone-rollup.service'
import {
  deriveCompletionChange,
  computeMilestoneStaleness,
} from '@/lib/summaries/milestone-rollup'
import { milestoneRepository } from '@/lib/repositories/milestone.repository'
import { generateMilestoneRetro } from '@/lib/services/milestone.service'
import type { TaskStatus } from '@prisma/client'

const mockFindById = milestoneRepository.findById as jest.Mock
const mockCounts = milestoneRepository.countTasksByStatus as jest.Mock
const mockGuardedUpdate =
  milestoneRepository.updateCompletionIfCurrent as jest.Mock
const mockRetro = generateMilestoneRetro as jest.Mock

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

function milestoneRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'm-1',
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

describe('milestone completion rollup (LUM-624/LUM-714)', () => {
  it('derived completion stamps completedAt and fires retro when the last open task turns DONE', async () => {
    // The 26/26-DONE shape: every task done, no completion stamp yet.
    mockFindById.mockResolvedValue(milestoneRow())
    mockCounts.mockResolvedValue(counts({ DONE: 26 }))

    await milestoneRollupService.reconcileMilestoneCompletion('m-1')

    // Compare-and-set on the completedAt we derived from; a Date is the ONLY
    // thing written — no status argument exists any more.
    expect(mockGuardedUpdate).toHaveBeenCalledWith(
      'm-1',
      null,
      expect.any(Date)
    )
    expect(mockRetro).toHaveBeenCalledWith('m-1')

    // Guarded write lost the race (concurrent write) → no retro.
    mockGuardedUpdate.mockResolvedValue(false)
    mockRetro.mockClear()
    await milestoneRollupService.reconcileMilestoneCompletion('m-1')
    expect(mockRetro).not.toHaveBeenCalled()

    // Already stamped → nothing to do (and no duplicate retro).
    mockGuardedUpdate.mockClear().mockResolvedValue(true)
    mockRetro.mockClear()
    mockFindById.mockResolvedValue(
      milestoneRow({ completedAt: new Date('2026-06-01') })
    )
    await milestoneRollupService.reconcileMilestoneCompletion('m-1')
    expect(mockGuardedUpdate).not.toHaveBeenCalled()
    expect(mockRetro).not.toHaveBeenCalled()

    // Archived is the human terminal choice — task churn never resurrects it.
    mockGuardedUpdate.mockClear()
    mockFindById.mockResolvedValue(
      milestoneRow({ archivedAt: new Date('2026-01-01') })
    )
    await milestoneRollupService.reconcileMilestoneCompletion('m-1')
    expect(mockGuardedUpdate).not.toHaveBeenCalled()

    // Zero tasks carry no signal — an empty milestone is never auto-completed.
    expect(
      deriveCompletionChange({
        completedAt: null,
        archived: false,
        taskCounts: counts({}),
      })
    ).toBeNull()
  })

  it('reopens a completed milestone when a non-DONE task reappears, and leaves in-flight ones alone', async () => {
    // A non-DONE task (re)appeared under a completed milestone → clear the
    // stamp. No retro on the way back out.
    mockFindById.mockResolvedValue(
      milestoneRow({ completedAt: new Date('2026-06-01') })
    )
    mockCounts.mockResolvedValue(counts({ TODO: 1, DONE: 26 }))
    await milestoneRollupService.reconcileMilestoneCompletion('m-1')
    expect(mockGuardedUpdate).toHaveBeenCalledWith(
      'm-1',
      new Date('2026-06-01'),
      null
    )
    expect(mockRetro).not.toHaveBeenCalled()

    // An in-flight milestone with no stamp has nothing to reconcile — the old
    // PLANNED→ACTIVE transition has no successor, so this is a no-op now.
    mockGuardedUpdate.mockClear()
    mockFindById.mockResolvedValue(milestoneRow())
    mockCounts.mockResolvedValue(counts({ TODO: 3, IN_PROGRESS: 1 }))
    await milestoneRollupService.reconcileMilestoneCompletion('m-1')
    expect(mockGuardedUpdate).not.toHaveBeenCalled()
  })

  it('milestone detail read dispatches reconcile when stored completion drifts from the task counts', async () => {
    const reconcileSpy = jest
      .spyOn(milestoneRollupService, 'reconcileMilestoneCompletion')
      .mockResolvedValue(undefined)

    // No stamp vs all-done tasks → drift surfaced + self-heal dispatched.
    const staleness = await milestoneRollupService.observeOnRead(
      {
        id: 'm-1',
        completedAt: null,
        archivedAt: null,
        targetDate: null,
      },
      counts({ DONE: 26 })
    )
    expect(staleness.completionDrift).toBe('complete')
    expect(reconcileSpy).toHaveBeenCalledWith('m-1')

    // Stored completion already matches the task counts → no dispatch.
    reconcileSpy.mockClear()
    const consistent = await milestoneRollupService.observeOnRead(
      {
        id: 'm-1',
        completedAt: null,
        archivedAt: null,
        targetDate: new Date('2026-08-01'),
      },
      counts({ TODO: 2, IN_PROGRESS: 1 })
    )
    expect(consistent.completionDrift).toBeNull()
    expect(reconcileSpy).not.toHaveBeenCalled()

    reconcileSpy.mockRestore()
  })

  it('flags dates-missing staleness hint for an in-flight milestone without target date', () => {
    // In flight, no target date → hint.
    expect(
      computeMilestoneStaleness({
        completedAt: null,
        archived: false,
        taskCounts: counts({ TODO: 2, DONE: 1 }),
        targetDate: null,
      })
    ).toEqual({ completionDrift: null, datesMissing: true })

    // Target date present → no hint.
    expect(
      computeMilestoneStaleness({
        completedAt: null,
        archived: false,
        taskCounts: counts({ TODO: 2, DONE: 1 }),
        targetDate: new Date('2026-08-01'),
      }).datesMissing
    ).toBe(false)

    // Effectively completed (drifting to `complete`) → no date nag.
    expect(
      computeMilestoneStaleness({
        completedAt: null,
        archived: false,
        taskCounts: counts({ DONE: 26 }),
        targetDate: null,
      })
    ).toEqual({ completionDrift: 'complete', datesMissing: false })

    // Archived → no hint either.
    expect(
      computeMilestoneStaleness({
        completedAt: null,
        archived: true,
        taskCounts: counts({ TODO: 3 }),
        targetDate: null,
      }).datesMissing
    ).toBe(false)
  })
})
