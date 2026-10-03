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

import { GET } from '@/app/api/milestones/[milestoneId]/route'
import { requireIdentity } from '@/lib/auth'
import { milestoneService } from '@/lib/services/milestone.service'
import { milestoneRollupService } from '@/lib/services/milestone-rollup.service'
import { milestoneRepository } from '@/lib/repositories/milestone.repository'
import { milestoneSummaryRepository } from '@/lib/repositories/milestone-summary.repository'

const mockIdentity = requireIdentity as jest.Mock
const mockGet = milestoneService.getMilestoneWithTeam as jest.Mock
const mockCount = milestoneRepository.countTasksByStatus as jest.Mock
const mockCoverage = milestoneService.getSprintCoverageForTeam as jest.Mock
const mockOutcome = milestoneService.getOutcomeForMilestone as jest.Mock
const mockCostTrend = milestoneService.getCostTrendForMilestone as jest.Mock
const mockSegments = milestoneService.getSegmentsForMilestone as jest.Mock
const mockSummary = milestoneSummaryRepository.findByMilestoneId as jest.Mock
const mockObserve = milestoneRollupService.observeOnRead as jest.Mock
const mockDeliveryStats =
  milestoneService.getDeliveryStatsForMilestone as jest.Mock
const mockMemberDelivery =
  milestoneService.getMemberDeliveryForMilestone as jest.Mock
const mockRiskQueue = milestoneService.getRiskQueueForMilestone as jest.Mock
const mockTopology = milestoneService.getTopologyForMilestone as jest.Mock
const mockWeighted =
  milestoneService.getWeightedProgressForMilestone as jest.Mock

const emptyWeighted = {
  doneWeight: null,
  totalWeight: null,
  pct: null,
  measuredTasks: 0,
  totalTasks: 0,
}

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

const emptySegments = { tasks: [], sprint: [], priority: [], workstream: [] }

const emptyDeliveryStats = {
  pr: {
    mergedPrCount: 0,
    multiPrTaskCount: 0,
    linkedTaskCount: 0,
    unlinkedTaskCount: 0,
    totalTasks: 0,
  },
  changedFiles: { total: null, measuredTasks: 0, totalTasks: 0 },
  perMember: {
    measuredTasks: 0,
    tokenCost: null,
    activeTimeSec: 0,
    rows: [],
  },
}

beforeEach(() => {
  mockIdentity.mockReset()
  mockGet.mockReset()
  mockCount.mockReset()
  mockCoverage.mockReset()
  mockOutcome.mockReset()
  mockCostTrend.mockReset()
  mockCostTrend.mockResolvedValue(emptyCostTrend)
  mockSegments.mockReset()
  mockSegments.mockResolvedValue(emptySegments)
  mockSummary.mockReset()
  mockSummary.mockResolvedValue(null)
  mockObserve.mockReset()
  mockObserve.mockReturnValue({ statusDrift: null, datesMissing: false })
  mockDeliveryStats.mockReset()
  mockDeliveryStats.mockResolvedValue(emptyDeliveryStats)
  mockMemberDelivery.mockReset()
  mockMemberDelivery.mockResolvedValue({ rows: [] })
  mockRiskQueue.mockReset()
  mockRiskQueue.mockResolvedValue(null)
  mockTopology.mockReset()
  mockTopology.mockResolvedValue(null)
  mockWeighted.mockReset()
  mockWeighted.mockResolvedValue(emptyWeighted)
})

const params = { params: Promise.resolve({ milestoneId: 'm-1' }) }

describe('GET /api/milestones/[id]', () => {
  it('returns milestone enriched with taskCounts', async () => {
    mockIdentity.mockResolvedValue({ memberId: 'mem-1' })
    mockGet.mockResolvedValue({
      milestone: { id: 'm-1', name: 'Q3', status: 'ACTIVE', tokenBudget: null },
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
    mockOutcome.mockResolvedValue({
      claims: [],
      fate: { doneCount: 3, rejected: [], inconclusiveCount: 3 },
    })
    mockSummary.mockResolvedValue({ milestoneId: 'm-1', tldr: 'Shipped Q3' })
    const res = await GET(new Request('http://x/m') as any, params)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.milestone).toMatchObject({
      id: 'm-1',
      summaryTldr: 'Shipped Q3',
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
      outcome: {
        claims: [],
        fate: { doneCount: 3, rejected: [], inconclusiveCount: 3 },
      },
    })
    // Authorizes once, then reuses the resolved team for coverage (no re-auth).
    expect(mockGet).toHaveBeenCalledWith('m-1', 'mem-1')
    expect(mockCoverage).toHaveBeenCalledWith('m-1', 'team-1')
    expect(mockOutcome).toHaveBeenCalledWith('m-1')
    // LUM-627 cost+trend enrich rides the same read, same resolved team;
    // LUM-644 hands it the milestone row's advisory tokenBudget.
    expect(mockCostTrend).toHaveBeenCalledWith('m-1', 'team-1', null)
    expect(body.milestone.costRollup).toEqual(emptyCostTrend.costRollup)
    expect(body.milestone.burnup).toEqual(emptyCostTrend.burnup)
  })

  it('returns green quality rollup (LUM-639) inside the outcome block', async () => {
    mockIdentity.mockResolvedValue({ memberId: 'mem-1' })
    mockGet.mockResolvedValue({
      milestone: { id: 'm-1', name: 'Q3', status: 'ACTIVE' },
      teamId: 'team-1',
    })
    mockCount.mockResolvedValue({
      TODO: 0,
      IN_PROGRESS: 0,
      IN_REVIEW: 0,
      DONE: 3,
    })
    mockCoverage.mockResolvedValue({ sprints: [], unsprinted: 0 })
    const greenQuality = {
      doneCount: 3,
      faithfulness: {
        faithful: 2,
        overstated: 0,
        underReported: 0,
        unjudged: 1,
      },
    }
    mockOutcome.mockResolvedValue({
      claims: [],
      fate: { doneCount: 3, rejected: [], inconclusiveCount: 3 },
      greenQuality,
    })

    const res = await GET(new Request('http://x/m') as any, params)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.milestone.outcome.greenQuality).toEqual(greenQuality)
  })

  it('returns segments rollup (LUM-628) on the by-id detail payload', async () => {
    mockIdentity.mockResolvedValue({ memberId: 'mem-1' })
    mockGet.mockResolvedValue({
      milestone: { id: 'm-1', name: 'Q3', status: 'ACTIVE' },
      teamId: 'team-1',
    })
    mockCount.mockResolvedValue({
      TODO: 0,
      IN_PROGRESS: 0,
      IN_REVIEW: 0,
      DONE: 1,
    })
    mockCoverage.mockResolvedValue({ sprints: [], unsprinted: 1 })
    mockOutcome.mockResolvedValue(null)
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

    const res = await GET(new Request('http://x/m') as any, params)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.milestone.segments).toEqual(segments)
    expect(mockSegments).toHaveBeenCalledWith('m-1', 'team-1')
  })

  it('returns delivery stats rollup', async () => {
    mockIdentity.mockResolvedValue({ memberId: 'mem-1' })
    mockGet.mockResolvedValue({
      milestone: { id: 'm-1', name: 'Q3', status: 'ACTIVE' },
      teamId: 'team-1',
    })
    mockCount.mockResolvedValue({
      TODO: 0,
      IN_PROGRESS: 0,
      IN_REVIEW: 0,
      DONE: 3,
    })
    mockCoverage.mockResolvedValue({ sprints: [], unsprinted: 3 })
    mockOutcome.mockResolvedValue(null)
    const deliveryStats = {
      pr: {
        mergedPrCount: 4,
        multiPrTaskCount: 1,
        linkedTaskCount: 2,
        unlinkedTaskCount: 1,
        totalTasks: 3,
      },
      changedFiles: { total: 42, measuredTasks: 2, totalTasks: 3 },
      perMember: {
        measuredTasks: 2,
        tokenCost: 1000,
        activeTimeSec: 90,
        rows: [
          { memberId: 'mA', label: 'Alice', tokenCost: 800, activeTimeSec: 60 },
          { memberId: null, label: null, tokenCost: 200, activeTimeSec: 30 },
        ],
      },
    }
    mockDeliveryStats.mockResolvedValue(deliveryStats)

    const res = await GET(new Request('http://x/m') as any, params)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.milestone.deliveryStats).toEqual(deliveryStats)
    expect(mockDeliveryStats).toHaveBeenCalledWith('m-1')
  })

  it('returns member delivery rollup', async () => {
    mockIdentity.mockResolvedValue({ memberId: 'mem-1' })
    mockGet.mockResolvedValue({
      milestone: { id: 'm-1', name: 'Q3', status: 'ACTIVE' },
      teamId: 'team-1',
    })
    mockCount.mockResolvedValue({
      TODO: 0,
      IN_PROGRESS: 0,
      IN_REVIEW: 0,
      DONE: 2,
    })
    mockCoverage.mockResolvedValue({ sprints: [], unsprinted: 2 })
    mockOutcome.mockResolvedValue(null)
    const memberDelivery = {
      rows: [
        {
          bucket: 'member',
          memberId: 'mA',
          label: 'Alice',
          taskCount: 2,
          doneCount: 2,
          mergedPrCount: 3,
          fate: { rejectedTaskCount: 1, noRecordDoneCount: 1 },
          friction: { multiPrTaskCount: 1 },
          changedFiles: { total: 9, measuredTasks: 1 },
          claims: [
            {
              taskId: 't1',
              ref: 'LUM-1',
              title: 'T1',
              claim: 'shipped X',
              source: 'AGENT',
            },
          ],
        },
        {
          bucket: 'unassigned',
          memberId: null,
          label: null,
          taskCount: 1,
          doneCount: 0,
          mergedPrCount: 0,
          fate: { rejectedTaskCount: 0, noRecordDoneCount: 0 },
          friction: { multiPrTaskCount: 0 },
          changedFiles: { total: null, measuredTasks: 0 },
          claims: [],
        },
      ],
    }
    mockMemberDelivery.mockResolvedValue(memberDelivery)

    const res = await GET(new Request('http://x/m') as any, params)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.milestone.memberDelivery).toEqual(memberDelivery)
    expect(mockMemberDelivery).toHaveBeenCalledWith('m-1')
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

  test('returns risk queue rollup', async () => {
    mockIdentity.mockResolvedValue({ memberId: 'mem-1' })
    mockGet.mockResolvedValue({
      milestone: { id: 'm-1', name: 'Q3', status: 'ACTIVE' },
      teamId: 'team-1',
    })
    mockCount.mockResolvedValue({
      TODO: 0,
      IN_PROGRESS: 0,
      IN_REVIEW: 0,
      DONE: 0,
    })
    mockCoverage.mockResolvedValue({ sprints: [], unsprinted: 0 })
    const riskQueue = {
      blocked: [
        {
          taskId: 't2',
          ref: 'LUM-2',
          title: 'B',
          blockingRef: 'LUM-9',
          blockingStatus: 'IN_PROGRESS',
        },
      ],
      awaitingVerdict: [
        { taskId: 't1', ref: 'LUM-1', title: 'A', agingSec: 7200 },
      ],
      crossings: {
        known: true,
        bySeverity: { high: 1, medium: 0, low: 0 },
        tasks: [
          {
            taskId: 't3',
            ref: 'LUM-3',
            title: 'C',
            high: 1,
            medium: 0,
            low: 0,
          },
        ],
      },
      scopeBaseline: { initial: 12, current: 15, addedLater: 3 },
    }
    ;(milestoneService.getRiskQueueForMilestone as jest.Mock).mockResolvedValue(
      riskQueue
    )
    const res = await GET(new Request('http://x/m') as any, params)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.milestone.riskQueue).toEqual(riskQueue)
  })

  it('serves the weightedProgress reading on the milestone detail payload', async () => {
    mockIdentity.mockResolvedValue({ memberId: 'mem-1' })
    mockGet.mockResolvedValue({
      milestone: { id: 'm-1', name: 'Q3', status: 'ACTIVE' },
      teamId: 'team-1',
    })
    mockCount.mockResolvedValue({
      TODO: 1,
      IN_PROGRESS: 0,
      IN_REVIEW: 0,
      DONE: 2,
    })
    mockCoverage.mockResolvedValue({ sprints: [], unsprinted: 3 })
    mockOutcome.mockResolvedValue(null)
    const weightedProgress = {
      doneWeight: 12,
      totalWeight: 20,
      pct: 60,
      measuredTasks: 2,
      totalTasks: 3,
    }
    mockWeighted.mockResolvedValue(weightedProgress)

    const res = await GET(new Request('http://x/m') as any, params)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.milestone.weightedProgress).toEqual(weightedProgress)
    expect(mockWeighted).toHaveBeenCalledWith('m-1')
  })

  it('returns topology on the payload (LUM-645)', async () => {
    mockIdentity.mockResolvedValue({ memberId: 'mem-1' })
    mockGet.mockResolvedValue({
      milestone: { id: 'm-1', name: 'Q3', status: 'ACTIVE' },
      teamId: 'team-1',
    })
    mockCount.mockResolvedValue({
      TODO: 0,
      IN_PROGRESS: 0,
      IN_REVIEW: 0,
      DONE: 0,
    })
    mockCoverage.mockResolvedValue({ sprints: [], unsprinted: 0 })
    const topology = {
      edgeCount: 2,
      levels: [['LUM-1'], ['LUM-2'], ['LUM-3']],
      criticalPath: [
        { taskId: 't1', ref: 'LUM-1', title: 'A', status: 'DONE' },
        { taskId: 't2', ref: 'LUM-2', title: 'B', status: 'TODO' },
        { taskId: 't3', ref: 'LUM-3', title: 'C', status: 'TODO' },
      ],
      cycleRefs: [],
      nextBatch: [
        {
          taskId: 't2',
          ref: 'LUM-2',
          title: 'B',
          status: 'TODO',
          unblocksCount: 1,
          onCriticalPath: true,
        },
      ],
      blockedOpenCount: 1,
    }
    mockTopology.mockResolvedValue(topology)
    const res = await GET(new Request('http://x/m') as any, params)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.milestone.topology).toEqual(topology)
    expect(mockTopology).toHaveBeenCalledWith('m-1')
  })
})
