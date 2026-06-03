/**
 * @jest-environment node
 */
jest.mock('@/lib/auth', () => ({
  requireIdentity: jest.fn(),
}))
jest.mock('@/lib/services/milestone.service', () => ({
  milestoneService: { getMilestone: jest.fn(), getSprintCoverage: jest.fn() },
}))
jest.mock('@/lib/repositories/milestone.repository', () => ({
  milestoneRepository: { countTasksByStatus: jest.fn() },
}))

import { GET } from '@/app/api/milestones/[milestoneId]/route'
import { requireIdentity } from '@/lib/auth'
import { milestoneService } from '@/lib/services/milestone.service'
import { milestoneRepository } from '@/lib/repositories/milestone.repository'

const mockIdentity = requireIdentity as jest.Mock
const mockGet = milestoneService.getMilestone as jest.Mock
const mockCount = milestoneRepository.countTasksByStatus as jest.Mock
const mockCoverage = milestoneService.getSprintCoverage as jest.Mock

beforeEach(() => {
  mockIdentity.mockReset()
  mockGet.mockReset()
  mockCount.mockReset()
  mockCoverage.mockReset()
})

const params = { params: Promise.resolve({ milestoneId: 'm-1' }) }

describe('GET /api/milestones/[id]', () => {
  it('returns milestone enriched with taskCounts', async () => {
    mockIdentity.mockResolvedValue({ memberId: 'mem-1' })
    mockGet.mockResolvedValue({ id: 'm-1', name: 'Q3', status: 'ACTIVE' })
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
  })
})
