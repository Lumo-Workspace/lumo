import { sprintSummaryService } from '@/lib/services/sprint-summary.service'

const mockFindSprint = jest.fn()
const mockFindTasks = jest.fn()
const mockFindActivities = jest.fn()
const mockSave = jest.fn()
const mockLLM = jest.fn()
const mockGenerationJobFindFirst = jest.fn()
const mockGenerationJobUpdate = jest.fn()

jest.mock('@/lib/repositories/sprint.repository', () => ({
  sprintRepository: { findById: (...a: any[]) => mockFindSprint(...a) },
}))
jest.mock('@/lib/repositories/sprint-summary.repository', () => ({
  sprintSummaryRepository: { save: (...a: any[]) => mockSave(...a) },
}))
jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    task: { findMany: (...a: any[]) => mockFindTasks(...a) },
    taskActivity: { findMany: (...a: any[]) => mockFindActivities(...a) },
    generationJob: {
      findFirst: (...a: any[]) => mockGenerationJobFindFirst(...a),
      update: (...a: any[]) => mockGenerationJobUpdate(...a),
    },
  },
}))
jest.mock('@/lib/llm/sprint-summary-client', () => ({
  callSprintSummaryLLM: (...a: any[]) => mockLLM(...a),
}))

beforeEach(() => {
  jest.clearAllMocks()
  // Default: no pending GenerationJob (manual retrigger / not-yet-created case)
  mockGenerationJobFindFirst.mockResolvedValue(null)
})

describe('sprintSummaryService.generate', () => {
  it('computes stats and persists summary', async () => {
    mockFindSprint.mockResolvedValueOnce({
      id: 's1',
      teamId: 'team-1',
      name: 'Sprint 3',
      status: 'CLOSED',
      startDate: new Date('2026-04-06'),
      endDate: new Date('2026-04-20'),
    })
    mockFindTasks.mockResolvedValueOnce([
      {
        id: 't1',
        status: 'DONE',
        priority: 'HIGH',
        assigneeActorId: 'a1',
        title: 'one',
      },
      {
        id: 't2',
        status: 'DONE',
        priority: 'LOW',
        assigneeActorId: 'a1',
        title: 'two',
      },
      {
        id: 't3',
        status: 'IN_PROGRESS',
        priority: 'MEDIUM',
        assigneeActorId: null,
        title: 'three',
      },
    ])
    mockFindActivities.mockResolvedValueOnce([
      { taskId: 'spilled-1', payload: {} },
    ])
    mockLLM.mockResolvedValueOnce({
      tldr: 'Shipped 2 tasks.',
      report: '## Retro …',
    })
    mockSave.mockResolvedValueOnce({ id: 'ss1' })

    await sprintSummaryService.generate('s1')

    expect(mockSave).toHaveBeenCalledWith(
      's1',
      expect.objectContaining({
        tldr: 'Shipped 2 tasks.',
        report: expect.stringContaining('Retro'),
        stats: expect.objectContaining({
          totalTasks: 4, // 3 in-sprint + 1 spillover
          done: 2,
          spillover: 1,
        }),
      })
    )
  })

  it('passes correct LLM input with sprint name and window', async () => {
    mockFindSprint.mockResolvedValueOnce({
      id: 's1',
      teamId: 'team-1',
      name: 'Sprint 3',
      status: 'CLOSED',
      startDate: new Date('2026-04-06'),
      endDate: new Date('2026-04-20'),
    })
    mockFindTasks.mockResolvedValueOnce([
      {
        id: 't1',
        status: 'DONE',
        priority: 'HIGH',
        assigneeActorId: 'a1',
        title: 'one',
      },
    ])
    mockFindActivities.mockResolvedValueOnce([])
    mockLLM.mockResolvedValueOnce({ tldr: 'Done.', report: '## Retro' })
    mockSave.mockResolvedValueOnce({ id: 'ss1' })

    await sprintSummaryService.generate('s1')

    expect(mockLLM).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: 'Sprint 3',
        window: {
          start: new Date('2026-04-06'),
          end: new Date('2026-04-20'),
        },
        stats: expect.objectContaining({
          totalTasks: 1,
          done: 1,
          spillover: 0,
        }),
      })
    )
  })

  it('groups byPriority and byAssignee correctly', async () => {
    mockFindSprint.mockResolvedValueOnce({
      id: 's1',
      teamId: 'team-1',
      name: 'Sprint 3',
      status: 'CLOSED',
      startDate: new Date('2026-04-06'),
      endDate: new Date('2026-04-20'),
    })
    mockFindTasks.mockResolvedValueOnce([
      {
        id: 't1',
        status: 'DONE',
        priority: 'HIGH',
        assigneeActorId: 'a1',
        title: 'one',
      },
      {
        id: 't2',
        status: 'DONE',
        priority: 'HIGH',
        assigneeActorId: 'a2',
        title: 'two',
      },
      {
        id: 't3',
        status: 'IN_PROGRESS',
        priority: 'LOW',
        assigneeActorId: null,
        title: 'three',
      },
    ])
    mockFindActivities.mockResolvedValueOnce([])
    mockLLM.mockResolvedValueOnce({ tldr: 'Done.', report: '## Retro' })
    mockSave.mockResolvedValueOnce({ id: 'ss1' })

    await sprintSummaryService.generate('s1')

    expect(mockSave).toHaveBeenCalledWith(
      's1',
      expect.objectContaining({
        stats: expect.objectContaining({
          byPriority: { HIGH: 2, LOW: 1 },
          byAssignee: { a1: 1, a2: 1, unassigned: 1 },
        }),
      })
    )
  })

  it('throws 400 if sprint not CLOSED', async () => {
    mockFindSprint.mockResolvedValueOnce({ id: 's1', status: 'ACTIVE' })
    await expect(sprintSummaryService.generate('s1')).rejects.toMatchObject({
      status: 400,
    })
  })

  it('throws 404 if sprint missing', async () => {
    mockFindSprint.mockResolvedValueOnce(null)
    await expect(sprintSummaryService.generate('s1')).rejects.toMatchObject({
      status: 404,
    })
  })

  it('updates pending GenerationJob to completed with summaryId on success', async () => {
    mockGenerationJobFindFirst.mockResolvedValueOnce({ id: 'job-1' })
    mockFindSprint.mockResolvedValueOnce({
      id: 's1',
      teamId: 'team-1',
      name: 'Sprint 3',
      status: 'CLOSED',
      startDate: new Date('2026-04-06'),
      endDate: new Date('2026-04-20'),
    })
    mockFindTasks.mockResolvedValueOnce([])
    mockFindActivities.mockResolvedValueOnce([])
    mockLLM.mockResolvedValueOnce({ tldr: 'Done.', report: '## Retro' })
    mockSave.mockResolvedValueOnce({ id: 'ss-42' })
    mockGenerationJobUpdate.mockResolvedValueOnce({
      id: 'job-1',
      status: 'completed',
    })

    await sprintSummaryService.generate('s1')

    expect(mockGenerationJobUpdate).toHaveBeenCalledWith({
      where: { id: 'job-1' },
      data: { status: 'completed', summaryId: 'ss-42' },
    })
  })

  it('updates pending GenerationJob to failed when LLM throws', async () => {
    mockGenerationJobFindFirst.mockResolvedValueOnce({ id: 'job-2' })
    mockFindSprint.mockResolvedValueOnce({
      id: 's1',
      teamId: 'team-1',
      name: 'Sprint 3',
      status: 'CLOSED',
      startDate: new Date('2026-04-06'),
      endDate: new Date('2026-04-20'),
    })
    mockFindTasks.mockResolvedValueOnce([])
    mockFindActivities.mockResolvedValueOnce([])
    mockLLM.mockRejectedValueOnce(new Error('LLM timeout'))
    mockGenerationJobUpdate.mockResolvedValueOnce({
      id: 'job-2',
      status: 'failed',
    })

    await expect(sprintSummaryService.generate('s1')).rejects.toThrow(
      'LLM timeout'
    )

    expect(mockGenerationJobUpdate).toHaveBeenCalledWith({
      where: { id: 'job-2' },
      data: { status: 'failed' },
    })
  })
})
