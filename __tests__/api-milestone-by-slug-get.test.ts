/**
 * @jest-environment node
 */
jest.mock('@/lib/auth', () => ({
  requireIdentity: jest.fn(),
}))
jest.mock('@/lib/api/helpers', () => ({
  loadProjectAndMember: jest.fn(),
}))
jest.mock('@/lib/services/milestone.service', () => ({
  milestoneService: {
    getMilestoneBySlug: jest.fn(),
    getSprintCoverageForTeam: jest.fn(),
  },
}))
jest.mock('@/lib/repositories/milestone.repository', () => ({
  milestoneRepository: { countTasksByStatus: jest.fn() },
}))
jest.mock('@/lib/repositories/milestone-summary.repository', () => ({
  milestoneSummaryRepository: { findByMilestoneId: jest.fn() },
}))

import { GET } from '@/app/api/projects/[id]/milestones/by-slug/[slug]/route'
import { requireIdentity } from '@/lib/auth'
import { loadProjectAndMember } from '@/lib/api/helpers'
import { milestoneService } from '@/lib/services/milestone.service'
import { milestoneRepository } from '@/lib/repositories/milestone.repository'
import { milestoneSummaryRepository } from '@/lib/repositories/milestone-summary.repository'

const mockIdentity = requireIdentity as jest.Mock
const mockLoad = loadProjectAndMember as jest.Mock
const mockBySlug = milestoneService.getMilestoneBySlug as jest.Mock
const mockCoverage = milestoneService.getSprintCoverageForTeam as jest.Mock
const mockCount = milestoneRepository.countTasksByStatus as jest.Mock
const mockSummary = milestoneSummaryRepository.findByMilestoneId as jest.Mock

beforeEach(() => {
  mockIdentity.mockReset()
  mockLoad.mockReset()
  mockBySlug.mockReset()
  mockCoverage.mockReset()
  mockCount.mockReset()
  mockSummary.mockReset()
})

const params = { params: Promise.resolve({ id: 'p-1', slug: 'q3' }) }

describe('GET /api/projects/[id]/milestones/by-slug/[slug]', () => {
  it('enriches the milestone like the by-id detail route', async () => {
    mockIdentity.mockResolvedValue({ clerkId: 'clerk-1', memberId: 'mem-1' })
    mockLoad.mockResolvedValue({
      project: { id: 'p-1', teamId: 'team-1' },
      member: { id: 'mem-1' },
      workspaceSlug: 'w',
    })
    // No target date → the health light computes to null (real computation,
    // kept deterministic on purpose).
    mockBySlug.mockResolvedValue({
      id: 'm-1',
      projectId: 'p-1',
      name: 'Q3',
      slug: 'q3',
      status: 'ACTIVE',
      startDate: null,
      targetDate: null,
    })
    mockCount.mockResolvedValue({
      TODO: 1,
      IN_PROGRESS: 2,
      IN_REVIEW: 0,
      DONE: 3,
    })
    mockCoverage.mockResolvedValue({ sprints: [], unsprinted: 6 })
    mockSummary.mockResolvedValue({
      milestoneId: 'm-1',
      tldr: 'Cut first-load JS by 298KB',
    })

    const res = await GET(new Request('http://x/m') as never, params)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.milestone).toMatchObject({
      id: 'm-1',
      taskCounts: { TODO: 1, IN_PROGRESS: 2, IN_REVIEW: 0, DONE: 3 },
      sprintCoverage: { sprints: [], unsprinted: 6 },
      summaryTldr: 'Cut first-load JS by 298KB',
    })
    expect(body.milestone).toHaveProperty('health', null)
    // Coverage reuses the project's team — no re-resolution.
    expect(mockCoverage).toHaveBeenCalledWith('m-1', 'team-1')
  })

  it('reports a null summaryTldr when no retro has been generated', async () => {
    mockIdentity.mockResolvedValue({ clerkId: 'clerk-1', memberId: 'mem-1' })
    mockLoad.mockResolvedValue({
      project: { id: 'p-1', teamId: 'team-1' },
      member: { id: 'mem-1' },
      workspaceSlug: 'w',
    })
    mockBySlug.mockResolvedValue({
      id: 'm-1',
      projectId: 'p-1',
      name: 'Q3',
      slug: 'q3',
      status: 'PLANNED',
      startDate: null,
      targetDate: null,
    })
    mockCount.mockResolvedValue({
      TODO: 0,
      IN_PROGRESS: 0,
      IN_REVIEW: 0,
      DONE: 0,
    })
    mockCoverage.mockResolvedValue({ sprints: [], unsprinted: 0 })
    mockSummary.mockResolvedValue(null)

    const res = await GET(new Request('http://x/m') as never, params)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.milestone).toHaveProperty('summaryTldr', null)
  })
})
