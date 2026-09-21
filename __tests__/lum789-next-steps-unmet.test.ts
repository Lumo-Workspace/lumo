/**
 * Finding 6 (whole-branch review): `nextStepsService.forExistingTask` used to
 * derive `hasUnmetCriteria` from a run-count heuristic
 * (`runs.some(FAIL) || runs.length < criteriaCount`) — any criterion with no
 * recorded run counted as unmet, HUMAN included. That made a reopened
 * IN_REVIEW task's injected next-step claim "left criteria unmet" for a
 * contract `lumo task status` reports as 0 unmet in the same breath (a tacit
 * pass), sending the agent on a token-priced dead-end loop.
 *
 * This drives the real `nextStepsService.forExistingTask` against mocked
 * repositories and asserts on the `hasUnmetCriteria` value it hands to the
 * (also mocked) pure rule table — falsifying both directions: a tacit-pass
 * HUMAN row must not count, and a genuinely unverified MACHINE row still must.
 */

const computeNextStepsMock = jest.fn((_input: unknown) => [] as unknown[])
// LUM-807: the next-step rules ask whether the task has a script and a PR.
jest.mock('@/lib/repositories/pull-request.repository', () => ({
  pullRequestRepository: { listIdAndNumberByTask: jest.fn(async () => []) },
}))
jest.mock('@/lib/repositories/test-case.repository', () => ({
  testCaseRepository: { hasForTask: jest.fn(async () => false) },
}))
jest.mock('@/lib/context/render/next-steps', () => ({
  computeNextSteps: (input: unknown) => computeNextStepsMock(input),
}))

jest.mock('@/lib/repositories/acceptance-criterion.repository', () => ({
  acceptanceCriterionRepository: {
    listByTask: jest.fn(),
  },
}))
jest.mock('@/lib/repositories/boundary-crossing.repository', () => ({
  boundaryCrossingRepository: {
    hasOpenForTask: jest.fn(async () => false),
  },
}))
jest.mock('@/lib/repositories/verification-run.repository', () => ({
  verificationRunRepository: {
    latestRunsByCriterion: jest.fn(),
  },
}))

import { nextStepsService } from '@/lib/services/next-steps.service'
import { acceptanceCriterionRepository } from '@/lib/repositories/acceptance-criterion.repository'
import { verificationRunRepository } from '@/lib/repositories/verification-run.repository'

const listByTaskMock = acceptanceCriterionRepository.listByTask as jest.Mock
const latestRunsMock =
  verificationRunRepository.latestRunsByCriterion as jest.Mock

beforeEach(() => {
  jest.clearAllMocks()
  latestRunsMock.mockResolvedValue(new Map())
})

function baseArgs() {
  return {
    taskId: 't-1',
    taskIdentifier: 'LUM-1',
    status: 'IN_REVIEW' as const,
    sessionBound: true,
    criteriaNudgeAlreadyShown: false,
  }
}

describe('Finding 6: nextStepsService.forExistingTask hasUnmetCriteria', () => {
  it('a tacit-pass HUMAN criterion (no run recorded) does not count as unmet', async () => {
    listByTaskMock.mockResolvedValue([{ id: 'h1', verifierType: 'HUMAN' }])
    await nextStepsService.forExistingTask(baseArgs())
    expect(computeNextStepsMock).toHaveBeenCalledWith(
      expect.objectContaining({ hasUnmetCriteria: false })
    )
  })

  it('falsifies the other direction: an unrun MACHINE criterion still counts as unmet', async () => {
    listByTaskMock.mockResolvedValue([{ id: 'm1', verifierType: 'MACHINE' }])
    await nextStepsService.forExistingTask(baseArgs())
    expect(computeNextStepsMock).toHaveBeenCalledWith(
      expect.objectContaining({ hasUnmetCriteria: true })
    )
  })

  it('an explicit FAIL still counts as unmet regardless of verifierType', async () => {
    listByTaskMock.mockResolvedValue([{ id: 'h1', verifierType: 'HUMAN' }])
    latestRunsMock.mockResolvedValue(
      new Map([['h1', { criterionId: 'h1', round: 0, verdict: 'FAIL' }]])
    )
    await nextStepsService.forExistingTask(baseArgs())
    expect(computeNextStepsMock).toHaveBeenCalledWith(
      expect.objectContaining({ hasUnmetCriteria: true })
    )
  })

  it('an explicit PASS on a MACHINE criterion is met, not unmet', async () => {
    listByTaskMock.mockResolvedValue([{ id: 'm1', verifierType: 'MACHINE' }])
    latestRunsMock.mockResolvedValue(
      new Map([['m1', { criterionId: 'm1', round: 0, verdict: 'PASS' }]])
    )
    await nextStepsService.forExistingTask(baseArgs())
    expect(computeNextStepsMock).toHaveBeenCalledWith(
      expect.objectContaining({ hasUnmetCriteria: false })
    )
  })

  it('a mix of a tacit-pass HUMAN row and a verified MACHINE row is fully met', async () => {
    listByTaskMock.mockResolvedValue([
      { id: 'h1', verifierType: 'HUMAN' },
      { id: 'm1', verifierType: 'MACHINE' },
    ])
    latestRunsMock.mockResolvedValue(
      new Map([['m1', { criterionId: 'm1', round: 0, verdict: 'PASS' }]])
    )
    await nextStepsService.forExistingTask(baseArgs())
    expect(computeNextStepsMock).toHaveBeenCalledWith(
      expect.objectContaining({ hasUnmetCriteria: false })
    )
  })
})
