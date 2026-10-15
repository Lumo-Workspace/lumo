/**
 * LUM-1141: with exit criteria dropped, the close gate reads milestone test
 * cases only. Drives the real rollup + close-gate services over mocked
 * repositories, so the gate wiring itself is under test.
 */
jest.mock('@/lib/runtime/wait-until', () => ({ waitUntil: (p: unknown) => p }))
jest.mock('@/lib/repositories/milestone.repository', () => ({
  milestoneRepository: {
    findById: jest.fn(),
    countTasksByStatus: jest.fn(),
    updateCompletionIfCurrent: jest.fn(),
  },
}))
jest.mock('@/lib/repositories/test-case.repository', () => ({
  testCaseRepository: {
    listForMilestone: jest.fn(),
    runsPerCaseForMilestone: jest.fn(),
  },
}))
jest.mock('@/lib/services/milestone.service', () => ({
  generateMilestoneRetro: jest.fn().mockResolvedValue(undefined),
}))

import { milestoneRollupService } from '@/lib/services/milestone-rollup.service'
import { milestoneRepository } from '@/lib/repositories/milestone.repository'
import { testCaseRepository } from '@/lib/repositories/test-case.repository'

const milestones = milestoneRepository as jest.Mocked<
  typeof milestoneRepository
>
const testCases = testCaseRepository as jest.Mocked<typeof testCaseRepository>

const allDone = {
  BACKLOG: 0,
  TODO: 0,
  IN_PROGRESS: 0,
  IN_REVIEW: 0,
  DONE: 3,
}

beforeEach(() => {
  jest.clearAllMocks()
  milestones.findById.mockResolvedValue({
    id: 'm-1',
    archivedAt: null,
    completedAt: null,
  } as never)
  milestones.countTasksByStatus.mockResolvedValue(allDone as never)
  milestones.updateCompletionIfCurrent.mockResolvedValue(true as never)
  testCases.runsPerCaseForMilestone.mockResolvedValue(new Map() as never)
})

describe('LUM-1141: rollup over the test-case-only close gate', () => {
  it('an all-DONE milestone with zero test cases auto-completes', async () => {
    testCases.listForMilestone.mockResolvedValue([])

    await milestoneRollupService.reconcileMilestoneCompletion('m-1')

    expect(milestones.updateCompletionIfCurrent).toHaveBeenCalledWith(
      'm-1',
      null,
      expect.any(Date)
    )
  })

  it('an all-DONE milestone with a held (never run) test case stays open', async () => {
    testCases.listForMilestone.mockResolvedValue([
      { id: 'tc-1', number: 1, title: 'Checkout', requiredEnvironment: null },
    ] as never)

    await milestoneRollupService.reconcileMilestoneCompletion('m-1')

    expect(milestones.updateCompletionIfCurrent).not.toHaveBeenCalled()
  })
})
