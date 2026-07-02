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
    getOutcomeForMilestone: jest.fn(),
    getCostTrendForMilestone: jest.fn(),
    getSegmentsForMilestone: jest.fn(),
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

import { GET } from '@/app/api/projects/[id]/milestones/by-slug/[slug]/route'
import { requireIdentity } from '@/lib/auth'
import { loadProjectAndMember } from '@/lib/api/helpers'
import { milestoneService } from '@/lib/services/milestone.service'
import { milestoneRollupService } from '@/lib/services/milestone-rollup.service'
import { milestoneRepository } from '@/lib/repositories/milestone.repository'
import { milestoneSummaryRepository } from '@/lib/repositories/milestone-summary.repository'

const mockIdentity = requireIdentity as jest.Mock
const mockLoad = loadProjectAndMember as jest.Mock
const mockBySlug = milestoneService.getMilestoneBySlug as jest.Mock
const mockCoverage = milestoneService.getSprintCoverageForTeam as jest.Mock
const mockOutcome = milestoneService.getOutcomeForMilestone as jest.Mock
const mockCostTrend = milestoneService.getCostTrendForMilestone as jest.Mock
const mockSegments = milestoneService.getSegmentsForMilestone as jest.Mock
const mockCount = milestoneRepository.countTasksByStatus as jest.Mock
const mockSummary = milestoneSummaryRepository.findByMilestoneId as jest.Mock
const mockObserve = milestoneRollupService.observeOnRead as jest.Mock

const emptyCostTrend = {
  costRollup: {
    tokenCost: null,
    activeTimeSec: 0,
    measuredTasks: 0,
    totalTasks: 0,
  },
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
  mockIdentity.mockReset()
  mockLoad.mockReset()
  mockBySlug.mockReset()
  mockCoverage.mockReset()
  mockOutcome.mockReset()
  mockCostTrend.mockReset()
  mockCount.mockReset()
  mockSummary.mockReset()
  mockObserve.mockReset()
  mockObserve.mockReturnValue({ statusDrift: null, datesMissing: false })
  mockOutcome.mockResolvedValue(null)
  mockCostTrend.mockResolvedValue(emptyCostTrend)
  mockSegments.mockReset()
  mockSegments.mockResolvedValue({
    tasks: [],
    sprint: [],
    priority: [],
    workstream: [],
  })
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
    // LUM-624 staleness hints ride along on the slug read path too.
    expect(body.milestone).toMatchObject({
      staleness: { statusDrift: null, datesMissing: false },
    })
    expect(mockObserve).toHaveBeenCalled()
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

  it('by-slug milestone payload carries costRollup burnup and outcome', async () => {
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
      status: 'ACTIVE',
      startDate: null,
      targetDate: null,
    })
    mockCount.mockResolvedValue({
      TODO: 0,
      IN_PROGRESS: 1,
      IN_REVIEW: 0,
      DONE: 1,
    })
    mockCoverage.mockResolvedValue({ sprints: [], unsprinted: 2 })
    mockSummary.mockResolvedValue(null)
    // LUM-626's outcome shipped on by-id only — the canonical slug path must
    // carry it too, alongside the LUM-627 cost+trend enrich.
    const outcome = {
      claims: [
        {
          taskId: 't1',
          ref: 'LUM-1',
          title: 'T',
          claim: 'did X',
          source: 'AGENT',
        },
      ],
      fate: { doneCount: 1, rejected: [], inconclusiveCount: 1 },
    }
    const costTrend = {
      costRollup: {
        tokenCost: 1234,
        activeTimeSec: 90,
        measuredTasks: 1,
        totalTasks: 2,
      },
      burnup: {
        start: '2026-01-04',
        end: '2026-01-16',
        unit: 'tasks',
        scopeTotal: 2,
        series: [{ date: '2026-01-04', scope: 1, completed: 0 }],
        sprintWindows: [
          {
            sprintId: 's1',
            number: 1,
            name: 'Sprint 1',
            start: '2026-01-05',
            end: '2026-01-09',
          },
        ],
      },
    }
    mockOutcome.mockResolvedValue(outcome)
    mockCostTrend.mockResolvedValue(costTrend)

    const res = await GET(new Request('http://x/m') as never, params)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.milestone.outcome).toEqual(outcome)
    expect(body.milestone.costRollup).toEqual(costTrend.costRollup)
    expect(body.milestone.burnup).toEqual(costTrend.burnup)
    // Both enrich calls reuse the already-resolved team — no re-auth.
    expect(mockCostTrend).toHaveBeenCalledWith('m-1', 'team-1')
    expect(mockOutcome).toHaveBeenCalledWith('m-1')
  })

  it('returns segments rollup (LUM-628) on the canonical slug detail payload', async () => {
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
      status: 'ACTIVE',
      startDate: null,
      targetDate: null,
    })
    mockCount.mockResolvedValue({
      TODO: 0,
      IN_PROGRESS: 0,
      IN_REVIEW: 0,
      DONE: 1,
    })
    mockCoverage.mockResolvedValue({ sprints: [], unsprinted: 1 })
    mockSummary.mockResolvedValue(null)
    const segments = {
      tasks: [
        { taskId: 't1', ref: 'LUM-283', title: 'Bundle diet', status: 'DONE' },
      ],
      sprint: [{ key: 'NONE', label: null, taskIds: ['t1'], doneCount: 1 }],
      priority: [{ key: 'HIGH', label: null, taskIds: ['t1'], doneCount: 1 }],
      workstream: [
        { key: 'tag-a', label: 'perf', taskIds: ['t1'], doneCount: 1 },
      ],
    }
    mockSegments.mockResolvedValue(segments)

    const res = await GET(new Request('http://x/m') as never, params)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.milestone.segments).toEqual(segments)
    // Segments enrich reuses the already-resolved team — no re-auth.
    expect(mockSegments).toHaveBeenCalledWith('m-1', 'team-1')
  })
})
