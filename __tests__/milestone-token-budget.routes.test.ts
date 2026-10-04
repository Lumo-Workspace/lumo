/**
 * @jest-environment node
 *
 * LUM-644: the advisory budget block must ride BOTH milestone detail read
 * paths — by-id and by-slug (the canonical URL resolves via by-slug; LUM-624
 * shipped an enrich on one path only and the other went stale). One file
 * asserts the two payloads stay in lockstep.
 */
jest.mock('@/lib/auth', () => ({
  requireIdentity: jest.fn(),
}))
jest.mock('@/lib/api/helpers', () => ({
  loadProjectForIdentity: jest.fn(),
}))
jest.mock('@/lib/services/milestone.service', () => ({
  milestoneService: {
    getMilestoneWithTeam: jest.fn(),
    getMilestoneBySlug: jest.fn(),
    getSprintCoverageForTeam: jest.fn(),
    getOutcomeForMilestone: jest.fn(),
    getCostTrendForMilestone: jest.fn(),
    getSegmentsForMilestone: jest.fn(),
    getDeliveryStatsForMilestone: jest.fn(),
    getMemberDeliveryForMilestone: jest.fn(),
    getRiskQueueForMilestone: jest.fn(),
    getTopologyForMilestone: jest.fn(),
    getWeightedProgressForMilestone: jest.fn(),
  },
}))
jest.mock('@/lib/repositories/milestone.repository', () => ({
  milestoneRepository: { countTasksByStatus: jest.fn() },
}))
jest.mock('@/lib/repositories/milestone-summary.repository', () => ({
  milestoneSummaryRepository: { findByMilestoneId: jest.fn() },
}))
jest.mock('@/lib/services/milestone-rollup.service', () => ({
  milestoneRollupService: { observeOnRead: jest.fn() },
}))

import { GET as getById } from '@/app/api/milestones/[milestoneId]/route'
import { GET as getBySlug } from '@/app/api/projects/[id]/milestones/by-slug/[slug]/route'
import { requireIdentity } from '@/lib/auth'
import { loadProjectForIdentity } from '@/lib/api/helpers'
import { milestoneService } from '@/lib/services/milestone.service'
import { milestoneRollupService } from '@/lib/services/milestone-rollup.service'
import { milestoneRepository } from '@/lib/repositories/milestone.repository'
import { milestoneSummaryRepository } from '@/lib/repositories/milestone-summary.repository'

const mockIdentity = requireIdentity as jest.Mock
const mockLoad = loadProjectForIdentity as jest.Mock
const mockGetWithTeam = milestoneService.getMilestoneWithTeam as jest.Mock
const mockBySlug = milestoneService.getMilestoneBySlug as jest.Mock
const mockCostTrend = milestoneService.getCostTrendForMilestone as jest.Mock

const milestoneRow = {
  id: 'm-1',
  projectId: 'p-1',
  name: 'Q3',
  slug: 'q3',
  status: 'ACTIVE',
  startDate: null,
  targetDate: null,
  tokenBudget: 1000,
}

const budget = {
  tokenBudget: 1000,
  tokenCost: 1500,
  usedRatio: 1.5,
  exceeded: true,
  overBy: 500,
}

const costTrend = {
  derivedStartDate: null,
  costRollup: {
    tokenCost: 1500,
    activeTimeSec: 0,
    measuredTasks: 1,
    totalTasks: 1,
  },
  budget,
  burnup: {
    start: '2026-01-01',
    end: '2026-01-01',
    unit: 'tasks',
    scopeTotal: 0,
    series: [],
    sprintWindows: [],
  },
}

beforeEach(() => {
  jest.clearAllMocks()
  mockIdentity.mockResolvedValue({ clerkId: 'clerk-1', memberId: 'mem-1' })
  mockLoad.mockResolvedValue({
    project: { id: 'p-1', teamId: 'team-1' },
    member: { id: 'mem-1' },
    workspaceSlug: 'w',
  })
  mockGetWithTeam.mockResolvedValue({
    milestone: milestoneRow,
    teamId: 'team-1',
  })
  mockBySlug.mockResolvedValue(milestoneRow)
  ;(milestoneRepository.countTasksByStatus as jest.Mock).mockResolvedValue({
    TODO: 0,
    IN_PROGRESS: 1,
    IN_REVIEW: 0,
    DONE: 0,
  })
  ;(milestoneService.getSprintCoverageForTeam as jest.Mock).mockResolvedValue({
    sprints: [],
    unsprinted: 1,
  })
  ;(milestoneService.getOutcomeForMilestone as jest.Mock).mockResolvedValue(
    null
  )
  ;(
    milestoneSummaryRepository.findByMilestoneId as jest.Mock
  ).mockResolvedValue(null)
  ;(milestoneRollupService.observeOnRead as jest.Mock).mockReturnValue({
    statusDrift: null,
    datesMissing: false,
  })
  mockCostTrend.mockResolvedValue(costTrend)
  ;(milestoneService.getSegmentsForMilestone as jest.Mock).mockResolvedValue({
    tasks: [],
    sprint: [],
    priority: [],
    workstream: [],
  })
  ;(
    milestoneService.getDeliveryStatsForMilestone as jest.Mock
  ).mockResolvedValue(null)
  ;(
    milestoneService.getMemberDeliveryForMilestone as jest.Mock
  ).mockResolvedValue({ rows: [] })
  ;(milestoneService.getRiskQueueForMilestone as jest.Mock).mockResolvedValue(
    null
  )
  ;(milestoneService.getTopologyForMilestone as jest.Mock).mockResolvedValue(
    null
  )
})

describe('token budget block on both detail reads', () => {
  it('by-id GET returns tokenBudget and the budget block, sourced from the row', async () => {
    const res = await getById(new Request('http://x/m') as never, {
      params: Promise.resolve({ milestoneId: 'm-1' }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.milestone.tokenBudget).toBe(1000)
    expect(body.milestone.budget).toEqual(budget)
    // The row's advisory budget is handed to the cost service — the single
    // place burn-vs-budget is computed.
    expect(mockCostTrend).toHaveBeenCalledWith('m-1', 'team-1', 1000)
  })

  it('by-slug GET (the canonical path) returns the identical budget block', async () => {
    const res = await getBySlug(new Request('http://x/m') as never, {
      params: Promise.resolve({ id: 'p-1', slug: 'q3' }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.milestone.tokenBudget).toBe(1000)
    expect(body.milestone.budget).toEqual(budget)
    expect(mockCostTrend).toHaveBeenCalledWith('m-1', 'team-1', 1000)
  })
})
