/**
 * @jest-environment node
 */
jest.mock('@/lib/auth', () => ({
  requireIdentity: jest.fn(),
}))
jest.mock('@/lib/services/milestone.service', () => ({
  milestoneService: {
    getMilestoneWithTeam: jest.fn(),
    getSprintCoverageForTeam: jest.fn(),
  },
}))
jest.mock('@/lib/repositories/milestone.repository', () => ({
  milestoneRepository: { countTasksByStatus: jest.fn() },
}))
jest.mock('@/lib/services/milestone-rollup.service', () => ({
  milestoneRollupService: { observeOnRead: jest.fn() },
}))

import { GET } from '@/app/api/milestones/[milestoneId]/route'
import { requireIdentity } from '@/lib/auth'
import { milestoneService } from '@/lib/services/milestone.service'
import { milestoneRollupService } from '@/lib/services/milestone-rollup.service'
import { milestoneRepository } from '@/lib/repositories/milestone.repository'

const mockIdentity = requireIdentity as jest.Mock
const mockGet = milestoneService.getMilestoneWithTeam as jest.Mock
const mockCount = milestoneRepository.countTasksByStatus as jest.Mock
const mockCoverage = milestoneService.getSprintCoverageForTeam as jest.Mock
const mockObserve = milestoneRollupService.observeOnRead as jest.Mock

beforeEach(() => {
  mockIdentity.mockReset()
  mockGet.mockReset()
  mockCount.mockReset()
  mockCoverage.mockReset()
  mockObserve.mockReset()
  mockObserve.mockReturnValue({ statusDrift: null, datesMissing: false })
})

const params = { params: Promise.resolve({ milestoneId: 'm-1' }) }

describe('GET /api/milestones/[id]', () => {
  it('returns milestone enriched with taskCounts', async () => {
    mockIdentity.mockResolvedValue({ memberId: 'mem-1' })
    mockGet.mockResolvedValue({
      milestone: { id: 'm-1', name: 'Q3', status: 'ACTIVE' },
      teamId: 'team-1',
    })
    mockCount.mockResolvedValue({
      TODO: 1,
      IN_PROGRESS: 2,
      IN_REVIEW: 0,
      DONE: 3,
    })
    mockCoverage.mockResolvedValue({
      sprints: [
        {
          sprintId: 's3',
          number: 3,
          name: 'Sprint 3',
          status: 'ACTIVE',
          taskCount: 6,
          doneCount: 4,
        },
      ],
      unsprinted: 1,
    })
    const res = await GET(new Request('http://x/m') as any, params)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.milestone).toMatchObject({
      id: 'm-1',
      taskCounts: { TODO: 1, IN_PROGRESS: 2, IN_REVIEW: 0, DONE: 3 },
      sprintCoverage: {
        sprints: [
          {
            sprintId: 's3',
            number: 3,
            name: 'Sprint 3',
            status: 'ACTIVE',
            taskCount: 6,
            doneCount: 4,
          },
        ],
        unsprinted: 1,
      },
    })
    // Authorizes once, then reuses the resolved team for coverage (no re-auth).
    expect(mockGet).toHaveBeenCalledWith('m-1', 'mem-1')
    expect(mockCoverage).toHaveBeenCalledWith('m-1', 'team-1')
  })

  it('enriches the payload with rollup staleness hints (LUM-624)', async () => {
    mockIdentity.mockResolvedValue({ memberId: 'mem-1' })
    mockGet.mockResolvedValue({
      milestone: { id: 'm-1', name: 'Q3', status: 'PLANNED' },
      teamId: 'team-1',
    })
    const taskCounts = { TODO: 0, IN_PROGRESS: 0, IN_REVIEW: 0, DONE: 26 }
    mockCount.mockResolvedValue(taskCounts)
    mockCoverage.mockResolvedValue({ sprints: [], unsprinted: 0 })
    mockObserve.mockReturnValue({
      statusDrift: 'COMPLETED',
      datesMissing: false,
    })

    const res = await GET(new Request('http://x/m') as any, params)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.milestone.staleness).toEqual({
      statusDrift: 'COMPLETED',
      datesMissing: false,
    })
    // The read hands the row + counts to the rollup observer, which owns
    // both the hint computation and the self-heal dispatch.
    expect(mockObserve).toHaveBeenCalledWith(
      { id: 'm-1', name: 'Q3', status: 'PLANNED' },
      taskCounts
    )
  })
})
