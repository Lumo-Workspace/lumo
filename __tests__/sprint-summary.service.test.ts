import { sprintSummaryService } from '@/lib/services/sprint-summary.service'

const mockFindSprint = jest.fn()
const mockComputeStatsData = jest.fn()
const mockSave = jest.fn()
const mockLLM = jest.fn()
const mockFindPendingSprintJob = jest.fn()
const mockMarkCompleted = jest.fn()
const mockMarkFailed = jest.fn()
const mockAggregateStruggle = jest.fn()

const mockCollectDoneGateBlockers = jest.fn()
jest.mock('@/lib/plugins/done-gate', () => ({
  collectDoneGateBlockers: (...a: any[]) => mockCollectDoneGateBlockers(...a),
}))

jest.mock('@/lib/repositories/sprint.repository', () => ({
  sprintRepository: {
    findById: (...a: any[]) => mockFindSprint(...a),
  },
}))

jest.mock('@/lib/repositories/sprint-summary.repository', () => ({
  sprintSummaryRepository: {
    save: (...a: any[]) => mockSave(...a),
    computeStatsData: (...a: any[]) => mockComputeStatsData(...a),
  },
}))

jest.mock('@/lib/repositories/generation-job.repository', () => ({
  generationJobRepository: {
    findPendingSprintJob: (...a: any[]) => mockFindPendingSprintJob(...a),
    markCompleted: (...a: any[]) => mockMarkCompleted(...a),
    markFailed: (...a: any[]) => mockMarkFailed(...a),
  },
}))

jest.mock('@/lib/llm/sprint-summary-client', () => ({
  callSprintSummaryLLM: (...a: any[]) => mockLLM(...a),
}))

jest.mock('@/lib/services/task-status.service', () => ({
  taskStatusService: {
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
  mockFindPendingSprintJob.mockResolvedValue(null)
  mockAggregateStruggle.mockResolvedValue(STRUGGLE)
})

const CLOSED_SPRINT = {
  id: 'sprint-1',
  teamId: 'team-1',
  team: { id: 'team-1', name: 'Core', workspaceId: 'ws-1' },
  name: 'Sprint 3',
  status: 'CLOSED',
  startDate: new Date('2026-04-06'),
  endDate: new Date('2026-04-20'),
}

const STATS_DATA = {
  stats: {
    totalTasks: 3,
    done: 2,
    spillover: 1,
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

describe('sprintSummaryService.generate', () => {
  it('happy path: closed sprint → computeStats → LLM → save', async () => {
    mockFindSprint.mockResolvedValueOnce(CLOSED_SPRINT)
    mockComputeStatsData.mockResolvedValueOnce(STATS_DATA)
    mockLLM.mockResolvedValueOnce({ tldr: 'tldr', report: 'report' })
    mockSave.mockResolvedValueOnce({ id: 'summary-1' })

    const result = await sprintSummaryService.generate('sprint-1')

    expect(mockFindSprint).toHaveBeenCalledWith('sprint-1')
    expect(mockComputeStatsData).toHaveBeenCalledWith('sprint-1', {
      securityBlocking: expect.any(Function),
    })
    // LUM-1280: the DONE gate's plugin plane feeds the verified count.
    mockCollectDoneGateBlockers.mockResolvedValueOnce([{}, {}])
    const { securityBlocking } = mockComputeStatsData.mock.calls[0][1]
    await expect(securityBlocking('t1')).resolves.toBe(2)
    expect(mockCollectDoneGateBlockers).toHaveBeenCalledWith('t1')
    // A failing plugin reads as unreadable (null) instead of throwing.
    mockCollectDoneGateBlockers.mockRejectedValueOnce(new Error('boom'))
    await expect(securityBlocking('t1')).resolves.toBeNull()
    expect(mockAggregateStruggle).toHaveBeenCalledWith(
      STATS_DATA.tasks.map(t => t.id)
    )
    expect(mockLLM).toHaveBeenCalledWith({
      subject: 'Sprint 3',
      window: { start: CLOSED_SPRINT.startDate, end: CLOSED_SPRINT.endDate },
      stats: STATS_DATA.stats,
      tasks: STATS_DATA.tasks,
      struggle: STRUGGLE,
    })
    expect(mockSave).toHaveBeenCalledWith('sprint-1', {
      stats: STATS_DATA.stats,
      tldr: 'tldr',
      report: 'report',
    })
    expect(result).toEqual({ id: 'summary-1' })
    expect(mockMarkCompleted).not.toHaveBeenCalled()
    expect(mockMarkFailed).not.toHaveBeenCalled()
  })

  it('LUM-1338: retro write-ups off — saves the figures without calling the model', async () => {
    const { aiFeaturesService } = jest.requireMock(
      '@/lib/services/ai-features.service'
    )
    aiFeaturesService.isEnabled.mockResolvedValueOnce(false)
    mockFindSprint.mockResolvedValueOnce(CLOSED_SPRINT)
    mockComputeStatsData.mockResolvedValueOnce(STATS_DATA)
    mockSave.mockResolvedValueOnce({ id: 'summary-1' })

    await sprintSummaryService.generate('sprint-1')

    expect(aiFeaturesService.isEnabled).toHaveBeenCalledWith(
      { workspaceId: 'ws-1' },
      'retroSummary'
    )
    expect(mockLLM).not.toHaveBeenCalled()
    expect(mockSave).toHaveBeenCalledWith('sprint-1', {
      stats: STATS_DATA.stats,
      tldr: '',
      report: '',
    })
    expect(mockMarkFailed).not.toHaveBeenCalled()
  })

  it('marks pending GenerationJob as completed with summaryId on success', async () => {
    mockFindSprint.mockResolvedValueOnce(CLOSED_SPRINT)
    mockFindPendingSprintJob.mockResolvedValueOnce({ id: 'job-1' })
    mockComputeStatsData.mockResolvedValueOnce(STATS_DATA)
    mockLLM.mockResolvedValueOnce({ tldr: 't', report: 'r' })
    mockSave.mockResolvedValueOnce({ id: 'summary-1' })
    mockMarkCompleted.mockResolvedValueOnce(undefined)

    await sprintSummaryService.generate('sprint-1')

    expect(mockMarkCompleted).toHaveBeenCalledWith('job-1', 'summary-1')
    expect(mockMarkFailed).not.toHaveBeenCalled()
  })

  it('throws 404 when sprint missing', async () => {
    mockFindSprint.mockResolvedValueOnce(null)
    await expect(
      sprintSummaryService.generate('missing')
    ).rejects.toMatchObject({ status: 404 })
    expect(mockComputeStatsData).not.toHaveBeenCalled()
  })

  it('throws 400 when sprint is not CLOSED', async () => {
    mockFindSprint.mockResolvedValueOnce({ ...CLOSED_SPRINT, status: 'ACTIVE' })
    await expect(
      sprintSummaryService.generate('sprint-1')
    ).rejects.toMatchObject({ status: 400 })
  })

  it('marks pending GenerationJob as failed when LLM throws', async () => {
    mockFindSprint.mockResolvedValueOnce(CLOSED_SPRINT)
    mockFindPendingSprintJob.mockResolvedValueOnce({ id: 'job-1' })
    mockComputeStatsData.mockResolvedValueOnce(STATS_DATA)
    mockLLM.mockRejectedValueOnce(new Error('llm down'))

    await expect(sprintSummaryService.generate('sprint-1')).rejects.toThrow(
      'llm down'
    )
    expect(mockMarkFailed).toHaveBeenCalledWith('job-1')
    expect(mockMarkCompleted).not.toHaveBeenCalled()
  })

  it('does not call markFailed when there is no pending job', async () => {
    mockFindSprint.mockResolvedValueOnce(CLOSED_SPRINT)
    mockFindPendingSprintJob.mockResolvedValueOnce(null)
    mockComputeStatsData.mockResolvedValueOnce(STATS_DATA)
    mockLLM.mockRejectedValueOnce(new Error('llm down'))

    await expect(sprintSummaryService.generate('sprint-1')).rejects.toThrow(
      'llm down'
    )
    expect(mockMarkFailed).not.toHaveBeenCalled()
  })
})
