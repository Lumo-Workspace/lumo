/**
 * @jest-environment node
 */
jest.mock('@/lib/auth', () => ({
  requireIdentity: jest.fn(),
}))
jest.mock('@/lib/api/helpers', () => ({
  loadProjectForIdentity: jest.fn(),
}))
jest.mock('@/lib/services/milestone.service', () => ({
  milestoneService: {
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

import { GET } from '@/app/api/projects/[id]/milestones/by-slug/[slug]/route'
import { requireIdentity } from '@/lib/auth'
import { loadProjectForIdentity } from '@/lib/api/helpers'
import { milestoneService } from '@/lib/services/milestone.service'
import { milestoneRollupService } from '@/lib/services/milestone-rollup.service'
import { milestoneRepository } from '@/lib/repositories/milestone.repository'
import { milestoneSummaryRepository } from '@/lib/repositories/milestone-summary.repository'

const mockIdentity = requireIdentity as jest.Mock
const mockLoad = loadProjectForIdentity as jest.Mock
const mockBySlug = milestoneService.getMilestoneBySlug as jest.Mock
const mockCoverage = milestoneService.getSprintCoverageForTeam as jest.Mock
const mockOutcome = milestoneService.getOutcomeForMilestone as jest.Mock
const mockCostTrend = milestoneService.getCostTrendForMilestone as jest.Mock
const mockSegments = milestoneService.getSegmentsForMilestone as jest.Mock
const mockCount = milestoneRepository.countTasksByStatus as jest.Mock
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
  mockDeliveryStats.mockReset()
  mockDeliveryStats.mockResolvedValue({
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
  })
  mockMemberDelivery.mockReset()
  mockMemberDelivery.mockResolvedValue({ rows: [] })
  mockRiskQueue.mockReset()
  mockRiskQueue.mockResolvedValue(null)
  mockTopology.mockReset()
  mockTopology.mockResolvedValue(null)
  mockWeighted.mockReset()
  mockWeighted.mockResolvedValue(emptyWeighted)
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

  it('returns delivery stats rollup', async () => {
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
      DONE: 3,
    })
    mockCoverage.mockResolvedValue({ sprints: [], unsprinted: 3 })
    mockSummary.mockResolvedValue(null)
    // Same structure the by-id route returns — the canonical slug path must
    // not lag the by-id enrich (the recurring two-read-paths trap).
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

    const res = await GET(new Request('http://x/m') as never, params)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.milestone.deliveryStats).toEqual(deliveryStats)
    expect(mockDeliveryStats).toHaveBeenCalledWith('m-1')
  })

  it('returns member delivery rollup', async () => {
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
      DONE: 2,
    })
    mockCoverage.mockResolvedValue({ sprints: [], unsprinted: 2 })
    mockSummary.mockResolvedValue(null)
    // Same structure the by-id route returns — the canonical slug path must
    // not lag the by-id enrich (the recurring two-read-paths trap).
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
          bucket: 'unattributed',
          memberId: null,
          label: null,
          taskCount: 1,
          doneCount: 1,
          mergedPrCount: 0,
          fate: { rejectedTaskCount: 0, noRecordDoneCount: 1 },
          friction: { multiPrTaskCount: 0 },
          changedFiles: { total: null, measuredTasks: 0 },
          claims: [
            {
              taskId: 't2',
              ref: 'LUM-2',
              title: 'T2',
              claim: null,
              source: null,
            },
          ],
        },
      ],
    }
    mockMemberDelivery.mockResolvedValue(memberDelivery)

    const res = await GET(new Request('http://x/m') as never, params)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.milestone.memberDelivery).toEqual(memberDelivery)
    expect(mockMemberDelivery).toHaveBeenCalledWith('m-1')
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
      tokenBudget: null,
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
    // Both enrich calls reuse the already-resolved team — no re-auth;
    // LUM-644 hands it the milestone row's advisory tokenBudget.
    expect(mockCostTrend).toHaveBeenCalledWith('m-1', 'team-1', null)
    expect(mockOutcome).toHaveBeenCalledWith('m-1')
  })

  it('returns green quality rollup (LUM-639) on the canonical slug detail payload', async () => {
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
      DONE: 3,
    })
    mockCoverage.mockResolvedValue({ sprints: [], unsprinted: 0 })
    mockSummary.mockResolvedValue(null)
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

    const res = await GET(new Request('http://x/m') as never, params)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.milestone.outcome.greenQuality).toEqual(greenQuality)
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

  test('returns risk queue rollup', async () => {
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
      DONE: 0,
    })
    mockCoverage.mockResolvedValue({ sprints: [], unsprinted: 0 })
    mockSummary.mockResolvedValue(null)
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
    const res = await GET(new Request('http://x/m') as never, params)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.milestone.riskQueue).toEqual(riskQueue)
  })

  it('serves the weightedProgress reading on the milestone detail payload', async () => {
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
      TODO: 1,
      IN_PROGRESS: 0,
      IN_REVIEW: 0,
      DONE: 2,
    })
    mockCoverage.mockResolvedValue({ sprints: [], unsprinted: 3 })
    mockSummary.mockResolvedValue(null)
    // The canonical slug path must not lag the by-id enrich (the recurring
    // two-read-paths trap — LUM-624).
    const weightedProgress = {
      doneWeight: 12,
      totalWeight: 20,
      pct: 60,
      measuredTasks: 2,
      totalTasks: 3,
    }
    mockWeighted.mockResolvedValue(weightedProgress)

    const res = await GET(new Request('http://x/m') as never, params)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.milestone.weightedProgress).toEqual(weightedProgress)
    expect(mockWeighted).toHaveBeenCalledWith('m-1')
  })

  test('returns topology rollup like the by-id detail route (LUM-645)', async () => {
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
      DONE: 0,
    })
    mockCoverage.mockResolvedValue({ sprints: [], unsprinted: 0 })
    mockSummary.mockResolvedValue(null)
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
    const res = await GET(new Request('http://x/m') as never, params)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.milestone.topology).toEqual(topology)
    expect(mockTopology).toHaveBeenCalledWith('m-1')
  })
})
