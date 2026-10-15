jest.mock('@/lib/repositories/test-case.repository', () => ({
  testCaseRepository: {
    listForMilestone: jest.fn(),
    runsPerCaseForMilestone: jest.fn(),
  },
}))

import { milestoneCloseGateService } from '@/lib/services/milestone-close-gate.service'
import { testCaseRepository } from '@/lib/repositories/test-case.repository'

const repo = testCaseRepository as jest.Mocked<typeof testCaseRepository>

const tc = (id: string, number: number) =>
  ({ id, number, title: `case ${number}`, requiredEnvironment: null }) as never

describe('milestoneCloseGateService.read', () => {
  it('counts held test cases only (LUM-1141: exit criteria dropped)', async () => {
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
    expect(gate).not.toHaveProperty('unresolvedCriteria')
    expect(gate.cases.map(c => c.state)).toEqual(['held', 'open'])
    expect(gate.held).toBe(1)
  })

  it('no test cases: the gate is open', async () => {
    repo.listForMilestone.mockResolvedValue([])
    repo.runsPerCaseForMilestone.mockResolvedValue(new Map())
    expect(await milestoneCloseGateService.countHeld('m-1')).toBe(0)
  })

  it('reads the KNOWN_DEFECT disposition off the latest run', async () => {
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
