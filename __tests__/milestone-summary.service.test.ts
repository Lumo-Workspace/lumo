import { milestoneSummaryService } from '@/lib/services/milestone-summary.service'

const mockFindMilestone = jest.fn()
const mockComputeStatsData = jest.fn()
const mockSave = jest.fn()
const mockLLM = jest.fn()
const mockFindPendingMilestoneJob = jest.fn()
const mockMarkCompleted = jest.fn()
const mockMarkFailed = jest.fn()
const mockAggregateStruggle = jest.fn()

jest.mock('@/lib/repositories/milestone.repository', () => ({
  milestoneRepository: {
    findById: (...a: any[]) => mockFindMilestone(...a),
  },
}))

jest.mock('@/lib/repositories/milestone-summary.repository', () => ({
  milestoneSummaryRepository: {
    save: (...a: any[]) => mockSave(...a),
    computeStatsData: (...a: any[]) => mockComputeStatsData(...a),
  },
}))

jest.mock('@/lib/repositories/generation-job.repository', () => ({
  generationJobRepository: {
    findPendingMilestoneJob: (...a: any[]) => mockFindPendingMilestoneJob(...a),
    markCompleted: (...a: any[]) => mockMarkCompleted(...a),
    markFailed: (...a: any[]) => mockMarkFailed(...a),
  },
}))

jest.mock('@/lib/llm/milestone-summary-client', () => ({
  callMilestoneSummaryLLM: (...a: any[]) => mockLLM(...a),
}))

// LUM-647: the retro→memory distillation is a separate concern with its own
// suite; mock it here so `generate` doesn't pull @ai-sdk/gateway into this test.
const mockDistill = jest.fn()
jest.mock('@/lib/services/memory/milestone-distill.service', () => ({
  milestoneDistillService: {
    triggerForMilestoneClose: (...a: any[]) => mockDistill(...a),
  },
}))

jest.mock('@/lib/services/task-verification.service', () => ({
  taskVerificationService: {
    aggregateStruggleForTasks: (...a: any[]) => mockAggregateStruggle(...a),
  },
}))

const STRUGGLE = {
  tasksConsidered: 3,
  tasksWithStruggle: 1,
  reworkRounds: 2,
  failedVerdicts: 4,
  openSendBacks: 1,
  resolvedSendBacks: 0,
  reopens: 1,
  followUps: 0,
  extraPrCycles: 2,
  machineVerified: 3,
  humanOverridden: 1,
  machineTotal: 4,
  hardTasks: [],
}

beforeEach(() => {
  jest.clearAllMocks()
  mockFindPendingMilestoneJob.mockResolvedValue(null)
  mockAggregateStruggle.mockResolvedValue(STRUGGLE)
})

const COMPLETED_MILESTONE = {
  id: 'ms-1',
  projectId: 'proj-1',
  name: 'v1.0',
  completedAt: new Date('2026-04-20'),
  startDate: new Date('2026-04-06'),
  targetDate: new Date('2026-04-20'),
}

const STATS_DATA = {
  stats: {
    totalTasks: 3,
    done: 2,
    inProgress: 1,
    byPriority: { HIGH: 2, LOW: 1 },
    byAssignee: { a1: 2, unassigned: 1 },
  },
  tasks: [
    {
      id: 't1',
      status: 'DONE',
      priority: 'HIGH',
      assigneeActorId: 'a1',
      title: 'one',
    },
  ],
}

describe('milestoneSummaryService.generate', () => {
  it('happy path: completed milestone → computeStats → LLM → save', async () => {
    mockFindMilestone.mockResolvedValueOnce(COMPLETED_MILESTONE)
    mockComputeStatsData.mockResolvedValueOnce(STATS_DATA)
    mockLLM.mockResolvedValueOnce({ tldr: 'tldr', report: 'report' })
    mockSave.mockResolvedValueOnce({ id: 'summary-1' })

    const result = await milestoneSummaryService.generate('ms-1')

    expect(mockFindMilestone).toHaveBeenCalledWith('ms-1')
    expect(mockComputeStatsData).toHaveBeenCalledWith('ms-1')
    expect(mockAggregateStruggle).toHaveBeenCalledWith(
      STATS_DATA.tasks.map(t => t.id)
    )
    expect(mockLLM).toHaveBeenCalledWith({
      subject: 'v1.0',
      window: {
        start: COMPLETED_MILESTONE.startDate,
        target: COMPLETED_MILESTONE.targetDate,
      },
      stats: STATS_DATA.stats,
      tasks: STATS_DATA.tasks,
      struggle: STRUGGLE,
    })
    expect(mockSave).toHaveBeenCalledWith('ms-1', {
      stats: STATS_DATA.stats,
      tldr: 'tldr',
      report: 'report',
    })
    expect(result).toEqual({ id: 'summary-1' })
    expect(mockMarkCompleted).not.toHaveBeenCalled()
    expect(mockMarkFailed).not.toHaveBeenCalled()
  })

  it('marks pending GenerationJob as completed with summaryId on success', async () => {
    mockFindMilestone.mockResolvedValueOnce(COMPLETED_MILESTONE)
    mockFindPendingMilestoneJob.mockResolvedValueOnce({ id: 'job-1' })
    mockComputeStatsData.mockResolvedValueOnce(STATS_DATA)
    mockLLM.mockResolvedValueOnce({ tldr: 't', report: 'r' })
    mockSave.mockResolvedValueOnce({ id: 'summary-1' })
    mockMarkCompleted.mockResolvedValueOnce(undefined)

    await milestoneSummaryService.generate('ms-1')

    expect(mockMarkCompleted).toHaveBeenCalledWith('job-1', 'summary-1')
    expect(mockMarkFailed).not.toHaveBeenCalled()
  })

  it('throws 404 when milestone missing', async () => {
    mockFindMilestone.mockResolvedValueOnce(null)
    await expect(
      milestoneSummaryService.generate('missing')
    ).rejects.toMatchObject({ status: 404 })
    expect(mockComputeStatsData).not.toHaveBeenCalled()
  })

  it('throws 400 when the milestone has not completed', async () => {
    mockFindMilestone.mockResolvedValueOnce({
      ...COMPLETED_MILESTONE,
      completedAt: null,
    })
    await expect(
      milestoneSummaryService.generate('ms-1')
    ).rejects.toMatchObject({ status: 400 })
  })

  it('marks pending GenerationJob as failed when LLM throws', async () => {
    mockFindMilestone.mockResolvedValueOnce(COMPLETED_MILESTONE)
    mockFindPendingMilestoneJob.mockResolvedValueOnce({ id: 'job-1' })
    mockComputeStatsData.mockResolvedValueOnce(STATS_DATA)
    mockLLM.mockRejectedValueOnce(new Error('llm down'))

    await expect(milestoneSummaryService.generate('ms-1')).rejects.toThrow(
      'llm down'
    )
    expect(mockMarkFailed).toHaveBeenCalledWith('job-1')
    expect(mockMarkCompleted).not.toHaveBeenCalled()
  })

  it('does not call markFailed when there is no pending job', async () => {
    mockFindMilestone.mockResolvedValueOnce(COMPLETED_MILESTONE)
    mockFindPendingMilestoneJob.mockResolvedValueOnce(null)
    mockComputeStatsData.mockResolvedValueOnce(STATS_DATA)
    mockLLM.mockRejectedValueOnce(new Error('llm down'))

    await expect(milestoneSummaryService.generate('ms-1')).rejects.toThrow(
      'llm down'
    )
    expect(mockMarkFailed).not.toHaveBeenCalled()
  })
})
