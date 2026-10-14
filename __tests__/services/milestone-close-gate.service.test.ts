jest.mock('@/lib/repositories/test-case.repository', () => ({
  testCaseRepository: {
    listForMilestone: jest.fn(),
    runsPerCaseForMilestone: jest.fn(),
  },
}))
jest.mock('@/lib/repositories/milestone-exit-criterion.repository', () => ({
  milestoneExitCriterionRepository: { countUnresolved: jest.fn() },
}))

import { milestoneCloseGateService } from '@/lib/services/milestone-close-gate.service'
import { testCaseRepository } from '@/lib/repositories/test-case.repository'
import { milestoneExitCriterionRepository } from '@/lib/repositories/milestone-exit-criterion.repository'

const repo = testCaseRepository as jest.Mocked<typeof testCaseRepository>
const criteria = milestoneExitCriterionRepository as jest.Mocked<
  typeof milestoneExitCriterionRepository
>

const tc = (id: string, number: number) =>
  ({ id, number, title: `case ${number}`, requiredEnvironment: null }) as never

describe('milestoneCloseGateService.read', () => {
  it('sums unresolved criteria and held cases (dual read)', async () => {
    criteria.countUnresolved.mockResolvedValue(1)
    repo.listForMilestone.mockResolvedValue([tc('a', 1), tc('b', 2)])
    repo.runsPerCaseForMilestone.mockResolvedValue(
      new Map([
        [
          'b',
          [
            {
              result: 'PASS',
              environment: 'PRODUCTION',
              evidence: [{}],
              unprovenVerification: [],
              failureAttribution: null,
              disposition: null,
            },
          ],
        ],
      ]) as never
    )
    const gate = await milestoneCloseGateService.read('m-1')
    expect(gate.unresolvedCriteria).toBe(1)
    expect(gate.cases.map(c => c.state)).toEqual(['held', 'open'])
    expect(gate.held).toBe(2)
  })

  it('dual read: criteria alone still hold', async () => {
    criteria.countUnresolved.mockResolvedValue(2)
    repo.listForMilestone.mockResolvedValue([])
    repo.runsPerCaseForMilestone.mockResolvedValue(new Map())
    expect(await milestoneCloseGateService.countHeld('m-1')).toBe(2)
  })

  it('reads the KNOWN_DEFECT disposition off the latest run', async () => {
    criteria.countUnresolved.mockResolvedValue(0)
    repo.listForMilestone.mockResolvedValue([tc('a', 1)])
    repo.runsPerCaseForMilestone.mockResolvedValue(
      new Map([
        [
          'a',
          [
            {
              result: 'FAIL',
              environment: 'LOCAL',
              evidence: [{}],
              unprovenVerification: [],
              failureAttribution: 'IMPLEMENTATION_DEFECT',
              disposition: { disposition: 'KNOWN_DEFECT' },
            },
          ],
        ],
      ]) as never
    )
    expect(await milestoneCloseGateService.countHeld('m-1')).toBe(0)
  })
})
